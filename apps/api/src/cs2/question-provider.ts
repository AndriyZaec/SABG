// Seam (cs2-migration-spec/spec_v2.md §3, mirrors round-engine/question-provider.ts): the CS2
// round engine needs a question + settlement condition for every Round it opens, but never
// depends on how that's produced. Deliberately its own interface, not a reuse of soccer's
// `QuestionProvider` — the context here is `roundNumber`, not match-clock window minutes, and
// spec §3 explicitly says round-engine internals (including this DI seam) stay separate per
// discipline rather than forcing a shared shape over two different domains.

import type { Cs2SettlementCondition } from "@arena/contracts";
import { buildCs2SettlementCondition, pickCs2Candidate, renderCs2Question } from "./catalog.js";

export interface Cs2QuestionContext {
  matchId: string;
  arenaId: string;
  /** The Round (not PredictionRound) this question is 1:1 with, spec §2. */
  roundNumber: number;
  teamNames?: { home: string; away: string };
}

export interface Cs2GeneratedQuestion {
  question: string;
  settlementCondition: Cs2SettlementCondition;
}

export interface Cs2QuestionProvider {
  generate(ctx: Cs2QuestionContext): Cs2GeneratedQuestion;
}

/** Round 13 of every Match (MR12: two halves of 12) — spec §7 п.4. Fixed pistol question,
 *  random target team, still resolved by the ordinary `round_winner`-shaped math. */
const PISTOL_ROUND_NUMBER = 13;

/** Round 24 (if the Match reaches it) — spec §7 п.5. Fixed "will the score be 12-12" question,
 *  a direct after-snapshot read rather than a diff (see settle.ts). Not generated if the Match
 *  ends earlier — that's the round engine's responsibility (§7 п.3's void ordering), not this
 *  provider's; this provider only renders it correctly *if* asked for round 24. */
const OT_SCORE_ROUND_NUMBER = 24;

function pickForRound(roundNumber: number): ReturnType<typeof pickCs2Candidate> {
  if (roundNumber === PISTOL_ROUND_NUMBER) {
    const targetTeam = Math.random() < 0.5 ? "home" : "away";
    return { topic: "pistol_round", params: { targetTeam } };
  }
  if (roundNumber === OT_SCORE_ROUND_NUMBER) {
    return { topic: "ot_score", params: {} };
  }
  // All other rounds, including Round 1 (spec §7 п.1: lowest-difficulty pick from the same
  // catalog — §10's difficulty weighting is a placeholder everywhere else in this codebase
  // today, soccer included, so Round 1 gets an ordinary uniform pick here too until that lands).
  return pickCs2Candidate();
}

/** Thin wrapper over `catalog.ts`'s pure pick/render/build functions — no state of its own. */
export function createCs2QuestionProvider(): Cs2QuestionProvider {
  return {
    generate(ctx: Cs2QuestionContext): Cs2GeneratedQuestion {
      const { topic, params } = pickForRound(ctx.roundNumber);
      return {
        question: renderCs2Question(topic, params, ctx.teamNames),
        settlementCondition: buildCs2SettlementCondition(topic, params, ctx.roundNumber),
      };
    },
  };
}
