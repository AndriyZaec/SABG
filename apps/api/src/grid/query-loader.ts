import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SERIES_ID_PATTERN = /seriesState\(\s*id:\s*"[^"]*"\s*\)/;

let cachedQuery: string | undefined;

/** Query-file failures are startup errors, not transient poll failures. */
export function loadSeriesStateQuery(queryFilePath: string, seriesId: string): string {
  if (cachedQuery === undefined) {
    const absolutePath = resolve(queryFilePath);
    let raw: string;
    try {
      raw = readFileSync(absolutePath, "utf8");
    } catch (err) {
      throw new Error(`Failed to read GraphQL query file at ${absolutePath}: ${(err as Error).message}`);
    }

    if (!SERIES_ID_PATTERN.test(raw)) {
      throw new Error(`GraphQL query file at ${absolutePath} does not contain a seriesState(id: "...") argument`);
    }

    cachedQuery = raw.replace(SERIES_ID_PATTERN, `seriesState(id: "${seriesId}")`);
  }
  return cachedQuery;
}

export function __resetQueryCacheForTests(): void {
  cachedQuery = undefined;
}
