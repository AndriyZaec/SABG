import { createECDH } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
  listForUser: vi.fn(),
  deleteByEndpoint: vi.fn(),
  deleteIfUnchanged: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: { sendNotification: mocks.sendNotification, setVapidDetails: mocks.setVapidDetails },
}));

vi.mock("../config/env.js", () => ({
  pushConfig: { configured: true, publicKey: "pub", privateKey: "priv", subject: "mailto:dev@example.com" },
}));

vi.mock("../../db/repositories/push-subscription.repository.js", () => ({
  pushSubscriptionRepository: {
    listForUser: mocks.listForUser,
    deleteByEndpoint: mocks.deleteByEndpoint,
    deleteIfUnchanged: mocks.deleteIfUnchanged,
  },
}));

vi.mock("../../grid/logger.js", () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger };
  return { logger };
});

import { sendPushToUser } from "../service.js";

const pushKey = createECDH("prime256v1");
pushKey.setPrivateKey(Buffer.alloc(32, 1));

const SUBSCRIPTION = {
  id: "sub-1",
  userId: "user-1",
  endpoint: "https://fcm.googleapis.com/fcm/send/1",
  p256dh: pushKey.getPublicKey().toString("base64url"),
  auth: Buffer.alloc(16).toString("base64url"),
};

describe("sendPushToUser", () => {
  beforeEach(() => {
    mocks.sendNotification.mockReset();
    mocks.listForUser.mockReset();
    mocks.deleteByEndpoint.mockReset();
    mocks.deleteIfUnchanged.mockReset();
  });

  it("sends a push to every subscription for the user", async () => {
    mocks.listForUser.mockResolvedValue([SUBSCRIPTION]);
    mocks.sendNotification.mockResolvedValue(undefined);

    await sendPushToUser("user-1", { title: "Map is live", body: "Jump in now", url: "/cs2/arena/abc" });

    expect(mocks.sendNotification).toHaveBeenCalledWith(
      { endpoint: SUBSCRIPTION.endpoint, keys: { p256dh: SUBSCRIPTION.p256dh, auth: SUBSCRIPTION.auth } },
      JSON.stringify({ title: "Map is live", body: "Jump in now", url: "/cs2/arena/abc" }),
      { TTL: 60, timeout: 5_000 },
    );
  });

  it("deletes a subscription that the push service reports as gone (410)", async () => {
    mocks.listForUser.mockResolvedValue([SUBSCRIPTION]);
    mocks.sendNotification.mockRejectedValue({ statusCode: 410 });

    await sendPushToUser("user-1", { title: "t", body: "b", url: "/u" });

    expect(mocks.deleteIfUnchanged).toHaveBeenCalledWith(SUBSCRIPTION);
  });

  it("does not delete the subscription on a non-gone error", async () => {
    mocks.listForUser.mockResolvedValue([SUBSCRIPTION]);
    mocks.sendNotification.mockRejectedValue({ statusCode: 500 });

    await sendPushToUser("user-1", { title: "t", body: "b", url: "/u" });

    expect(mocks.deleteIfUnchanged).not.toHaveBeenCalled();
  });
});
