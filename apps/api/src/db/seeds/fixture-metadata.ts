// Resolves a TXODDS fixture id to real team names from the local seed (matches.json) — the
// scores feed itself carries no team names (only numeric participant ids), so this is the one
// place a replay bootstrap's team names come from. Returns undefined for an unlisted fixture; the
// caller decides the placeholder in that case (see match.repository.ts's doc comment).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface FixtureSeed {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
}

function loadSeeds(): FixtureSeed[] {
  const raw: unknown = JSON.parse(readFileSync(path.join(__dirname, "matches.json"), "utf8"));
  if (!Array.isArray(raw)) throw new Error("db/seeds/matches.json is not an array");
  return raw as FixtureSeed[];
}

export function resolveFixtureTeams(fixtureId: number): { homeTeam: string; awayTeam: string } | undefined {
  const match = loadSeeds().find((entry) => entry.fixtureId === fixtureId);
  return match ? { homeTeam: match.homeTeam, awayTeam: match.awayTeam } : undefined;
}
