import type { AdminMutationCommand, OperatorAuditDetails, OperatorAuditEntry, OperatorAuditResult } from "@arena/contracts";
import { and, desc, eq, gt, lt, or } from "drizzle-orm";
import { db } from "../client.js";
import { operatorAudits } from "../schema.js";

export interface AppendOperatorAudit {
  actorId: string;
  actorLogin: string;
  action: AdminMutationCommand["type"];
  targetId?: string;
  result: OperatorAuditResult;
  requestId: string;
  details?: OperatorAuditDetails;
}

export interface ListOperatorAudits {
  actorId?: string;
  from?: Date;
  to?: Date;
  cursor?: { createdAt: Date; id: string };
  limit?: number;
}

export const operatorAuditRepository = {
  async append(input: AppendOperatorAudit): Promise<OperatorAuditEntry> {
    const details = input.details ?? {};
    if (Buffer.byteLength(JSON.stringify(details), "utf8") > 2_048) throw new Error("Operator audit details exceed 2048 bytes");
    const [row] = await db.insert(operatorAudits).values({
      actorId: input.actorId,
      actorLogin: input.actorLogin,
      action: input.action,
      ...(input.targetId !== undefined ? { targetId: input.targetId } : {}),
      result: input.result,
      requestId: input.requestId,
      details,
    }).returning();
    if (row === undefined) throw new Error("Operator audit insert returned no row");
    const { targetId, ...entry } = row;
    return {
      ...entry,
      createdAt: row.createdAt.toISOString(),
      ...(targetId !== null ? { targetId } : {}),
    };
  },

  async list(input: ListOperatorAudits = {}): Promise<OperatorAuditEntry[]> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 50);
    const cursorCondition = input.cursor === undefined
      ? undefined
      : or(
          lt(operatorAudits.createdAt, input.cursor.createdAt),
          and(eq(operatorAudits.createdAt, input.cursor.createdAt), lt(operatorAudits.id, input.cursor.id)),
        );
    const rows = await db.select().from(operatorAudits).where(and(
      input.actorId === undefined ? undefined : eq(operatorAudits.actorId, input.actorId),
      input.from === undefined ? undefined : gt(operatorAudits.createdAt, input.from),
      input.to === undefined ? undefined : lt(operatorAudits.createdAt, input.to),
      cursorCondition,
    )).orderBy(desc(operatorAudits.createdAt), desc(operatorAudits.id)).limit(limit);
    return rows.map((row) => {
      const { targetId, ...entry } = row;
      return {
        ...entry,
        createdAt: row.createdAt.toISOString(),
        ...(targetId !== null ? { targetId } : {}),
      };
    });
  },
};
