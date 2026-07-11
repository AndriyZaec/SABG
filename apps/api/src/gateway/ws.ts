// Realtime Gateway's WS server. Implements `GatewayBroadcaster` (arena-runtime.ts) so it can
// be constructed *before* any ArenaRuntime (the runtime is handed `this` as its broadcaster);
// looks runtimes up by arenaId to route inbound `ClientMessage`s (subscribe/answer).
//
// Reconnect resync (spec §9): the mock explicitly ignores `subscribe` (single-arena fixture, no
// real resync need). Here `subscribe` actually matters — a client (re)joining mid-arena needs the
// current match/round/leaderboard state, not just future pushes. This gateway caches the latest
// resyncable message per arena as it broadcasts, and replays that cache to a socket on subscribe.

import type { IncomingMessage } from "node:http";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  Answer,
  ArenaFinishedMessage,
  ClientMessage,
  LeaderboardMessage,
  MatchStateMessage,
  RoundLockMessage,
  RoundOpenMessage,
  RoundSettleMessage,
  ServerMessage,
  Uuid,
} from "@arena/contracts";
import { authenticateWsUrl } from "./auth.js";
import { logger } from "./logger.js";
import type { ArenaRuntime, ArenaRuntimeLookup, GatewayBroadcaster } from "./arena-runtime.js";

interface Connection {
  socket: WebSocket;
  userId: Uuid;
  arenaId: Uuid | undefined;
}

/** Last-known state per arena, replayed to a socket on `subscribe` (spec §9 resync). */
interface ArenaCache {
  matchState?: MatchStateMessage;
  /** Whichever of open/lock/settle was broadcast most recently — lets a reconnecting client's own
   *  state machine pick up wherever the round currently is, rather than replaying a stale open. */
  round?: RoundOpenMessage | RoundLockMessage | RoundSettleMessage;
  leaderboard?: LeaderboardMessage;
  finished?: ArenaFinishedMessage;
}

export class GatewayWebSocketServer implements GatewayBroadcaster, ArenaRuntimeLookup {
  private readonly runtimes = new Map<Uuid, ArenaRuntime>();
  private readonly connectionsByArena = new Map<Uuid, Set<Connection>>();
  private readonly cacheByArena = new Map<Uuid, ArenaCache>();

  /** Called once per arena as its ArenaRuntime is constructed (this gateway is its broadcaster). */
  registerRuntime(arenaId: Uuid, runtime: ArenaRuntime): void {
    this.runtimes.set(arenaId, runtime);
  }

  /** ArenaRuntimeLookup — shared with rest.ts so both sit on the one registry (see arena-runtime.ts). */
  getRuntime(arenaId: Uuid): ArenaRuntime | undefined {
    return this.runtimes.get(arenaId);
  }

  attach(server: HttpServer): void {
    const wss = new WebSocketServer({ server, path: "/ws" });
    wss.on("connection", (socket, req) => this.handleConnection(socket, req));
  }

  private handleConnection(socket: WebSocket, req: IncomingMessage): void {
    const userId = authenticateWsUrl(req.url);
    if (userId === undefined) {
      socket.close(4401, "unauthorized");
      return;
    }

    const conn: Connection = { socket, userId, arenaId: undefined };
    socket.on("message", (data) => this.handleMessage(conn, data.toString()));
    socket.on("close", () => this.removeConnection(conn));
  }

  private handleMessage(conn: Connection, raw: string): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case "subscribe":
        this.handleSubscribe(conn, message.arenaId);
        break;
      case "answer":
        this.handleAnswer(conn, message.roundId, message.answer);
        break;
    }
  }

  /**
   * Answering over WS is the equivalent of REST POST /rounds/:id/answer (ws.ts contract doc
   * comment) — both funnel into the same `ArenaRuntime.submitAnswer`. No ack message exists in
   * the `ServerMessage` catalog (mirrors the mock, which also just logs); a client that wants
   * confirmation uses the REST endpoint, which does return one.
   */
  private handleAnswer(conn: Connection, roundId: Uuid, answer: Answer): void {
    if (conn.arenaId === undefined) return; // must subscribe before answering
    const runtime = this.runtimes.get(conn.arenaId);
    if (runtime === undefined) return;

    const outcome = runtime.submitAnswer(conn.userId, roundId, answer);
    if (!outcome.ok) {
      logger.debug({ userId: conn.userId, roundId, reason: outcome.reason }, "ws answer rejected");
    }
  }

  private handleSubscribe(conn: Connection, arenaId: Uuid): void {
    conn.arenaId = arenaId;
    let conns = this.connectionsByArena.get(arenaId);
    if (conns === undefined) {
      conns = new Set();
      this.connectionsByArena.set(arenaId, conns);
    }
    conns.add(conn);

    const cache = this.cacheByArena.get(arenaId);
    if (cache === undefined) return;
    if (cache.matchState !== undefined) this.send(conn, cache.matchState);
    if (cache.round !== undefined) this.send(conn, cache.round);
    if (cache.leaderboard !== undefined) this.send(conn, cache.leaderboard);
    if (cache.finished !== undefined) this.send(conn, cache.finished);
  }

  private removeConnection(conn: Connection): void {
    if (conn.arenaId === undefined) return;
    this.connectionsByArena.get(conn.arenaId)?.delete(conn);
  }

  private send(conn: Connection, message: ServerMessage): void {
    if (conn.socket.readyState === conn.socket.OPEN) {
      conn.socket.send(JSON.stringify(message));
    }
  }

  broadcast(arenaId: Uuid, message: ServerMessage): void {
    this.updateCache(arenaId, message);
    const conns = this.connectionsByArena.get(arenaId);
    if (conns === undefined) return;
    for (const conn of conns) this.send(conn, message);
  }

  sendToUser(arenaId: Uuid, userId: Uuid, message: ServerMessage): void {
    const conns = this.connectionsByArena.get(arenaId);
    if (conns === undefined) return;
    for (const conn of conns) {
      if (conn.userId === userId) this.send(conn, message);
    }
  }

  private updateCache(arenaId: Uuid, message: ServerMessage): void {
    let cache = this.cacheByArena.get(arenaId);
    if (cache === undefined) {
      cache = {};
      this.cacheByArena.set(arenaId, cache);
    }
    switch (message.type) {
      case "match.state":
        cache.matchState = message;
        break;
      case "round.open":
      case "round.lock":
      case "round.settle":
        cache.round = message;
        break;
      case "leaderboard.update":
        cache.leaderboard = message;
        break;
      case "arena.finished":
        cache.finished = message;
        break;
      case "player.status":
        break; // personal — never cached/replayed generically.
    }
  }
}
