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

  it("reads the file once but substitutes each call's series id", () => {
    const dir = mkdtempSync(join(tmpdir(), "grid-query-"));
    const file = join(dir, "query.txt");
    writeFileSync(file, 'seriesState(id: "28") { valid }', "utf8");

    const first = loadSeriesStateQuery(file, "42");
    writeFileSync(file, 'seriesState(id: "28") { changed }', "utf8");
    const second = loadSeriesStateQuery(file, "77");

    expect(first).toBe('seriesState(id: "42") { valid }');
    expect(second).toBe('seriesState(id: "77") { valid }');
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
