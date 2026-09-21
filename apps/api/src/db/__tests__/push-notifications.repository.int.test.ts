import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

describe.skipIf(!RUN)("push subscription + cs2 series follow repositories (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../client.js")["db"];
  let schema: typeof import("../schema.js");
  let pushSubscriptionRepository: typeof import("../repositories/push-subscription.repository.js")["pushSubscriptionRepository"];
  let cs2SeriesFollowRepository: typeof import("../repositories/cs2-series-follow.repository.js")["cs2SeriesFollowRepository"];

  const runId = randomUUID();
  const walletAddress = `push-test-wallet-${runId}`;
  const gridSeriesId = `push-test-series-${runId}`;
  let userId: string;
  let seriesId: string;

  beforeAll(async () => {
    ({ db } = await import("../client.js"));
    schema = await import("../schema.js");
    ({ pushSubscriptionRepository } = await import("../repositories/push-subscription.repository.js"));
    ({ cs2SeriesFollowRepository } = await import("../repositories/cs2-series-follow.repository.js"));

    const [user] = await db.insert(schema.users).values({ walletAddress, username: "push-test" }).returning();
    userId = user!.id;
    const [series] = await db
      .insert(schema.series)
      .values({ gridSeriesId, format: 3, scheduledStartTime: new Date(), status: "active" })
      .returning();
    seriesId = series!.id;
  });

  afterAll(async () => {
    if (db === undefined) return;
    await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId));
    await db.delete(schema.cs2SeriesFollows).where(eq(schema.cs2SeriesFollows.userId, userId));
    await db.delete(schema.series).where(inArray(schema.series.id, [seriesId]));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("upserts a push subscription by endpoint and lists it for the user", async () => {
    const endpoint = `https://push.example/${runId}`;
    await pushSubscriptionRepository.upsert(userId, { endpoint, p256dh: "p256dh-1", auth: "auth-1" });

    let rows = await pushSubscriptionRepository.listForUser(userId);
    expect(rows).toEqual([expect.objectContaining({ userId, endpoint, p256dh: "p256dh-1", auth: "auth-1" })]);

    // Re-subscribing the same browser (same endpoint) updates in place, not a duplicate row.
    await pushSubscriptionRepository.upsert(userId, { endpoint, p256dh: "p256dh-2", auth: "auth-2" });
    rows = await pushSubscriptionRepository.listForUser(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ p256dh: "p256dh-2", auth: "auth-2" }));

    await pushSubscriptionRepository.deleteByEndpoint(endpoint);
    rows = await pushSubscriptionRepository.listForUser(userId);
    expect(rows).toEqual([]);
  });

  it("follows a series idempotently and lists follower user ids", async () => {
    await cs2SeriesFollowRepository.follow(userId, seriesId);
    await cs2SeriesFollowRepository.follow(userId, seriesId); // repeat call is a no-op, not an error

    const followers = await cs2SeriesFollowRepository.listFollowerUserIds(seriesId);
    expect(followers).toEqual([userId]);
  });
});
