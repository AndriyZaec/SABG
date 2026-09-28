import { eq } from "drizzle-orm";
import type { Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { pushSubscriptions } from "../schema.js";

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionRow {
  id: Uuid;
  userId: Uuid;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export const pushSubscriptionRepository = {
  async upsert(userId: Uuid, input: PushSubscriptionInput): Promise<void> {
    await db
      .insert(pushSubscriptions)
      .values({ userId, ...input })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, p256dh: input.p256dh, auth: input.auth },
      });
  },

  async listForUser(userId: Uuid): Promise<PushSubscriptionRow[]> {
    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    return rows.map((row) => ({ id: row.id, userId: row.userId, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }));
  },

  async deleteByEndpoint(endpoint: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  },
};
