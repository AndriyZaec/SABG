import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import { z } from "zod";
import { logger } from "../gateway/logger.js";
import type { OperatorControlService, OperatorIdentity } from "./service.js";

const GridIdSchema = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/u);
const MutationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("autopilot.set"), enabled: z.boolean() }),
  z.object({ type: z.literal("series.priority.set"), gridSeriesId: GridIdSchema, priority: z.boolean() }),
  z.object({ type: z.literal("series.stream.set"), gridSeriesId: GridIdSchema, streamUrl: z.string().max(500).nullable() }),
  z.object({ type: z.literal("series.skip.request"), gridSeriesId: GridIdSchema }),
  z.object({ type: z.literal("tournament.publish"), gridTournamentId: GridIdSchema, gridSeriesId: GridIdSchema }),
]);
const ActorIdSchema = z.string().trim().min(1).max(100);
const ActorLoginSchema = z.string().trim().min(1).max(100);
const AuditCursorSchema = z.tuple([z.string().datetime(), z.string().uuid()]);

function tokensMatch(supplied: string | undefined, expected: string): boolean {
  if (supplied === undefined || !supplied.startsWith("Bearer ")) return false;
  const suppliedHash = createHash("sha256").update(supplied.slice(7)).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedHash, expectedHash);
}

function actorFrom(request: Request): OperatorIdentity | undefined {
  const id = ActorIdSchema.safeParse(request.get("x-operator-id"));
  const login = ActorLoginSchema.safeParse(request.get("x-operator-login"));
  return id.success && login.success ? { id: id.data, login: login.data } : undefined;
}

function auditCursor(value: unknown): { createdAt: Date; id: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Invalid audit cursor");
  try {
    const parsed = AuditCursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return { createdAt: new Date(parsed[0]), id: parsed[1] };
  } catch {
    throw new Error("Invalid audit cursor");
  }
}

export function createOperatorControlServer(options: {
  machineToken: string;
  service: OperatorControlService;
}): HttpServer {
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.setHeader("cache-control", "no-store");
    if (!tokensMatch(request.get("authorization"), options.machineToken)) {
      response.status(401).json({ error: "unauthorized", message: "Valid machine token required" });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "16kb" }));

  app.get("/status", async (_request, response) => {
    response.json(await options.service.status());
  });
  app.get("/catalog", async (_request, response) => {
    response.json(await options.service.catalog());
  });
  app.get("/discovery", async (_request, response) => {
    response.json(await options.service.discover());
  });
  app.get("/series/:gridSeriesId", async (request, response) => {
    const parsed = GridIdSchema.safeParse(request.params.gridSeriesId);
    if (!parsed.success) {
      response.status(400).json({ error: "bad_request", message: "GRID Series ID is invalid" });
      return;
    }
    response.json(await options.service.inspect(parsed.data));
  });
  app.get("/audit", async (request, response) => {
    try {
      const actorId = request.query.actorId;
      const from = request.query.from;
      const to = request.query.to;
      const parsedActor = actorId === undefined ? undefined : ActorIdSchema.parse(actorId);
      const parsedFrom = from === undefined ? undefined : new Date(z.string().datetime().parse(from));
      const parsedTo = to === undefined ? undefined : new Date(z.string().datetime().parse(to));
      response.json(await options.service.audits({
        ...(parsedActor !== undefined ? { actorId: parsedActor } : {}),
        ...(parsedFrom !== undefined ? { from: parsedFrom } : {}),
        ...(parsedTo !== undefined ? { to: parsedTo } : {}),
        ...(request.query.cursor !== undefined ? { cursor: auditCursor(request.query.cursor)! } : {}),
      }));
    } catch {
      response.status(400).json({ error: "bad_request", message: "Audit filters are invalid" });
    }
  });
  app.post("/mutations", async (request, response) => {
    const command = MutationSchema.safeParse(request.body);
    const actor = actorFrom(request);
    const suppliedRequestId = request.get("x-request-id");
    const requestId = suppliedRequestId === undefined ? randomUUID() : z.string().uuid().safeParse(suppliedRequestId).data;
    if (!command.success || actor === undefined || requestId === undefined) {
      response.status(400).json({ error: "bad_request", message: "Mutation request is invalid" });
      return;
    }
    response.setHeader("x-request-id", requestId);
    const execution = await options.service.mutate(command.data, actor, requestId);
    response.status(execution.conflict === true ? 409 : 200).json(execution.result);
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    logger.error({ err: error }, "operator control request failed");
    response.status(500).json({ error: "internal_error", message: "Control request failed" });
  });

  return createServer(app);
}
