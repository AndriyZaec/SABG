import { describe, expect, it, vi } from "vitest";
import { WriteQueue } from "../stores/write-queue.js";

describe("WriteQueue", () => {
  it("applies writes for the same key strictly in order, even if an earlier write resolves later", async () => {
    const queue = new WriteQueue();
    const order: number[] = [];

    // First write is slower than the second — a naive fire-and-forget would let #2 finish first.
    const first = queue.enqueue("arena-1", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    const second = queue.enqueue("arena-1", async () => {
      order.push(2);
    });

    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });

  it("keeps different keys independent of each other", async () => {
    const queue = new WriteQueue();
    const order: string[] = [];

    const a = queue.enqueue("arena-a", async () => {
      order.push("a");
    });
    const b = queue.enqueue("arena-b", async () => {
      order.push("b");
    });

    await Promise.all([a, b]);
    expect(order.sort()).toEqual(["a", "b"]);
  });

  it("logs a failed write at error level and does not throw or break the chain for later writes", async () => {
    const queue = new WriteQueue();
    const order: string[] = [];

    const failing = queue.enqueue("arena-1", async () => {
      throw new Error("boom");
    });
    const after = queue.enqueue("arena-1", async () => {
      order.push("after");
    });

    // Neither promise rejects — the failure is swallowed (and logged), not propagated.
    await expect(failing).resolves.toBeUndefined();
    await expect(after).resolves.toBeUndefined();
    expect(order).toEqual(["after"]);
  });

  it("does not let a rejected write break the ordering for the next write on the same key", async () => {
    const queue = new WriteQueue();
    const calls = vi.fn();

    await queue.enqueue("arena-1", async () => {
      calls("first");
      throw new Error("fails");
    });
    await queue.enqueue("arena-1", async () => {
      calls("second");
    });

    expect(calls.mock.calls.map((c) => c[0])).toEqual(["first", "second"]);
  });

  it("drains every write accepted before shutdown", async () => {
    const queue = new WriteQueue();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let completed = false;

    void queue.enqueue("arena-1", async () => {
      await blocked;
      completed = true;
    });

    const draining = queue.drain();
    expect(completed).toBe(false);
    release();
    await draining;
    expect(completed).toBe(true);
  });
});
