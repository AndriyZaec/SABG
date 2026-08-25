import type { Cs2SettlementCondition } from "@arena/contracts";
import { buildCs2SettlementCondition, pickCs2Candidate, renderCs2Question } from "./catalog.js";

export interface Cs2QuestionContext {
  matchId: string;
  arenaId: string;
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

const PISTOL_ROUND_NUMBER = 13;

const OT_SCORE_ROUND_NUMBER = 24;

function pickForRound(roundNumber: number): ReturnType<typeof pickCs2Candidate> {
  if (roundNumber === PISTOL_ROUND_NUMBER) {
    const targetTeam = Math.random() < 0.5 ? "home" : "away";
    return { topic: "pistol_round", params: { targetTeam } };
  }
  if (roundNumber === OT_SCORE_ROUND_NUMBER) {
    return { topic: "ot_score", params: {} };
  }
  return pickCs2Candidate();
}

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
