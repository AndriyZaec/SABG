import { describe, expect, it } from "vitest";
import {
  arenaPlayerRowToEntity,
  arenaRowToEntity,
  entryPassRowToEntity,
  matchRowToEntity,
  predictionRoundRowToEntity,
  predictionRowToEntity,
  userRowToEntity,
} from "../mappers.js";

describe("userRowToEntity", () => {
  it("maps a row without an avatar, omitting the optional field", () => {
    const entity = userRowToEntity({
      id: "u1",
      walletAddress: "wallet1",
      username: "alice",
      avatar: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(entity).toEqual({ id: "u1", walletAddress: "wallet1", username: "alice" });
  });

  it("includes avatar when present", () => {
    const entity = userRowToEntity({
      id: "u1",
      walletAddress: "wallet1",
      username: "alice",
      avatar: "http://a.png",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(entity.avatar).toBe("http://a.png");
  });
});

describe("matchRowToEntity", () => {
  it("splits scoreHome/scoreAway into a Score object and stringifies startTime", () => {
    const startTime = new Date("2024-01-01T00:00:00.000Z");
    const entity = matchRowToEntity({
      id: "m1",
      discipline: "soccer",
      txoddsFixtureId: 123,
      seriesId: null,
      seriesMatchIndex: null,
      homeTeam: "A",
      awayTeam: "B",
      startTime,
      status: "live",
      currentMinute: 12,
      period: "first_half",
      scoreHome: 1,
      scoreAway: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(entity).toEqual({
      id: "m1",
      discipline: "soccer",
      homeTeam: "A",
      awayTeam: "B",
      startTime: startTime.toISOString(),
      status: "live",
      currentMinute: 12,
      period: "first_half",
      score: { home: 1, away: 2 },
    });
  });

  it("hydrates a CS2 match from identity-keyed team scores", () => {
    const startTime = new Date("2024-01-01T00:00:00.000Z");
    const entity = matchRowToEntity(
      {
        id: "m1",
        discipline: "cs2",
        txoddsFixtureId: null,
        seriesId: "series-1",
        seriesMatchIndex: 2,
        homeTeam: null,
        awayTeam: null,
        startTime,
        status: "live",
        currentMinute: 0,
        period: "pre",
        scoreHome: null,
        scoreAway: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      [
        { teamId: "team-a", name: "A", score: 7, displayOrder: 1 },
        { teamId: "team-b", name: "B", score: 5, displayOrder: 2 },
      ],
    );

    expect(entity).toEqual({
      id: "m1",
      discipline: "cs2",
      seriesId: "series-1",
      seriesMatchIndex: 2,
      startTime: startTime.toISOString(),
      status: "live",
      teamScores: [
        { teamId: "team-a", name: "A", score: 7 },
        { teamId: "team-b", name: "B", score: 5 },
      ],
    });
  });

  it("rejects a CS2 match without exactly two ordered team scores", () => {
    expect(() =>
      matchRowToEntity(
        {
          id: "m1",
          discipline: "cs2",
          txoddsFixtureId: null,
          seriesId: "series-1",
          seriesMatchIndex: 1,
          homeTeam: null,
          awayTeam: null,
          startTime: new Date(),
          status: "scheduled",
          currentMinute: 0,
          period: "pre",
          scoreHome: null,
          scoreAway: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        [{ teamId: "team-a", name: "A", score: 0, displayOrder: 1 }],
      ),
    ).toThrow("does not have a complete team score pair");
  });
});

describe("arenaRowToEntity", () => {
  it("maps every field 1:1", () => {
    const entity = arenaRowToEntity({
      id: "a1",
      matchId: "m1",
      status: "live",
      activePlayersCount: 5,
      entryFeeLamports: 1000,
      prizePoolLamports: 5000,
      escrowAccount: "Escrow111",
      onchainArenaId: 42,
      cancelledReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(entity).toEqual({
      id: "a1",
      matchId: "m1",
      status: "live",
      activePlayersCount: 5,
      entryFeeLamports: 1000,
      prizePoolLamports: 5000,
      escrowAccount: "Escrow111",
      onchainArenaId: 42,
    });
  });
});

describe("entryPassRowToEntity", () => {
  it("stringifies purchasedAt", () => {
    const purchasedAt = new Date("2024-02-01T00:00:00.000Z");
    const entity = entryPassRowToEntity({
      id: "e1",
      arenaId: "a1",
      userId: "u1",
      walletAddress: "wallet1",
      amountLamports: 100,
      txSignature: "sig1",
      status: "paid",
      purchasedAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(entity).toEqual({
      id: "e1",
      arenaId: "a1",
      userId: "u1",
      walletAddress: "wallet1",
      amountLamports: 100,
      txSignature: "sig1",
      status: "paid",
      purchasedAt: purchasedAt.toISOString(),
    });
  });
});

describe("predictionRoundRowToEntity", () => {
  it("omits nullable lifecycle fields when null", () => {
    const entity = predictionRoundRowToEntity({
      id: "r1",
      arenaId: "a1",
      matchId: "m1",
      discipline: "soccer",
      windowStartMinute: 20,
      windowEndMinute: 25,
      roundNumber: null,
      question: "Will there be a shot?",
      targetEventType: "shot",
      targetTeam: "home",
      settlementCondition: {
        discipline: "soccer",
        targetEventType: "shot",
        targetTeam: "home",
        windowStartMinute: 20,
        windowEndMinute: 25,
        resolve: "event_in_window",
      },
      status: "pending",
      correctAnswer: null,
      openedAt: null,
      lockedAt: null,
      settledAt: null,
      settledBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(entity).toEqual({
      id: "r1",
      arenaId: "a1",
      matchId: "m1",
      discipline: "soccer",
      windowStartMinute: 20,
      windowEndMinute: 25,
      question: "Will there be a shot?",
      targetEventType: "shot",
      targetTeam: "home",
      settlementCondition: {
        discipline: "soccer",
        targetEventType: "shot",
        targetTeam: "home",
        windowStartMinute: 20,
        windowEndMinute: 25,
        resolve: "event_in_window",
      },
      status: "pending",
    });
  });

  it("includes lifecycle fields, stringified, when present", () => {
    const openedAt = new Date("2024-01-01T00:00:00.000Z");
    const lockedAt = new Date("2024-01-01T00:01:00.000Z");
    const settledAt = new Date("2024-01-01T00:02:00.000Z");
    const entity = predictionRoundRowToEntity({
      id: "r1",
      arenaId: "a1",
      matchId: "m1",
      discipline: "soccer",
      windowStartMinute: 20,
      windowEndMinute: 25,
      roundNumber: null,
      question: "Will there be a shot?",
      targetEventType: "shot",
      targetTeam: "home",
      settlementCondition: {
        discipline: "soccer",
        targetEventType: "shot",
        targetTeam: "home",
        windowStartMinute: 20,
        windowEndMinute: 25,
        resolve: "event_in_window",
      },
      status: "settled",
      correctAnswer: "yes",
      openedAt,
      lockedAt,
      settledAt,
      settledBy: "early",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(entity.correctAnswer).toBe("yes");
    expect(entity.openedAt).toBe(openedAt.toISOString());
    expect(entity.lockedAt).toBe(lockedAt.toISOString());
    expect(entity.settledAt).toBe(settledAt.toISOString());
    expect(entity.settledBy).toBe("early");
  });
});

describe("arenaPlayerRowToEntity", () => {
  it("omits eliminatedRoundId when null", () => {
    const joinedAt = new Date("2024-01-01T00:00:00.000Z");
    const entity = arenaPlayerRowToEntity({
      id: "p1",
      arenaId: "a1",
      userId: "u1",
      status: "active",
      score: 3,
      joinedAt,
      eliminatedRoundId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(entity).toEqual({
      id: "p1",
      arenaId: "a1",
      userId: "u1",
      status: "active",
      score: 3,
      joinedAt: joinedAt.toISOString(),
    });
  });

  it("includes eliminatedRoundId when present", () => {
    const entity = arenaPlayerRowToEntity({
      id: "p1",
      arenaId: "a1",
      userId: "u1",
      status: "eliminated",
      score: 1,
      joinedAt: new Date(),
      eliminatedRoundId: "r1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(entity.eliminatedRoundId).toBe("r1");
  });
});

describe("predictionRowToEntity", () => {
  it("omits result when null", () => {
    const answeredAt = new Date("2024-01-01T00:00:00.000Z");
    const receivedAt = new Date("2024-01-01T00:00:01.000Z");
    const entity = predictionRowToEntity({
      id: "pr1",
      roundId: "r1",
      userId: "u1",
      answer: "yes",
      answeredAt,
      receivedAt,
      result: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(entity).toEqual({
      id: "pr1",
      roundId: "r1",
      userId: "u1",
      answer: "yes",
      answeredAt: answeredAt.toISOString(),
      receivedAt: receivedAt.toISOString(),
    });
  });

  it("includes result when present", () => {
    const entity = predictionRowToEntity({
      id: "pr1",
      roundId: "r1",
      userId: "u1",
      answer: "yes",
      answeredAt: new Date(),
      receivedAt: new Date(),
      result: "correct",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(entity.result).toBe("correct");
  });
});
