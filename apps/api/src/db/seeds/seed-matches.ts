// Idempotent seed: loads apps/api/src/db/seeds/matches.json (source of truth for known
// fixtures) into the Postgres `match` table. Safe to re-run — matches an existing row by
// (homeTeam, awayTeam, startTime) and only ever writes `txoddsFixtureId` on conflict, so it
// never clobbers a match's live status/score/period/currentMinute once the engine owns them.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MatchSeedSchema = z.object({
  fixtureId: z.number().int().positive(),
  sport: z.string(),
  region: z.string(),
  competition: z.string(),
  kickoff: z.string(),
  homeTeam: z.string(),
  awayTeam: z.string(),
});

async function main(): Promise<void> {
  const { db } = await import("../client.js");
  const { matches } = await import("../schema.js");

  const raw: unknown = JSON.parse(readFileSync(path.join(__dirname, "matches.json"), "utf8"));
  const seeds = z.array(MatchSeedSchema).parse(raw);

  for (const seed of seeds) {
    await db
      .insert(matches)
      .values({
        txoddsFixtureId: seed.fixtureId,
        homeTeam: seed.homeTeam,
        awayTeam: seed.awayTeam,
        startTime: new Date(seed.kickoff),
        status: "scheduled",
        period: "pre",
        currentMinute: 0,
        scoreHome: 0,
        scoreAway: 0,
      })
      .onConflictDoUpdate({
        target: [matches.homeTeam, matches.awayTeam, matches.startTime],
        set: { txoddsFixtureId: seed.fixtureId },
      });

    console.log(`seeded ${seed.homeTeam} vs ${seed.awayTeam} (fixtureId ${seed.fixtureId})`);
  }

  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("seed-matches failed", err);
  process.exit(1);
});
