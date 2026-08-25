import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetQueryCacheForTests, loadSeriesStateQuery } from "../query-loader.js";

describe("loadSeriesStateQuery", () => {
  beforeEach(() => {
    __resetQueryCacheForTests();
  });

  it("substitutes the configured series id into the seriesState(id: ...) argument, leaving the rest byte-identical", () => {
    const dir = mkdtempSync(join(tmpdir(), "grid-query-"));
    const file = join(dir, "query.txt");
    const original = 'query GetLiveCsSeriesState {\n  seriesState(id: "28") {\n    valid\n  }\n}';
    writeFileSync(file, original, "utf8");

    const result = loadSeriesStateQuery(file, "999");

    expect(result).toBe('query GetLiveCsSeriesState {\n  seriesState(id: "999") {\n    valid\n  }\n}');
  });

  it("caches the loaded query across calls", () => {
    const dir = mkdtempSync(join(tmpdir(), "grid-query-"));
    const file = join(dir, "query.txt");
    writeFileSync(file, 'seriesState(id: "28") { valid }', "utf8");

    const first = loadSeriesStateQuery(file, "42");
    const second = loadSeriesStateQuery(file, "different");

    expect(second).toBe(first);
    expect(second).toContain('id: "42"');
  });

  it("throws when the file is missing", () => {
    expect(() => loadSeriesStateQuery("/nonexistent/query.txt", "28")).toThrow(/Failed to read/);
  });

  it("throws when the file has no seriesState(id: ...) argument", () => {
    const dir = mkdtempSync(join(tmpdir(), "grid-query-"));
    const file = join(dir, "query.txt");
    writeFileSync(file, "query { somethingElse { valid } }", "utf8");

    expect(() => loadSeriesStateQuery(file, "28")).toThrow(/does not contain/);
  });
});
