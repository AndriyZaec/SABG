import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "@arena/contracts";
import { GatewayWebSocketServer } from "../ws.js";
import { issueToken } from "../auth.js";
import type { ArenaRuntime, ArenaRuntimeLike, SubmitAnswerOutcome } from "../arena-runtime.js";

const ARENA_ID = "arena-1";
const OTHER_ARENA_ID = "arena-2";

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number }> {
  return new Promise((resolve) => {
    socket.once("close", (code) => resolve({ code }));
  });
}

function collectMessages(socket: WebSocket): ServerMessage[] {
  const messages: ServerMessage[] = [];
  socket.on("message", (data) => {
    messages.push(JSON.parse(data.toString()) as ServerMessage);
  });
  return messages;
}

function send(socket: WebSocket, message: ClientMessage): void {
  socket.send(JSON.stringify(message));
}

describe("GatewayWebSocketServer", () => {
  let httpServer: HttpServer;
  let gateway: GatewayWebSocketServer;
  let port: number;

  beforeEach(async () => {
    gateway = new GatewayWebSocketServer();
    httpServer = createServer();
    gateway.attach(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  function connect(token: string | undefined): WebSocket {
    const url = token !== undefined ? `ws://localhost:${port}/ws?token=${token}` : `ws://localhost:${port}/ws`;
    return new WebSocket(url);
  }

  it("closes the connection with 4401 when no/invalid token is provided", async () => {
    const socket = connect(undefined);
    const { code } = await waitForClose(socket);
    expect(code).toBe(4401);
  });

  it("closes the connection with 4401 for a tampered token", async () => {
    const socket = connect("garbage.token");
    const { code } = await waitForClose(socket);
    expect(code).toBe(4401);
  });

  it("accepts a connection with a valid token and replays cached state on subscribe", async () => {
    const token = issueToken("user-1");
    const socket = connect(token);
    await waitForOpen(socket);
    const messages = collectMessages(socket);

    gateway.broadcast(ARENA_ID, {
      type: "match.state",
      state: {
        matchId: "m1",
        period: "first_half",
        currentMinute: 10,
        score: { home: 0, away: 0 },
        shots: { home: 0, away: 0 },
        corners: { home: 0, away: 0 },
        cards: { home: 0, away: 0 },
      },
    });
    gateway.broadcast(ARENA_ID, {
      type: "leaderboard.update",
      entries: [{ userId: "user-1", username: "u1", status: "active", score: 0, missedCount: 0, joinedAt: "t" }],
    });

    send(socket, { type: "subscribe", arenaId: ARENA_ID });

    await vi.waitFor(() => {
      expect(messages.length).toBeGreaterThanOrEqual(2);
    });

    expect(messages.some((m) => m.type === "match.state")).toBe(true);
    expect(messages.some((m) => m.type === "leaderboard.update")).toBe(true);

    socket.close();
  });

  it("pushes the subscriber's personal player.pending snapshot from the live runtime on subscribe", async () => {
    const token = issueToken("user-1");
    const socket = connect(token);
    await waitForOpen(socket);
    const messages = collectMessages(socket);

    const pendingPredictionsFor = vi.fn(() => [
      {
        roundId: "r1",
        question: "Next corner before minute 30?",
        windowStartMinute: 25,
        windowEndMinute: 30,
        answer: "yes" as const,
      },
    ]);
    gateway.registerRuntime(ARENA_ID, {
      pendingPredictionsFor,
      statusFor: () => undefined,
    } as unknown as ArenaRuntime);

    send(socket, { type: "subscribe", arenaId: ARENA_ID });

    await vi.waitFor(() => {
      expect(messages.some((m) => m.type === "player.pending")).toBe(true);
    });

    expect(pendingPredictionsFor).toHaveBeenCalledWith("user-1");
    const pendingMsg = messages.find((m) => m.type === "player.pending");
    expect(pendingMsg).toEqual({
      type: "player.pending",
      predictions: [
        {
          roundId: "r1",
          question: "Next corner before minute 30?",
          windowStartMinute: 25,
          windowEndMinute: 30,
          answer: "yes",
        },
      ],
    });

    socket.close();
  });

  it("pushes the subscriber's current status on subscribe (reconnect resync), but nothing when status is unknown", async () => {
    const tokenEliminated = issueToken("user-eliminated");
    const socketEliminated = connect(tokenEliminated);
    await waitForOpen(socketEliminated);
    const messagesEliminated = collectMessages(socketEliminated);

    gateway.registerRuntime(ARENA_ID, {
      pendingPredictionsFor: () => [],
      statusFor: (userId: string) => (userId === "user-eliminated" ? "eliminated" : undefined),
    } as unknown as ArenaRuntime);

    send(socketEliminated, { type: "subscribe", arenaId: ARENA_ID });

    await vi.waitFor(() => {
      expect(messagesEliminated.some((m) => m.type === "player.status")).toBe(true);
    });
    const statusMsg = messagesEliminated.find((m) => m.type === "player.status");
    expect(statusMsg).toEqual({ type: "player.status", status: "eliminated" });

    const tokenUnknown = issueToken("user-unknown");
    const socketUnknown = connect(tokenUnknown);
    await waitForOpen(socketUnknown);
    const messagesUnknown = collectMessages(socketUnknown);
    send(socketUnknown, { type: "subscribe", arenaId: ARENA_ID });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(messagesUnknown.some((m) => m.type === "player.status")).toBe(false);

    socketEliminated.close();
    socketUnknown.close();
  });

  it("a CS2-shaped runtime (no statusFor/pendingPredictionsFor) doesn't crash subscribe and sends neither player.pending nor player.status", async () => {
    const token = issueToken("user-1");
    const socket = connect(token);
    await waitForOpen(socket);
    const messages = collectMessages(socket);

    const cs2LikeRuntime: ArenaRuntimeLike = {
      currentRound: undefined,
      join: vi.fn(),
      submitAnswer: vi.fn(() => ({ ok: true as const, receivedAt: "2024-01-01T00:00:00.000Z" })),
      leaderboardSnapshot: () => [],
      finalWinners: () => undefined,
    };
    gateway.registerRuntime(ARENA_ID, cs2LikeRuntime);

    send(socket, { type: "subscribe", arenaId: ARENA_ID });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(messages.some((m) => m.type === "player.pending")).toBe(false);
    expect(messages.some((m) => m.type === "player.status")).toBe(false);

    socket.close();
  });

  it("caches and replays round.void and arena.cancelled on subscribe (CS2 reconnect resync)", async () => {
    const token = issueToken("user-1");
    const socket = connect(token);
    await waitForOpen(socket);
    const messages = collectMessages(socket);

    gateway.broadcast(ARENA_ID, { type: "round.void", roundId: "r1" });
    gateway.broadcast(ARENA_ID, { type: "arena.cancelled", reason: "no_show" });

    send(socket, { type: "subscribe", arenaId: ARENA_ID });

    await vi.waitFor(() => {
      expect(messages.some((m) => m.type === "arena.cancelled")).toBe(true);
    });
    expect(messages.some((m) => m.type === "round.void")).toBe(true);
    const cancelledMsg = messages.find((m) => m.type === "arena.cancelled");
    expect(cancelledMsg).toEqual({ type: "arena.cancelled", reason: "no_show" });

    socket.close();
  });

  it("only replays the latest round message, not a stale round.open after it locked", async () => {
    const token = issueToken("user-1");
    const socket = connect(token);
    await waitForOpen(socket);
    const messages = collectMessages(socket);

    gateway.broadcast(ARENA_ID, {
      type: "round.open",
      round: {
        id: "r1",
        arenaId: ARENA_ID,
        matchId: "m1",
        discipline: "soccer",
        windowStartMinute: 0,
        windowEndMinute: 5,
        question: "?",
        targetEventType: "shot",
        targetTeam: "any",
        settlementCondition: {
          discipline: "soccer",
          targetEventType: "shot",
          targetTeam: "any",
          windowStartMinute: 0,
          windowEndMinute: 5,
          resolve: "event_in_window",
        },
        status: "open",
      },
      lockAt: "2024-01-01T00:01:00.000Z",
    });
    gateway.broadcast(ARENA_ID, { type: "round.lock", roundId: "r1", aggregate: { yesPct: 50, noPct: 50, total: 2 } });

    send(socket, { type: "subscribe", arenaId: ARENA_ID });

    await vi.waitFor(() => {
      expect(messages.some((m) => m.type === "round.lock")).toBe(true);
    });

    expect(messages.some((m) => m.type === "round.open")).toBe(false);

    socket.close();
  });

  it("isolates broadcasts per arena — a subscriber to arena-2 never sees arena-1's broadcasts", async () => {
    const token = issueToken("user-1");
    const socket = connect(token);
    await waitForOpen(socket);
    const messages = collectMessages(socket);

    send(socket, { type: "subscribe", arenaId: OTHER_ARENA_ID });
    gateway.broadcast(ARENA_ID, {
      type: "leaderboard.update",
      entries: [],
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(messages).toHaveLength(0);

    socket.close();
  });

  it("sendToUser delivers only to the matching userId's connection within an arena", async () => {
    const tokenA = issueToken("user-a");
    const tokenB = issueToken("user-b");
    const socketA = connect(tokenA);
    const socketB = connect(tokenB);
    await Promise.all([waitForOpen(socketA), waitForOpen(socketB)]);
    const messagesA = collectMessages(socketA);
    const messagesB = collectMessages(socketB);

    send(socketA, { type: "subscribe", arenaId: ARENA_ID });
    send(socketB, { type: "subscribe", arenaId: ARENA_ID });
    await new Promise((resolve) => setTimeout(resolve, 50));

    gateway.sendToUser(ARENA_ID, "user-a", { type: "player.status", status: "winner" });

    await vi.waitFor(() => {
      expect(messagesA.some((m) => m.type === "player.status")).toBe(true);
    });
    expect(messagesB.some((m) => m.type === "player.status")).toBe(false);

    socketA.close();
    socketB.close();
  });

  it("forwards an 'answer' client message to the subscribed arena's runtime.submitAnswer", async () => {
    const token = issueToken("user-1");
    const socket = connect(token);
    await waitForOpen(socket);
    const messages = collectMessages(socket);

    const submitAnswer = vi.fn<(userId: string, roundId: string, answer: string) => SubmitAnswerOutcome>(() => ({
      ok: true,
      receivedAt: "2024-01-01T00:00:00.000Z",
    }));
    gateway.registerRuntime(ARENA_ID, {
      submitAnswer,
      pendingPredictionsFor: () => [],
      statusFor: () => undefined,
    } as unknown as ArenaRuntime);

    send(socket, { type: "subscribe", arenaId: ARENA_ID });
    await new Promise((resolve) => setTimeout(resolve, 50));
    send(socket, { type: "answer", roundId: "round-1", answer: "yes" });

    await vi.waitFor(() => {
      expect(submitAnswer).toHaveBeenCalledWith("user-1", "round-1", "yes");
    });
    await vi.waitFor(() => {
      expect(messages).toContainEqual({
        type: "answer.accepted",
        roundId: "round-1",
        answer: "yes",
        receivedAt: "2024-01-01T00:00:00.000Z",
      });
    });

    socket.close();
  });

  it("rejects an 'answer' sent before subscribing (no arena context yet)", async () => {
    const token = issueToken("user-1");
    const socket = connect(token);
    await waitForOpen(socket);
    const messages = collectMessages(socket);

    const submitAnswer = vi.fn();
    gateway.registerRuntime(ARENA_ID, {
      submitAnswer,
      pendingPredictionsFor: () => [],
      statusFor: () => undefined,
    } as unknown as ArenaRuntime);

    send(socket, { type: "answer", roundId: "round-1", answer: "yes" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(submitAnswer).not.toHaveBeenCalled();
    expect(messages).toContainEqual({
      type: "answer.rejected",
      roundId: "round-1",
      answer: "yes",
      reason: "not_subscribed",
    });
    socket.close();
  });
});
