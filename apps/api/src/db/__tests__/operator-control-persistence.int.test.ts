import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

describe.skipIf(!RUN)("operator control persistence (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../client.js")["db"];
  let tryAcquireOperatorMutationLock: typeof import("../client.js")["tryAcquireOperatorMutationLock"];
  let schema: typeof import("../schema.js");
  let settingsRepository: typeof import("../repositories/settings.repository.js")["settingsRepository"];
  let operatorAuditRepository: typeof import("../repositories/operator-audit.repository.js")["operatorAuditRepository"];
  let cs2CatalogRepository: typeof import("../repositories/cs2-catalog.repository.js")["cs2CatalogRepository"];
  let originalTournamentId: string | undefined;

  const actorId = `operator-test-${randomUUID()}`;
  const requestId = randomUUID();
  const tournamentId = `tournament-${randomUUID()}`;
  const gridSeriesId = `series-${randomUUID()}`;

  beforeAll(async () => {
    ({ db, tryAcquireOperatorMutationLock } = await import("../client.js"));
    schema = await import("../schema.js");
    ({ settingsRepository } = await import("../repositories/settings.repository.js"));
    ({ operatorAuditRepository } = await import("../repositories/operator-audit.repository.js"));
    ({ cs2CatalogRepository } = await import("../repositories/cs2-catalog.repository.js"));
    originalTournamentId = await settingsRepository.getActiveCs2TournamentId();
  });

  afterAll(async () => {
    if (db === undefined) return;
    await db.delete(schema.operatorAudits).where(eq(schema.operatorAudits.actorId, actorId));
    await db.delete(schema.series).where(eq(schema.series.gridSeriesId, gridSeriesId));
    await db.delete(schema.cs2Competitions).where(eq(schema.cs2Competitions.gridTournamentId, tournamentId));
    await db.delete(schema.settings).where(eq(schema.settings.name, "cs2_active_tournament"));
    if (originalTournamentId !== undefined) {
      await settingsRepository.setActiveCs2TournamentId(originalTournamentId);
    }
  });

  it("bootstraps one active tournament once and then keeps the database value", async () => {
    await db.delete(schema.settings).where(eq(schema.settings.name, "cs2_active_tournament"));
    await expect(settingsRepository.bootstrapActiveCs2TournamentId([])).resolves.toBeUndefined();
    await expect(settingsRepository.bootstrapActiveCs2TournamentId([tournamentId])).resolves.toBe(tournamentId);
    await expect(settingsRepository.bootstrapActiveCs2TournamentId(["different-tournament"])).resolves.toBe(tournamentId);

    const stored = await cs2CatalogRepository.synchronizeSeries({
      gridSeriesId,
      competition: { gridTournamentId: tournamentId, name: "Operator Test" },
      format: 3,
      scheduledStartTime: new Date(Date.now() + 3_600_000),
      lifecycle: "upcoming",
      isSupported: true,
      participants: [
        { state: "tbd", displayOrder: 1 },
        { state: "tbd", displayOrder: 2 },
      ],
    });
    await expect(cs2CatalogRepository.listSupported()).resolves.toEqual([
      expect.objectContaining({ id: stored.seriesId }),
    ]);
    await expect(cs2CatalogRepository.listAutopilotCandidates()).resolves.toEqual([
      expect.objectContaining({ seriesId: stored.seriesId }),
    ]);
  });

  it("allows only one operator mutation lock holder", async () => {
    const releaseFirst = await tryAcquireOperatorMutationLock();
    expect(releaseFirst).toBeTypeOf("function");
    await expect(tryAcquireOperatorMutationLock()).resolves.toBeUndefined();
    await releaseFirst?.();

    const releaseNext = await tryAcquireOperatorMutationLock();
    expect(releaseNext).toBeTypeOf("function");
    await releaseNext?.();
  });

  it("appends and reads a compact mutation audit", async () => {
    const appended = await operatorAuditRepository.append({
      actorId,
      actorLogin: "operator-test",
      action: "autopilot.set",
      targetId: "cs2_autopilot",
      result: "succeeded",
      requestId,
      details: { before: false, after: true },
    });
    await operatorAuditRepository.append({
      actorId,
      actorLogin: "operator-test",
      action: "series.priority.set",
      targetId: "series-test",
      result: "succeeded",
      requestId: randomUUID(),
      details: { before: false, after: true },
    });

    expect(appended).toMatchObject({ actorId, requestId, result: "succeeded" });
    const all = await operatorAuditRepository.list({ actorId });
    expect(all).toHaveLength(2);
    const firstPage = await operatorAuditRepository.list({ actorId, limit: 1 });
    expect(firstPage).toEqual([all[0]]);
    await expect(operatorAuditRepository.list({
      actorId,
      cursor: { createdAt: new Date(firstPage[0]!.createdAt), id: firstPage[0]!.id },
    })).resolves.toEqual([all[1]]);
  });
});
