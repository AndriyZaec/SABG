import webpush from "web-push";
import type { Uuid } from "@arena/contracts";
import { pushConfig } from "./config/env.js";
import { pushSubscriptionRepository } from "../db/repositories/push-subscription.repository.js";
import { logger } from "../grid/logger.js";

if (pushConfig.configured) {
  webpush.setVapidDetails(pushConfig.subject, pushConfig.publicKey, pushConfig.privateKey);
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

function isGoneStatus(err: unknown): boolean {
  return typeof err === "object" && err !== null && "statusCode" in err && (err.statusCode === 404 || err.statusCode === 410);
}

export async function sendPushToUser(userId: Uuid, payload: PushPayload): Promise<void> {
  if (!pushConfig.configured) {
    logger.warn({ userId }, "push: VAPID not configured — skipping send");
    return;
  }

  const subscriptions = await pushSubscriptionRepository.listForUser(userId);
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
      } catch (err) {
        if (isGoneStatus(err)) {
          await pushSubscriptionRepository.deleteByEndpoint(sub.endpoint);
          return;
        }
        logger.error({ err, userId }, "push: send failed");
      }
    }),
  );
}
