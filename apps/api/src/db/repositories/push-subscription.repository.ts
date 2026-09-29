import { and, count, eq } from "drizzle-orm";
import type { Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { pushSubscriptions, users } from "../schema.js";

const MAX_SUBSCRIPTIONS_PER_USER = 5;

export class PushSubscriptionConflictError extends Error {}
export class PushSubscriptionLimitError extends Error {}

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
    await db.transaction(async (tx) => {
      const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
      if (!user) throw new Error(`User ${userId} not found while saving push subscription`);

      const [existing] = await tx
        .select({ userId: pushSubscriptions.userId })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, input.endpoint));
      if (existing) {
        if (existing.userId !== userId) throw new PushSubscriptionConflictError("Push endpoint belongs to another user");
        await tx
          .update(pushSubscriptions)
          .set({ p256dh: input.p256dh, auth: input.auth })
          .where(eq(pushSubscriptions.endpoint, input.endpoint));
        return;
      }

      const [subscriptionCount] = await tx
        .select({ value: count() })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId));
      if ((subscriptionCount?.value ?? 0) >= MAX_SUBSCRIPTIONS_PER_USER) {
        throw new PushSubscriptionLimitError("Push subscription limit reached");
      }

      const [inserted] = await tx
        .insert(pushSubscriptions)
        .values({ userId, ...input })
        .onConflictDoNothing({ target: pushSubscriptions.endpoint })
        .returning({ userId: pushSubscriptions.userId });
      if (inserted) return;

      const [owner] = await tx
        .select({ userId: pushSubscriptions.userId })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, input.endpoint));
      if (owner?.userId !== userId) throw new PushSubscriptionConflictError("Push endpoint belongs to another user");
    });
  },

  async listForUser(userId: Uuid): Promise<PushSubscriptionRow[]> {
    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    return rows.map((row) => ({ id: row.id, userId: row.userId, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }));
  },

  async deleteByEndpoint(endpoint: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  },

  async deleteIfUnchanged(subscription: PushSubscriptionRow): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, subscription.userId)).for("update");
      await tx
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.id, subscription.id),
            eq(pushSubscriptions.userId, subscription.userId),
            eq(pushSubscriptions.endpoint, subscription.endpoint),
            eq(pushSubscriptions.p256dh, subscription.p256dh),
            eq(pushSubscriptions.auth, subscription.auth),
          ),
        );
    });
  },
};
