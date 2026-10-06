import { fileURLToPath } from "node:url";
import type { Express } from "express";
import express from "express";

export async function attachAdminFrontend(app: Express, environment: string | undefined): Promise<void> {
  if (environment === "development") {
    const { createServer } = await import("vite");
    const vite = await createServer({
      appType: "spa",
      root: fileURLToPath(new URL("../../", import.meta.url)),
      server: { middlewareMode: true },
    });
    app.use(vite.middlewares);
    return;
  }

  const clientRoot = fileURLToPath(new URL("../client/", import.meta.url));
  app.use(express.static(clientRoot, { index: false, immutable: true, maxAge: "1y" }));
  app.use((request, response, next) => {
    if (request.method !== "GET" || !request.accepts("html")) {
      next();
      return;
    }
    response.setHeader("cache-control", "no-cache");
    response.sendFile("index.html", { root: clientRoot });
  });
}
