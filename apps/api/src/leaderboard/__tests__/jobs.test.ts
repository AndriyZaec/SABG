import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findCurrent: vi.fn(),
  recomputeScope: vi.fn(),
}));

vi.mock("../../db/repositories/leaderboard.repository.js", () => ({ leaderboardRepository: { findCurrent: mocks.findCurrent } }));
vi.mock("../recompute.js", () => ({ recomputeScope: mocks.recomputeScope }));

const { recomputeCurrentScope } = await import("../jobs.js");

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
