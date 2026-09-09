import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

describe.skipIf(!RUN)("seriesRepository.setMapNames (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../client.js")["db"];
  let schema: typeof import("../schema.js");
  let seriesRepository: typeof import("../repositories/series.repository.js")["seriesRepository"];

  const runId = randomUUID();
  const gridSeriesId = `map-names-series-${runId}`;
  let seriesId: string;

  beforeAll(async () => {
    ({ db } = await import("../client.js"));
    schema = await import("../schema.js");
    ({ seriesRepository } = await import("../repositories/series.repository.js"));

    const series = await seriesRepository.upsertByGridSeriesId(gridSeriesId, {
      format: 3,
      scheduledStartTime: new Date(),
    });
    seriesId = series.id;
  });

  afterAll(async () => {
    if (db === undefined) return;
    await db.delete(schema.series).where(eq(schema.series.id, seriesId));
  });

  it("writes a changed value and skips an unchanged one", async () => {
    await seriesRepository.setMapNames(seriesId, ["mirage"]);
    const [afterFirstWrite] = await db.select({ mapNames: schema.series.mapNames, updatedAt: schema.series.updatedAt }).from(schema.series).where(eq(schema.series.id, seriesId));
    expect(afterFirstWrite?.mapNames).toEqual(["mirage"]);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await seriesRepository.setMapNames(seriesId, ["mirage"]);
    const [afterNoopWrite] = await db.select({ mapNames: schema.series.mapNames, updatedAt: schema.series.updatedAt }).from(schema.series).where(eq(schema.series.id, seriesId));
    expect(afterNoopWrite?.updatedAt).toEqual(afterFirstWrite?.updatedAt);

    await seriesRepository.setMapNames(seriesId, ["mirage", "inferno"]);
    const [afterSecondWrite] = await db.select({ mapNames: schema.series.mapNames, updatedAt: schema.series.updatedAt }).from(schema.series).where(eq(schema.series.id, seriesId));
    expect(afterSecondWrite?.mapNames).toEqual(["mirage", "inferno"]);
    expect(afterSecondWrite?.updatedAt).not.toEqual(afterFirstWrite?.updatedAt);
  });
});
