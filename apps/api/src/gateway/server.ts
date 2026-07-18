// The real Realtime Gateway + REST API server, replacing the mock
// (apps/api/src/mock/server.ts). Same stack/shape as the mock (express + cors + ws on one
// node:http server) so the wire contract pinned by apps/web/vite.config.ts (REST at /api, WS at
// /ws) is unchanged — only what's behind it is now real.

import { createServer, type Server as HttpServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import type { RuntimeConfigResponse } from "@arena/contracts";
import { checkDatabaseConnection } from "../db/client.js";
import { gatewayConfig } from "./config.js";
import { createRestRouter } from "./rest.js";
import { GatewayWebSocketServer } from "./ws.js";
import { createEventAccess, type EventAccessOptions } from "./event-access.js";

export interface GatewayServer {
  httpServer: HttpServer;
  wsGateway: GatewayWebSocketServer;
}

export interface GatewayServerOptions {
  healthCheck?: () => Promise<void>;
  webDistDir?: string;
  runtimeConfig?: RuntimeConfigResponse;
  eventAccess?: EventAccessOptions;
}

export function createGatewayServer(options: GatewayServerOptions = {}): GatewayServer {
  const healthCheck = options.healthCheck ?? checkDatabaseConnection;
  const webDistDir = options.webDistDir ?? gatewayConfig.web.distDir;
  const runtimeConfig = options.runtimeConfig ?? gatewayConfig.runtime;
  const eventAccess = createEventAccess(
    options.eventAccess ?? {
      codeHash: gatewayConfig.eventAccess.codeHash,
      sessionSecret: gatewayConfig.auth.secret,
      secureCookies: gatewayConfig.eventAccess.secureCookies,
    },
  );
  const wsGateway = new GatewayWebSocketServer(eventAccess.authorizeWebSocket);

  const app = express();
  app.set("trust proxy", 1);
  app.use(cors({ origin: gatewayConfig.cors.origins }));
  app.use(express.json());
  app.get("/healthz", async (_req, res) => {
    try {
      await healthCheck();
      res.status(200).json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.use("/api/access", eventAccess.router);
  app.use("/api", eventAccess.requireAccess);
  app.get("/api/runtime-config", (_req, res) => res.json(runtimeConfig));
  // wsGateway also implements ArenaRuntimeLookup — REST and WS share the one runtime registry
  // (see arena-runtime.ts's doc comment on that interface).
  app.use("/api", createRestRouter(wsGateway));

  if (webDistDir !== undefined) {
    const indexPath = path.join(webDistDir, "index.html");
    if (!existsSync(indexPath)) {
      throw new Error(`Web production build not found at ${indexPath}`);
    }
    app.use(express.static(webDistDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api") || req.path.startsWith("/ws")) {
        next();
        return;
      }
      res.sendFile(indexPath);
    });
  }

  const httpServer = createServer(app);
  wsGateway.attach(httpServer);

  return { httpServer, wsGateway };
}
