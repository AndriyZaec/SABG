import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "@arena/contracts";
import type { Cs2SeriesSnapshot } from "../series-snapshot.js";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function collectMessages(socket: WebSocket): ServerMessage[] {
  const messages: ServerMessage[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
  return messages;
}

function send(socket: WebSocket, message: ClientMessage): void {
  socket.send(JSON.stringify(message));
}

function snapshot(hasLiveGame: boolean): Cs2SeriesSnapshot {
  return {
    format: 3,
    finished: false,
    hasLiveGame,
    teams: [
      { teamId: "team-a", name: "Team A", score: 0, won: false },
      { teamId: "team-b", name: "Team B", score: 0, won: false },
    ],
  };
}

describe.skipIf(!RUN)("CS2 live gateway wiring (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../../db/client.js")["db"];
  let schema: typeof import("../../db/schema.js");
  let seriesRepository: typeof import("../../db/repositories/series.repository.js")["seriesRepository"];
  let arenaRepository: typeof import("../../db/repositories/arena.repository.js")["arenaRepository"];
  let matchRepository: typeof import("../../db/repositories/match.repository.js")["matchRepository"];
  let WriteQueue: typeof import("../../gateway/stores/write-queue.js")["WriteQueue"];
  let Cs2SeriesOrchestrator: typeof import("../series-orchestrator.js")["Cs2SeriesOrchestrator"];
  let GatewayWebSocketServer: typeof import("../../gateway/ws.js")["GatewayWebSocketServer"];
  let issueToken: typeof import("../../gateway/auth.js")["issueToken"];

  const seriesIds: string[] = [];
  const matchIds: string[] = [];
  const arenaIds: string[] = [];
  let httpServer: HttpServer;
  let sockets: WebSocket[] = [];

  beforeAll(async () => {
    ({ db } = await import("../../db/client.js"));
    schema = await import("../../db/schema.js");
    ({ seriesRepository } = await import("../../db/repositories/series.repository.js"));
    ({ arenaRepository } = await import("../../db/repositories/arena.repository.js"));
    ({ matchRepository } = await import("../../db/repositories/match.repository.js"));
    ({ WriteQueue } = await import("../../gateway/stores/write-queue.js"));
    ({ Cs2SeriesOrchestrator } = await import("../series-orchestrator.js"));
    ({ GatewayWebSocketServer } = await import("../../gateway/ws.js"));
    ({ issueToken } = await import("../../gateway/auth.js"));
  });

  afterEach(async () => {
    for (const socket of sockets) socket.close();
    sockets = [];
    if (httpServer?.listening) await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  afterAll(async () => {
    if (db === undefined) return;
    for (const arenaId of arenaIds) {
      await db.delete(schema.predictionRounds).where(eq(schema.predictionRounds.arenaId, arenaId));
      await db.delete(schema.arenas).where(eq(schema.arenas.id, arenaId));
    }
    for (const matchId of matchIds) await db.delete(schema.matches).where(eq(schema.matches.id, matchId));
    for (const seriesId of seriesIds) await db.delete(schema.series).where(eq(schema.series.id, seriesId));
  });

  it("registers a freshly-opened CS2 arena's runtime on the WS gateway, and a subscribing client receives round.open over the real transport", async () => {
    const gridSeriesId = `int-test-${randomUUID()}`;
    const start = new Date();
    const series = await seriesRepository.upsertByGridSeriesId(gridSeriesId, { format: 3, scheduledStartTime: start });
    seriesIds.push(series.id);

    const gateway = new GatewayWebSocketServer();
    httpServer = createServer();
    gateway.attach(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;

    const writeQueue = new WriteQueue();
    const orchestrator = await Cs2SeriesOrchestrator.create(series, {
      writeQueue,
      entryFeeLamports: 1000,
      broadcaster: gateway,
      onArenaOpened: (arenaId, runtime) => gateway.registerRuntime(arenaId, runtime),
    });

    const tenMinutesLater = new Date(start.getTime() + 10 * 60_000).toISOString();
    await orchestrator.poll(snapshot(false), tenMinutesLater);

    const match = (await matchRepository.list()).find((m) => m.seriesId === series.id)!;
    matchIds.push(match.id);
    const arena = await arenaRepository.findByMatchId(match.id);
    arenaIds.push(arena!.id);
    expect(gateway.getRuntime(arena!.id)).toBeDefined();

    const token = issueToken("live-gateway-test-user");
    const socket = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);
    sockets.push(socket);
    await waitForOpen(socket);
    const messages = collectMessages(socket);

    send(socket, { type: "subscribe", arenaId: arena!.id });

    await new Promise<void>((resolve) => {
      const check = () => {
        if (messages.some((m) => m.type === "round.open")) resolve();
        else setTimeout(check, 20);
      };
      check();
    });

    const openMsg = messages.find((m) => m.type === "round.open");
    if (openMsg?.type === "round.open") {
      expect(openMsg.round.roundNumber).toBe(1);
      expect(openMsg.lockAt).toBeUndefined();
    } else {
      throw new Error("expected a round.open message");
    }
  });
});
