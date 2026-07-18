import { describe, expect, it } from "vitest";

import { describeDatabase, parseReplayResetRequest } from "../replay-reset-config.js";

const safeEnv = {
  GAME_SOURCE: "replay",
  SOLANA_NETWORK: "devnet",
  DATABASE_URL: "postgres://arena:secret@localhost:5433/arena",
};
const confirmedArgs = ["--force", "--confirm-database=localhost:5433/arena"];

describe("parseReplayResetRequest", () => {
  it("requires explicit replay/devnet mode and force confirmation", () => {
    expect(() => parseReplayResetRequest(["node", "reset-replay", ...confirmedArgs], {})).toThrow(
      "GAME_SOURCE=replay",
    );
    expect(() =>
      parseReplayResetRequest(["node", "reset-replay", ...confirmedArgs], {
        GAME_SOURCE: "replay",
        SOLANA_NETWORK: "mainnet-beta",
        DATABASE_URL: safeEnv.DATABASE_URL,
      }),
    ).toThrow("SOLANA_NETWORK=devnet");
    expect(() => parseReplayResetRequest(["node", "reset-replay"], safeEnv)).toThrow("--force");
  });

  it("only accepts allowlisted fixtures", () => {
    expect(parseReplayResetRequest(["node", "reset-replay", "18179764", ...confirmedArgs], safeEnv)).toEqual({
      fixtureId: 18179764,
      database: "localhost:5433/arena",
      requireEmptyOffchain: false,
    });
    expect(() =>
      parseReplayResetRequest(["node", "reset-replay", "18257739", ...confirmedArgs], safeEnv),
    ).toThrow("not resettable");
  });

  it("parses the deployment-only empty off-chain guard", () => {
    expect(
      parseReplayResetRequest(
        ["node", "reset-replay", "18241006", ...confirmedArgs, "--require-empty-offchain"],
        safeEnv,
      ),
    ).toEqual({
      fixtureId: 18241006,
      database: "localhost:5433/arena",
      requireEmptyOffchain: true,
    });
  });

  it("requires confirmation of the redacted database identity", () => {
    expect(() => parseReplayResetRequest(["node", "reset-replay", "--force"], safeEnv)).toThrow(
      "--confirm-database=localhost:5433/arena",
    );
  });

  it("redacts credentials from the audit database identity", () => {
    expect(describeDatabase("postgres://arena:secret@db.example.test:5433/arena")).toBe(
      "db.example.test:5433/arena",
    );
  });
});
