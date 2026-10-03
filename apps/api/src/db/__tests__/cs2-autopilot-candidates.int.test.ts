import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

describe.skipIf(!RUN)("cs2CatalogRepository.listAutopilotCandidates (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../client.js")["db"];
  let schema: typeof import("../schema.js");
  let repository: typeof import("../repositories/cs2-catalog.repository.js")["cs2CatalogRepository"];
  let matchRepository: typeof import("../repositories/match.repository.js")["matchRepository"];
  let arenaRepository: typeof import("../repositories/arena.repository.js")["arenaRepository"];
  let userRepository: typeof import("../repositories/user.repository.js")["userRepository"];
  let followRepository: typeof import("../repositories/cs2-series-follow.repository.js")["cs2SeriesFollowRepository"];

  const runId = randomUUID();
  const gridTournamentId = `autopilot-tournament-${runId}`;
  const gridSeriesIds: string[] = [];
  const gridTeamIds: string[] = [];
  const matchIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    ({ db } = await import("../client.js"));
    schema = await import("../schema.js");
    ({ cs2CatalogRepository: repository } = await import("../repositories/cs2-catalog.repository.js"));
    ({ matchRepository } = await import("../repositories/match.repository.js"));
    ({ arenaRepository } = await import("../repositories/arena.repository.js"));
    ({ userRepository } = await import("../repositories/user.repository.js"));
    ({ cs2SeriesFollowRepository: followRepository } = await import("../repositories/cs2-series-follow.repository.js"));
  });

  afterAll(async () => {
    if (db === undefined) return;
    if (matchIds.length > 0) {
      await db.delete(schema.arenas).where(inArray(schema.arenas.matchId, matchIds));
      await db.delete(schema.matches).where(inArray(schema.matches.id, matchIds));
    }
    if (gridSeriesIds.length > 0) await db.delete(schema.series).where(inArray(schema.series.gridSeriesId, gridSeriesIds));
    if (gridTeamIds.length > 0) await db.delete(schema.cs2Teams).where(inArray(schema.cs2Teams.gridTeamId, gridTeamIds));
    await db.delete(schema.cs2Competitions).where(eq(schema.cs2Competitions.gridTournamentId, gridTournamentId));
    if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  });

  async function seed(name: string, opts: { isSupported: boolean; secondSlotKnown: boolean }) {
    const gridSeriesId = `autopilot-${name}-${runId}`;
    gridSeriesIds.push(gridSeriesId);
    const teamA = `autopilot-${name}-a-${runId}`;
    const teamB = `autopilot-${name}-b-${runId}`;
    gridTeamIds.push(teamA, teamB);
    const { seriesId } = await repository.synchronizeSeries({
      gridSeriesId,
      competition: { gridTournamentId, name: "Autopilot Cup" },
      format: 3,
      scheduledStartTime: new Date("2026-10-04T09:00:00.000Z"),
      lifecycle: "upcoming",
      isSupported: opts.isSupported,
      participants: [
        { state: "known", displayOrder: 1, team: { gridTeamId: teamA, name: `${name} A` } },
        opts.secondSlotKnown
          ? { state: "known", displayOrder: 2, team: { gridTeamId: teamB, name: `${name} B` } }
          : { state: "tbd", displayOrder: 2 },
      ],
    });
    return seriesId;
  }

  it("reports selectability, follower count, and whether an arena exists, from the DB", async () => {
    const ready = await seed("ready", { isSupported: true, secondSlotKnown: true });
    const tbd = await seed("tbd", { isSupported: true, secondSlotKnown: false });
    const unsupported = await seed("unsupported", { isSupported: false, secondSlotKnown: true });
    const withArena = await seed("arena", { isSupported: true, secondSlotKnown: true });

    for (const i of [1, 2]) {
      const user = await userRepository.upsertByWallet(`autopilot-wallet-${i}-${runId}`, `autopilot-follower-${i}`);
      userIds.push(user.id);
      await followRepository.follow(user.id, ready);
    }

    const participants = await db
      .select({ teamId: schema.cs2SeriesParticipants.teamId })
      .from(schema.cs2SeriesParticipants)
      .where(eq(schema.cs2SeriesParticipants.seriesId, withArena))
      .orderBy(schema.cs2SeriesParticipants.displayOrder);
    const match = await matchRepository.upsertForSeriesMap(withArena, 1, {
      teams: [
        { teamId: participants[0]!.teamId, name: "arena A" },
        { teamId: participants[1]!.teamId, name: "arena B" },
      ],
      startTime: new Date("2026-10-04T09:00:00.000Z"),
    });
    matchIds.push(match.id);
    await arenaRepository.upsertForMatch(match.id, { entryFeeLamports: 1000, prizePoolLamports: 0 });

    const candidates = await repository.listAutopilotCandidates([gridTournamentId]);
    const byId = new Map(candidates.map((candidate) => [candidate.seriesId, candidate]));

    expect(candidates).toHaveLength(4);
    expect(byId.get(ready)).toEqual({
      seriesId: ready,
      scheduledStartTime: "2026-10-04T09:00:00.000Z",
      priority: false,
      followerCount: 2,
      selectable: true,
      status: "active",
      hasArena: false,
      skipRequested: false,
    });
    expect(byId.get(tbd)).toMatchObject({ selectable: false, followerCount: 0, hasArena: false });
    expect(byId.get(unsupported)).toMatchObject({ selectable: false, hasArena: false });
    expect(byId.get(withArena)).toMatchObject({ selectable: true, hasArena: true });
  });

  it("returns nothing for no configured tournaments", async () => {
    expect(await repository.listAutopilotCandidates([])).toEqual([]);
  });
});
