import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("on-chain contracts runtime export", () => {
  it("loads the Anchor IDL under the production Node ESM runtime", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'const contract = await import("@arena/contracts/onchain"); if (!contract.ARENA_PROGRAM_ID) process.exit(1)',
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
