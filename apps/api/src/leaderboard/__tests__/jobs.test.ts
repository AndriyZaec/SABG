import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findCurrent: vi.fn(),
  eraseSentTradeUrls: vi.fn(),
  recomputeScope: vi.fn(),
}));

vi.mock("../../db/repositories/leaderboard.repository.js", () => ({
  leaderboardRepository: { findCurrent: mocks.findCurrent, eraseSentTradeUrls: mocks.eraseSentTradeUrls },
}));
vi.mock("../recompute.js", () => ({ recomputeScope: mocks.recomputeScope }));

const { eraseExpiredTradeUrls, recomputeCurrentScope, registerTradeUrlErasureJob } = await import("../jobs.js");

describe("recomputeCurrentScope", () => {
  beforeEach(() => {
    mocks.findCurrent.mockReset();
    mocks.recomputeScope.mockReset().mockResolvedValue(true);
  });

  it("recomputes the current scope", async () => {
    mocks.findCurrent.mockResolvedValue({ id: "scope-1", status: "open", isCurrent: true });
    await recomputeCurrentScope();
    expect(mocks.recomputeScope).toHaveBeenCalledExactlyOnceWith("scope-1");
  });

  it("does nothing without a current scope", async () => {
    mocks.findCurrent.mockResolvedValue(undefined);
    await recomputeCurrentScope();
    expect(mocks.recomputeScope).not.toHaveBeenCalled();
  });
});

describe("trade URL erasure", () => {
  it("erases trade URLs of prizes sent over 30 days before now", async () => {
    mocks.eraseSentTradeUrls.mockReset().mockResolvedValue(2);
    await expect(eraseExpiredTradeUrls(new Date("2026-03-31T03:17:00.000Z"))).resolves.toBe(2);
    expect(mocks.eraseSentTradeUrls).toHaveBeenCalledExactlyOnceWith(new Date("2026-03-01T03:17:00.000Z"));
  });

  it("creates an exclusive queue scheduled daily and works it", async () => {
    const boss = { createQueue: vi.fn(), schedule: vi.fn(), work: vi.fn() };
    await registerTradeUrlErasureJob(boss as unknown as Parameters<typeof registerTradeUrlErasureJob>[0]);
    expect(boss.createQueue).toHaveBeenCalledExactlyOnceWith("leaderboard-trade-url-erasure", { policy: "exclusive" });
    expect(boss.schedule).toHaveBeenCalledExactlyOnceWith("leaderboard-trade-url-erasure", "17 3 * * *");
    expect(boss.work).toHaveBeenCalledExactlyOnceWith("leaderboard-trade-url-erasure", expect.any(Function));
  });
});
