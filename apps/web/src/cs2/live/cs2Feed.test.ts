import { describe, expect, it } from "vitest";
import type { Answer, Cs2TeamIdentity, PredictionResult } from "@arena/contracts";
import { buildCs2Feed, type Cs2FeedInput, type Cs2FeedRound, type Cs2RoundResult } from "./cs2Feed.js";

const TEAMS: Cs2TeamIdentity[] = [{ teamId: "t1", name: "Aurora YB" }, { teamId: "t2", name: "Four Magic" }];

/** A settled round asking for a Tec-9 kill; "no" is the correct answer. */
function round(n: number, mine?: Answer, extra: Partial<Cs2FeedRound> = {}): Cs2FeedRound {
  return {
    id: `r${n}`,
    roundNumber: n,
    status: "settled",
    question: `Will there be a kill with Tec-9 this round? (${n})`,
    settlementCondition: { discipline: "cs2", topic: "weapon_kill", params: { weapon: "tec9" }, roundNumber: n, resolve: "snapshot_diff" },
    correctAnswer: "no",
    ...(mine !== undefined ? { mine: { answer: mine, result: (mine === "no" ? "correct" : "incorrect") as PredictionResult } } : {}),
    ...extra,
  };
}

function input(overrides: Partial<Cs2FeedInput>): Cs2FeedInput {
  return { mode: "classic", teams: TEAMS, rounds: [], liveResults: {}, winners: [], won: false, finished: false, ...overrides };
}

const results = (items: ReturnType<typeof buildCs2Feed>) => items.flatMap((i) => (i.kind === "result" ? [i] : []));

