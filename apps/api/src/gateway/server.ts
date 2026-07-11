// The real Realtime Gateway + REST API server, replacing the mock
// (apps/api/src/mock/server.ts). Same stack/shape as the mock (express + cors + ws on one
// node:http server) so the wire contract pinned by apps/web/vite.config.ts (REST at /api, WS at
// /ws) is unchanged — only what's behind it is now real.

import { createServer, type Server as HttpServer } from "node:http";
import cors from "cors";
import express from "express";
import { gatewayConfig } from "./config.js";
import { createRestRouter } from "./rest.js";
import { GatewayWebSocketServer } from "./ws.js";

export interface GatewayServer {
  httpServer: HttpServer;
  wsGateway: GatewayWebSocketServer;
}

export function createGatewayServer(): GatewayServer {
  const wsGateway = new GatewayWebSocketServer();

  const app = express();
  app.use(cors({ origin: gatewayConfig.cors.origins }));
  app.use(express.json());
  // wsGateway also implements ArenaRuntimeLookup — REST and WS share the one runtime registry
  // (see arena-runtime.ts's doc comment on that interface).
  app.use("/api", createRestRouter(wsGateway));

  const httpServer = createServer(app);
  wsGateway.attach(httpServer);

  return { httpServer, wsGateway };
}
