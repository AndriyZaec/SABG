import { describe, expect, it } from "vitest";
import { parseCatalogTournamentIds } from "../catalog-config.js";

describe("parseCatalogTournamentIds", () => {
  it("normalizes and deduplicates configured IDs", () => {
    expect(parseCatalogTournamentIds("blast-1, blast-2,blast-1")).toEqual(["blast-1", "blast-2"]);
  });

  it("fails closed when no tournaments are configured", () => {
    expect(parseCatalogTournamentIds(undefined)).toEqual([]);
    expect(parseCatalogTournamentIds("  ")).toEqual([]);
  });

  it("rejects empty list entries", () => {
    expect(() => parseCatalogTournamentIds("blast-1,,blast-2")).toThrow("without empty IDs");
  });
});
