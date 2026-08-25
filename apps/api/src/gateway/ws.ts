import type { IncomingMessage } from "node:http";
import type { Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  Answer,
  ArenaCancelledMessage,
  ArenaFinishedMessage,
  ClientMessage,
  LeaderboardMessage,
  MatchStateMessage,
  RoundLockMessage,
  RoundOpenMessage,
  RoundSettleMessage,
  RoundVoidMessage,
  ServerMessage,
  Uuid,
} from "@arena/contracts";
import { authenticateWsUrl } from "./auth.js";
import { logger } from "./logger.js";
import type { ArenaRuntimeLike, ArenaRuntimeLookup, GatewayBroadcaster } from "./arena-runtime.js";
import type { EventAccessAuthorization } from "./event-access.js";

interface Connection {
  socket: WebSocket;
  userId: Uuid;
  arenaId: Uuid | undefined;
}

// Public state is cached per arena for reconnect reconciliation.
interface ArenaCache {
  matchState?: MatchStateMessage;
  // Cache only the latest round transition so reconnects never replay stale state.
  round?: RoundOpenMessage | RoundLockMessage | RoundSettleMessage | RoundVoidMessage;
  leaderboard?: LeaderboardMessage;
  finished?: ArenaFinishedMessage;
  cancelled?: ArenaCancelledMessage;
}

export class GatewayWebSocketServer implements GatewayBroadcaster, ArenaRuntimeLookup {
  private wss: WebSocketServer | undefined;
  private httpServer: HttpServer | undefined;
  private upgradeHandler: ((request: IncomingMessage, socket: Duplex, head: Buffer) => void) | undefined;
  private readonly runtimes = new Map<Uuid, ArenaRuntimeLike>();
  private readonly connectionsByArena = new Map<Uuid, Set<Connection>>();
  private readonly cacheByArena = new Map<Uuid, ArenaCache>();

  constructor(
    private readonly authorizeAccess: (request: IncomingMessage) => EventAccessAuthorization = () => ({ authorized: true }),
  ) {}

  registerRuntime(arenaId: Uuid, runtime: ArenaRuntimeLike): void {
    this.runtimes.set(arenaId, runtime);
  }

  getRuntime(arenaId: Uuid): ArenaRuntimeLike | undefined {
    return this.runtimes.get(arenaId);
  }

  attach(server: HttpServer): void {
    if (this.wss !== undefined) throw new Error("WebSocket gateway is already attached");
    const wss = new WebSocketServer({ noServer: true });
    const upgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (pathname !== "/ws") {
        rejectUpgrade(socket, 404, "Not Found");
        return;
      }
      const access = this.authorizeAccess(request);
      if (!access.authorized) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      wss.handleUpgrade(request, socket, head, (webSocket) => {
        this.handleConnection(webSocket, request, access.expiresAt);
      });
    };
    this.wss = wss;
    this.httpServer = server;
    this.upgradeHandler = upgradeHandler;
    server.on("upgrade", upgradeHandler);
  }

  async close(): Promise<void> {
    const wss = this.wss;
    if (wss === undefined) return;
    this.wss = undefined;
    if (this.httpServer !== undefined && this.upgradeHandler !== undefined) {
      this.httpServer.off("upgrade", this.upgradeHandler);
    }
    this.httpServer = undefined;
    this.upgradeHandler = undefined;
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    this.connectionsByArena.clear();
  }

  private handleConnection(socket: WebSocket, req: IncomingMessage, accessExpiresAt?: number): void {
    const expiryTimer = accessExpiresAt === undefined
      ? undefined
      : setTimeout(() => socket.close(4403, "event access expired"), Math.max(0, accessExpiresAt - Date.now()));
    const userId = authenticateWsUrl(req.url);
    if (userId === undefined) {
      socket.close(4401, "unauthorized");
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
      return;
    }

    const conn: Connection = { socket, userId, arenaId: undefined };
    socket.on("message", (data) => this.handleMessage(conn, data.toString()));
    socket.on("close", () => {
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
      this.removeConnection(conn);
    });
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

  private handleAnswer(conn: Connection, roundId: Uuid, answer: Answer): void {
    if (conn.arenaId === undefined) {
      this.send(conn, { type: "answer.rejected", roundId, answer, reason: "not_subscribed" });
      return;
    }
    const runtime = this.runtimes.get(conn.arenaId);
    if (runtime === undefined) {
      this.send(conn, { type: "answer.rejected", roundId, answer, reason: "arena_not_found" });
      return;
    }

    const outcome = runtime.submitAnswer(conn.userId, roundId, answer);
    if (outcome.ok) {
      this.send(conn, { type: "answer.accepted", roundId, answer, receivedAt: outcome.receivedAt });
    } else {
      this.send(conn, { type: "answer.rejected", roundId, answer, reason: outcome.reason });
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
    if (cache !== undefined) {
      if (cache.matchState !== undefined) this.send(conn, cache.matchState);
      if (cache.round !== undefined) this.send(conn, cache.round);
      if (cache.leaderboard !== undefined) this.send(conn, cache.leaderboard);
      if (cache.finished !== undefined) this.send(conn, cache.finished);
      if (cache.cancelled !== undefined) this.send(conn, cache.cancelled);
    }

    // Read personal state fresh per subscriber; never place it in the shared arena cache.
    const runtime = this.runtimes.get(arenaId);
    let answerRoundId = runtime?.currentRound?.id;
    if (cache?.round?.type === "round.open") answerRoundId = cache.round.round.id;
    if (cache?.round?.type === "round.lock") answerRoundId = cache.round.roundId;
    if (runtime?.answerFor !== undefined && answerRoundId !== undefined) {
      const answer = runtime.answerFor(conn.userId, answerRoundId);
      this.send(conn, { type: "answer.snapshot", roundId: answerRoundId, answer: answer ?? null });
    }
    if (runtime?.pendingPredictionsFor !== undefined) {
      this.send(conn, { type: "player.pending", predictions: runtime.pendingPredictionsFor(conn.userId) });
    }
    if (runtime?.statusFor !== undefined) {
      // Restore status on reconnect so eliminated players cannot answer again.
      const status = runtime.statusFor(conn.userId);
      if (status !== undefined) this.send(conn, { type: "player.status", status });
    }
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
      case "round.void":
        cache.round = message;
        break;
      case "leaderboard.update":
        cache.leaderboard = message;
        break;
      case "arena.finished":
        cache.finished = message;
        break;
      case "arena.cancelled":
        cache.cancelled = message;
        break;
      case "player.status":
      case "player.pending":
        break; // Personal messages must never enter the shared cache.
    }
  }
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
