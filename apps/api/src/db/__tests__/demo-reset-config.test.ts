import { describe, expect, it } from "vitest";

import { describeDatabase, parseDemoResetRequest } from "../demo-reset-config.js";

const safeEnv = {
  DEPLOYMENT_ENV: "demo",
  SOLANA_NETWORK: "devnet",
  DATABASE_URL: "postgres://arena:secret@localhost:5433/arena",
};
const confirmedArgs = ["--force", "--confirm-database=localhost:5433/arena"];

describe("parseDemoResetRequest", () => {
  it("requires explicit demo/devnet mode and force confirmation", () => {
    expect(() => parseDemoResetRequest(["node", "reset-demo", ...confirmedArgs], {})).toThrow(
      "DEPLOYMENT_ENV=demo",
    );
    expect(() =>
      parseDemoResetRequest(["node", "reset-demo", ...confirmedArgs], {
        DEPLOYMENT_ENV: "demo",
        SOLANA_NETWORK: "mainnet-beta",
        DATABASE_URL: safeEnv.DATABASE_URL,
      }),
    ).toThrow("SOLANA_NETWORK=devnet");
    expect(() => parseDemoResetRequest(["node", "reset-demo"], safeEnv)).toThrow("--force");
  });

  it("only accepts allowlisted fixtures", () => {
    expect(parseDemoResetRequest(["node", "reset-demo", "18179764", ...confirmedArgs], safeEnv)).toEqual({
      fixtureId: 18179764,
      database: "localhost:5433/arena",
    });
    expect(() =>
      parseDemoResetRequest(["node", "reset-demo", "18257739", ...confirmedArgs], safeEnv),
    ).toThrow("not resettable");
  });

  it("requires confirmation of the redacted database identity", () => {
    expect(() => parseDemoResetRequest(["node", "reset-demo", "--force"], safeEnv)).toThrow(
      "--confirm-database=localhost:5433/arena",
    );
  });

  it("redacts credentials from the audit database identity", () => {
    expect(describeDatabase("postgres://arena:secret@db.example.test:5433/arena")).toBe(
      "db.example.test:5433/arena",
    );
  });
});
