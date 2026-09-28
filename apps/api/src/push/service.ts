import webpush from "web-push";
import type { Uuid } from "@arena/contracts";
import { pushConfig } from "./config/env.js";
import { pushSubscriptionRepository } from "../db/repositories/push-subscription.repository.js";
import { logger } from "../grid/logger.js";
import { validatePushSubscription } from "./subscription-validation.js";

const PUSH_CONCURRENCY = 3;
const PUSH_TIMEOUT_MS = 5_000;
let activePushes = 0;
const pushWaiters: Array<() => void> = [];

async function withPushSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activePushes >= PUSH_CONCURRENCY) {
    await new Promise<void>((resolve) => pushWaiters.push(resolve));
  } else {
    activePushes += 1;
  }
  try {
    return await task();
  } finally {
    const next = pushWaiters.shift();
    if (next) next();
    else activePushes -= 1;
  }
}

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
  for (let offset = 0; offset < subscriptions.length; offset += PUSH_CONCURRENCY) {
    await Promise.all(
      subscriptions.slice(offset, offset + PUSH_CONCURRENCY).map(async (sub) => {
        const validationError = validatePushSubscription(sub);
        if (validationError) {
          logger.warn({ userId, validationError }, "push: removing invalid subscription");
          await pushSubscriptionRepository.deleteIfUnchanged(sub);
          return;
        }

        try {
          await withPushSlot(() =>
            webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify(payload),
              { TTL: 60, timeout: PUSH_TIMEOUT_MS },
            ),
          );
        } catch (err) {
          if (isGoneStatus(err)) {
            await pushSubscriptionRepository.deleteIfUnchanged(sub);
            return;
          }
          logger.error({ err, userId }, "push: send failed");
        }
      }),
    );
  }
}
