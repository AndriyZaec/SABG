// Mock server entrypoint — Express (REST, /api/*) + ws (WS, /ws), matching the
// contract pinned by apps/web/vite.config.ts. Run via `pnpm dev:api` (root) or
// `pnpm --filter @arena/api dev`. Stand-in for the real Realtime Gateway + REST API.

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";

import { handleClientMessage, startMockTimeline } from "./timeline.js";
import { isMockArenaReadyForTimeline, mockRouter } from "./routes.js";
import type { EventAccessSessionResponse } from "@arena/contracts";

const PORT = Number(process.env["MOCK_PORT"] ?? 4000);

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/mock-assets", express.static(fileURLToPath(new URL("./assets", import.meta.url))));
app.get("/api/access/session", (_req, res) => {
  const response: EventAccessSessionResponse = { status: "not_required" };
  res.json(response);
});
app.post("/api/access/session", (_req, res) => {
  const response: EventAccessSessionResponse = { status: "not_required" };
  res.json(response);
});
app.delete("/api/access/session", (_req, res) => res.status(204).end());
app.use("/api", mockRouter);

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (socket) => {
  let stopTimeline: (() => void) | undefined;
  let waitForLive: ReturnType<typeof setInterval> | undefined;
  socket.on("message", (data) => handleClientMessage(socket, data.toString(), (arenaId) => {
    stopTimeline?.();
    stopTimeline = undefined;
    if (waitForLive !== undefined) clearInterval(waitForLive);
    const startWhenReady = () => {
      if (!isMockArenaReadyForTimeline(arenaId)) return;
      if (waitForLive !== undefined) clearInterval(waitForLive);
      waitForLive = undefined;
      stopTimeline = startMockTimeline(socket, arenaId);
    };
    startWhenReady();
    if (!stopTimeline) waitForLive = setInterval(startWhenReady, 250);
  }));
  socket.on("close", () => {
    if (waitForLive !== undefined) clearInterval(waitForLive);
    stopTimeline?.();
  });
});

httpServer.listen(PORT, () => {
  console.log(`[mock] REST http://localhost:${PORT}/api`);
  console.log(`[mock] WS   ws://localhost:${PORT}/ws`);
});