describe("buildCs2Feed", () => {
  it("shows a classic player's result with points, newest first, double round included", () => {
    const items = buildCs2Feed(input({ rounds: [round(1, "no"), round(2, "yes"), round(3)], me: { score: 2, rank: 1 } }));
    expect(items).toEqual([
      { kind: "result", id: "result-r3", outcome: "missed", points: 0, detail: "R3 · Tec-9 kill? · answer NO" },
      { kind: "result", id: "result-r2", outcome: "wrong", points: 0, detail: "R2 · Tec-9 kill? · answer NO, you YES" },
      { kind: "result", id: "result-r1", outcome: "correct", points: 2, detail: "R1 · Tec-9 kill? · answer NO" },
    ]);
  });

  it("shows hardcore results without points and an Out line", () => {
    const items = buildCs2Feed(input({ mode: "hardcore", rounds: [round(1, "no"), round(2, "yes")], me: { score: 1, rank: 2, eliminatedRound: 2 } }));
    expect(items.map((i) => (i.kind === "result" ? `${i.outcome}:${String(i.points)}` : `${i.kind}:${"text" in i ? i.text : i.title}`))).toEqual([
      "out:Out", "wrong:undefined", "correct:undefined",
    ]);
  });

  it("gives a spectator neutral round lines", () => {
    const items = buildCs2Feed(input({ rounds: [round(1), round(2)] }));
    expect(items).toEqual([
      { kind: "round", id: "round-r2", text: "R2 · Tec-9 kill? · answer NO" },
      { kind: "round", id: "round-r1", text: "R1 · Tec-9 kill? · answer NO" },
    ]);
  });

  it("shows the zone elimination and turns later rounds neutral, not MISSED", () => {
    const rounds = Array.from({ length: 9 }, (_, i) => round(i + 1, i === 0 ? "no" : undefined));
    const items = buildCs2Feed(input({ rounds, me: { score: 2, rank: 3, eliminatedRound: 8 } }));
    expect(items[0]).toEqual({ kind: "round", id: "round-r9", text: "R9 · Tec-9 kill? · answer NO" });
    expect(items[1]).toEqual({ kind: "out", id: "out", text: "Out — zone 4, you had 2" });
    expect(items[2]).toMatchObject({ kind: "result", id: "result-r8", outcome: "missed" });
  });

  it("marks Final Circle where it starts and scores its double rounds as 1", () => {
    const rounds = Array.from({ length: 12 }, (_, i) => round(i + 1, "no"));
    const items = buildCs2Feed(input({ rounds, me: { score: 9, rank: 1 }, finalCircleFromRound: 7 }));
    const fcAt = items.findIndex((i) => i.id === "final-circle");
    expect(items[fcAt]).toEqual({
      kind: "event",
      id: "final-circle",
      tone: "final_circle",
      title: "Final Circle",
      detail: "R7 already counts. Others got it right and you didn't? You're out.",
    });
    expect(items[fcAt - 1]).toMatchObject({ id: "result-r7" });
    expect(items[fcAt + 1]).toMatchObject({ id: "result-r6" });
    expect(results(items).find((i) => i.id === "result-r12")?.points).toBe(1);
    expect(results(items).find((i) => i.id === "result-r1")?.points).toBe(2);
  });

  it("shows Final Circle as soon as it starts, before any of its rounds settle", () => {
    const items = buildCs2Feed(input({ rounds: [round(6, "no")], me: { score: 1, rank: 1 }, finalCircleFromRound: 7 }));
    expect(items[0]).toMatchObject({ id: "final-circle", detail: expect.stringMatching(/^R7 already counts\./) });
  });

  it("keeps every round of the map, not just the last 20", () => {
    const rounds = Array.from({ length: 30 }, (_, i) => round(i + 1, "no"));
    expect(results(buildCs2Feed(input({ rounds, me: { score: 30, rank: 1 } })))).toHaveLength(30);
  });

  it("falls back to neutral lines when the viewer has no leaderboard row", () => {
    const items = buildCs2Feed(input({ rounds: [round(1, "no"), round(2)] }));
    expect(items.every((i) => i.kind === "round")).toBe(true);
  });

  it("falls back to the stored question when the short form can't be built", () => {
    const odd = round(1, undefined, {
      question: "Will Team Ghost win this round?",
      settlementCondition: { discipline: "cs2", topic: "round_winner", params: { targetTeamId: "missing" }, roundNumber: 1, resolve: "snapshot_diff" },
    });
    expect(buildCs2Feed(input({ rounds: [odd] }))).toEqual([
      { kind: "round", id: "round-r1", text: "R1 · Will Team Ghost win this round? · answer NO" },
    ]);
  });

  it("keeps the hardcore no-correct-answers line and ends with one win line", () => {
    const items = buildCs2Feed(input({
      mode: "hardcore",
      rounds: [round(1, "yes", { survivalRuleApplied: "no_correct_answers" })],
      me: { score: 0, rank: 1 },
      winners: ["p1"],
      finished: true,
      won: true,
    }));
    expect(items).toEqual([
      { kind: "event", id: "won", tone: "won", title: "You won", value: "0", detail: "Arena finished · only winner" },
      { kind: "event", id: "survival-r1", tone: "neutral", title: "No correct answers", detail: "R1 · all survivors stay in" },
      expect.objectContaining({ kind: "result", outcome: "wrong" }),
    ]);
  });

  it("shows a void with its short question, or just the round when the question is unknown", () => {
    const known = round(20, undefined, { status: "voided" });
    const unseen: Cs2FeedRound = { id: "r21", roundNumber: 21, status: "voided", question: "" };
    expect(buildCs2Feed(input({ rounds: [known, unseen] }))).toEqual([
      { kind: "event", id: "void-r21", tone: "void", title: "Voided", value: "—", detail: "R21 · not scored" },
      { kind: "event", id: "void-r20", tone: "void", title: "Voided", value: "—", detail: "R20 · Tec-9 kill? · not scored" },
    ]);
  });

  it("shows the winner's score and how many won", () => {
    const [top] = buildCs2Feed(input({ rounds: [round(1, "no")], me: { score: 14, rank: 1 }, winners: ["p1", "p2"], won: true, finished: true }));
    expect(top).toEqual({ kind: "event", id: "won", tone: "won", title: "You won", value: "14", detail: "Arena finished · 1 of 2 winners" });
  });

  it("shows a non-winner their place, elimination round and the winners", () => {
    const [top] = buildCs2Feed(input({
      rounds: [round(1, "no")],
      me: { score: 8, rank: 5, eliminatedRound: 13 },
      winners: ["a", "b", "c", "d", "e"],
      finished: true,
    }));
    expect(top).toEqual({
      kind: "event", id: "arena-finished", tone: "lost", title: "Arena finished", value: "5th", detail: "Out in R13 · winners: a, b, c +2",
    });
  });

  it("shows a spectator a neutral finish, with or without a leaderboard", () => {
    expect(buildCs2Feed(input({ winners: ["a"], finished: true }))[0]).toEqual({
      kind: "event", id: "arena-finished", tone: "neutral", title: "Arena finished", detail: "winners: a",
    });
    expect(buildCs2Feed(input({ finished: true }))[0]).toEqual({ kind: "event", id: "arena-finished", tone: "neutral", title: "Arena finished" });
  });

  it("shows a cancelled arena with a readable reason", () => {
    expect(buildCs2Feed(input({ cancelledReason: "series_decided" }))).toEqual([
      { kind: "event", id: "cancelled", tone: "neutral", title: "Arena cancelled", detail: "series decided" },
    ]);
  });

  it("builds the same feed live (player.result) as after a reload (history only)", () => {
    const answers: Array<Answer | undefined> = ["no", "yes", undefined, "no", "no", "no", "no", "yes"];
    const reloaded = answers.map((a, i) => round(i + 1, a));
    const live = answers.map((_, i) => round(i + 1));
    const liveResults: Record<string, Cs2RoundResult> = Object.fromEntries(answers.map((a, i) => [
      `r${i + 1}`,
      a === undefined ? { answer: null, result: "missed", points: 0 }
        : a === "no" ? { answer: a, result: "correct", points: i === 0 ? 2 : 1 }
        : { answer: a, result: "incorrect", points: 0 },
    ]));
    const me = { score: 6, rank: 2, eliminatedRound: 8 };
    expect(buildCs2Feed(input({ rounds: live, liveResults, me }))).toEqual(buildCs2Feed(input({ rounds: reloaded, me })));
  });
});
