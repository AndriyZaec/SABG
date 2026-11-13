import { describe, expect, it } from "vitest";
import type { AnswerRejectionReason } from "@arena/contracts";
import type { Cs2ArenaView, Cs2RoundView } from "../cs2View.js";
import { stageFixtures } from "./stageFixtures.js";
import { stageRoundState } from "./stageRoundState.js";

const ROUND: Cs2RoundView = { roundId: "r8", roundNumber: 8, question: "Will Falcons win this round?", status: "settled", correctAnswer: "yes" };
const IDLE = { status: "idle" } as const;

function eliminatedView(eliminatedRound: number): Cs2ArenaView {
  const base = stageFixtures["Round open"].view;
  return {
    ...base, round: ROUND, myStatus: "eliminated",
    leaderboard: base.leaderboard.map((row) => row.you ? { ...row, status: "eliminated", eliminatedRound } : row),
  };
}

describe("stageRoundState", () => {
  it("shows YOU'RE OUT for a reconnected player eliminated before the current settled round", () => {
    expect(stageRoundState(eliminatedView(7), true, IDLE)).toMatchObject({ title: "YOU'RE OUT" });
  });

  it("preserves the result of the very round that eliminated the player", () => {
    expect(stageRoundState(eliminatedView(8), true, IDLE)).toMatchObject({ title: "NO POINTS" });
  });

  it("preserves the hardcore result in the elimination round", () => {
    expect(stageRoundState({ ...eliminatedView(8), mode: "hardcore" }, true, IDLE)).toMatchObject({ kind: "tile", appearance: "result", title: "OUT" });
  });

  it("does not invent a personal result if the elimination round is unknown", () => {
    const view = eliminatedView(7);
    view.leaderboard = view.leaderboard.map(({ eliminatedRound: _round, ...row }) => row);
    expect(stageRoundState(view, true, IDLE)).toMatchObject({ title: "YOU'RE OUT" });
  });

  it.each([
    ["Cancelled", "terminal", "ARENA CANCELLED"],
    ["Finished", "terminal", "ARENA OVER"],
    ["Disconnected", "tile", "OFFLINE"],
    ["No round yet", "tile", "NEXT QUESTION SOON"],
    ["Spectator", "tile", "SPECTATING"],
    ["Eliminated", "tile", "YOU'RE OUT"],
    ["Reconnect · no correct answers", "tile", "NO CORRECT ANSWERS"],
    ["Reconnect · classic double correct", "tile", "+2"],
  ] as const)("models %s in one presentation branch", (name, kind, title) => {
    const fixture = stageFixtures[name];
    expect(stageRoundState(fixture.view, fixture.connected, fixture.answerSubmission)).toMatchObject({ kind, title });
  });

  it("gives terminal outcomes priority over connection state", () => {
    const view = { ...eliminatedView(8), finished: true as const, myStatus: "winner" as const };
    expect(stageRoundState(view, false, IDLE)).toEqual({ kind: "terminal", terminal: "winner" });
    expect(stageRoundState({ ...view, cancelled: { reason: "insufficient_players" } }, false, IDLE)).toMatchObject({ terminal: "cancelled" });
  });

  it("keeps open, submitting and locked answer states distinct", () => {
    const view = { ...eliminatedView(8), myStatus: "active" as const, round: { ...ROUND, status: "open" as const } };
    expect(stageRoundState(view, true, IDLE)).toMatchObject({ kind: "answers", canAnswer: true, picked: undefined, submitting: false, plateTone: "yellow" });
    expect(stageRoundState(view, true, { status: "submitting", roundId: ROUND.roundId, answer: "no" })).toMatchObject({ kind: "answers", picked: "no", submitting: true, plateTone: "blue" });
    expect(stageRoundState({ ...view, round: { ...ROUND, status: "locked" } }, true, IDLE)).toMatchObject({ kind: "answers", canAnswer: false, plateTone: "blue" });
  });

  it.each<AnswerRejectionReason>(["not_subscribed", "arena_not_found", "round_not_found", "round_locked", "eliminated", "not_participant"])("renders human copy for %s", (reason) => {
    const view = { ...stageFixtures["Round open"].view, round: { ...ROUND, status: "open" as const, myAnswer: "yes" as const } };
    const result = stageRoundState(view, true, { status: "rejected", roundId: ROUND.roundId, answer: "no", reason });
    expect(result).toMatchObject({ kind: "answers", picked: undefined });
    if (result.kind !== "answers") throw new Error("Expected answer state");
    expect(result.rejection).toBeTruthy();
    expect(result.rejection).not.toContain(reason);
    expect(stageRoundState(view, true, { status: "rejected", roundId: "old-round", answer: "no", reason })).not.toHaveProperty("rejection");
  });
});
