// Mock server entrypoint — Express (REST, /api/*) + ws (WS, /ws), matching the
// contract pinned by apps/web/vite.config.ts. Run via `pnpm dev:api` (root) or
// `pnpm --filter @arena/api dev`. Stand-in for the real Realtime Gateway + REST API.

import { createServer } from "node:http";

import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";

import { handleClientMessage, startMockTimeline } from "./timeline.js";
import { mockRouter } from "./routes.js";
import type { EventAccessSessionResponse } from "@arena/contracts";

const PORT = Number(process.env["MOCK_PORT"] ?? 4000);

const app = express();
app.use(cors());
app.use(express.json());
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
  const stop = startMockTimeline(socket);
  socket.on("message", (data) => handleClientMessage(socket, data.toString()));
  socket.on("close", stop);
});

httpServer.listen(PORT, () => {
  console.log(`[mock] REST http://localhost:${PORT}/api`);
  console.log(`[mock] WS   ws://localhost:${PORT}/ws`);
});
