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
      txoddsFixtureId: 123,
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
      homeTeam: "A",
      awayTeam: "B",
      startTime: startTime.toISOString(),
      status: "live",
      currentMinute: 12,
      period: "first_half",
      score: { home: 1, away: 2 },
    });
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
      windowStartMinute: 20,
      windowEndMinute: 25,
      question: "Will there be a shot?",
      targetEventType: "shot",
      targetTeam: "home",
      settlementCondition: {
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
      windowStartMinute: 20,
      windowEndMinute: 25,
      question: "Will there be a shot?",
      targetEventType: "shot",
      targetTeam: "home",
      settlementCondition: {
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
      windowStartMinute: 20,
      windowEndMinute: 25,
      question: "Will there be a shot?",
      targetEventType: "shot",
      targetTeam: "home",
      settlementCondition: {
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
