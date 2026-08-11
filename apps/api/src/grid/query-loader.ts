// Loads the Grid.gg GraphQL query body from graphql-schema-request.txt and substitutes the
// configured series id into it. The file's own literal id ("28") is never edited — the
// substitution is pattern-based on the `seriesState(id: "...")` argument so any file content
// works as long as that argument shape is present.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SERIES_ID_PATTERN = /seriesState\(\s*id:\s*"[^"]*"\s*\)/;

let cachedQuery: string | undefined;

/**
 * Reads and caches the query file on first call, substituting `seriesId` into the
 * `seriesState(id: "...")` argument. Throws if the file is missing or the argument pattern
 * isn't found — both are fatal startup errors, not something to poll through.
 */
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

/** Test-only: clears the cache so a test can load a different file/id. */
export function __resetQueryCacheForTests(): void {
  cachedQuery = undefined;
}
