import type { Cs2SettlementCondition, Cs2TeamIdentity } from "@arena/contracts";
import { buildCs2SettlementCondition, pickCs2Candidate, renderCs2Question } from "./catalog.js";

export interface Cs2QuestionContext {
  matchId: string;
  arenaId: string;
  roundNumber: number;
  teams: readonly [Cs2TeamIdentity, Cs2TeamIdentity];
}

export interface Cs2GeneratedQuestion {
  question: string;
  settlementCondition: Cs2SettlementCondition;
}

export interface Cs2QuestionProvider {
  generate(ctx: Cs2QuestionContext): Cs2GeneratedQuestion;
}

const PISTOL_ROUND_NUMBER = 13;

const OT_SCORE_ROUND_NUMBER = 24;

function pickForRound(
  roundNumber: number,
  teams: readonly [Cs2TeamIdentity, Cs2TeamIdentity],
): ReturnType<typeof pickCs2Candidate> {
  if (roundNumber === PISTOL_ROUND_NUMBER) {
    const targetTeamId = teams[Math.random() < 0.5 ? 0 : 1].teamId;
    return { topic: "pistol_round", params: { targetTeamId } };
  }
  if (roundNumber === OT_SCORE_ROUND_NUMBER) {
    return { topic: "ot_score", params: {} };
  }
  return pickCs2Candidate(teams);
}

export function createCs2QuestionProvider(): Cs2QuestionProvider {
  return {
    generate(ctx: Cs2QuestionContext): Cs2GeneratedQuestion {
      const { topic, params } = pickForRound(ctx.roundNumber, ctx.teams);
      return {
        question: renderCs2Question(topic, params, ctx.teams),
        settlementCondition: buildCs2SettlementCondition(topic, params, ctx.roundNumber),
      };
    },
  };
}
