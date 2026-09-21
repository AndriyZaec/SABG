import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
  listForUser: vi.fn(),
  deleteByEndpoint: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: { sendNotification: mocks.sendNotification, setVapidDetails: mocks.setVapidDetails },
}));

vi.mock("../config/env.js", () => ({
  pushConfig: { configured: true, publicKey: "pub", privateKey: "priv", subject: "mailto:dev@example.com" },
}));

vi.mock("../../db/repositories/push-subscription.repository.js", () => ({
  pushSubscriptionRepository: { listForUser: mocks.listForUser, deleteByEndpoint: mocks.deleteByEndpoint },
}));

vi.mock("../../grid/logger.js", () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger };
  return { logger };
});

import { sendPushToUser } from "../service.js";

const SUBSCRIPTION = { id: "sub-1", userId: "user-1", endpoint: "https://push.example/1", p256dh: "p", auth: "a" };

describe("sendPushToUser", () => {
  beforeEach(() => {
    mocks.sendNotification.mockReset();
    mocks.listForUser.mockReset();
    mocks.deleteByEndpoint.mockReset();
  });

  it("sends a push to every subscription for the user", async () => {
    mocks.listForUser.mockResolvedValue([SUBSCRIPTION]);
    mocks.sendNotification.mockResolvedValue(undefined);

    await sendPushToUser("user-1", { title: "Map is live", body: "Jump in now", url: "/cs2/arena/abc" });

    expect(mocks.sendNotification).toHaveBeenCalledWith(
      { endpoint: SUBSCRIPTION.endpoint, keys: { p256dh: "p", auth: "a" } },
      JSON.stringify({ title: "Map is live", body: "Jump in now", url: "/cs2/arena/abc" }),
    );
  });

  it("deletes a subscription that the push service reports as gone (410)", async () => {
    mocks.listForUser.mockResolvedValue([SUBSCRIPTION]);
    mocks.sendNotification.mockRejectedValue({ statusCode: 410 });

    await sendPushToUser("user-1", { title: "t", body: "b", url: "/u" });

    expect(mocks.deleteByEndpoint).toHaveBeenCalledWith(SUBSCRIPTION.endpoint);
  });

  it("does not delete the subscription on a non-gone error", async () => {
    mocks.listForUser.mockResolvedValue([SUBSCRIPTION]);
    mocks.sendNotification.mockRejectedValue({ statusCode: 500 });

    await sendPushToUser("user-1", { title: "t", body: "b", url: "/u" });

    expect(mocks.deleteByEndpoint).not.toHaveBeenCalled();
  });
});
