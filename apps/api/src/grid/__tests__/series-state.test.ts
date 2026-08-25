import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasGraphQLErrors, hasLiveGame, isFreshStart, SeriesStateResponseSchema } from "../series-state.js";

const exampleResponse = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "..", "response-graphql-example.json"), "utf8"),
) as unknown;

describe("series-state predicates", () => {
  it("reads the example response (in-game round score [8,11], one live game) as not a fresh start but with a live game", () => {
    const parsed = SeriesStateResponseSchema.parse(exampleResponse);
    expect(isFreshStart(parsed)).toBe(false);
    expect(hasLiveGame(parsed)).toBe(true);
    expect(hasGraphQLErrors(parsed)).toBe(false);
  });

  it("detects a fresh 0-0 start from the live game's round score", () => {
    const parsed = SeriesStateResponseSchema.parse({
      data: {
        seriesState: {
          teams: [
            { name: "A", won: false, score: 1 },
            { name: "B", won: false, score: 0 },
          ],
          games: [
            {
              teams: [
                { name: "A", score: 0 },
                { name: "B", score: 0 },
              ],
            },
          ],
        },
      },
    });
    expect(isFreshStart(parsed)).toBe(true);
  });

  it("is not a fresh start when there is no live game, even if the series score is 0-0", () => {
    const parsed = SeriesStateResponseSchema.parse({
      data: {
        seriesState: {
          teams: [
            { name: "A", score: 0 },
            { name: "B", score: 0 },
          ],
          games: [],
        },
      },
    });
    expect(isFreshStart(parsed)).toBe(false);
  });

  it("treats an empty games array as no live game", () => {
    const parsed = SeriesStateResponseSchema.parse({
      data: { seriesState: { teams: [{ score: 1 }, { score: 0 }], games: [] } },
    });
    expect(hasLiveGame(parsed)).toBe(false);
  });

  it("flags GraphQL-level errors", () => {
    const parsed = SeriesStateResponseSchema.parse({ data: null, errors: [{ message: "boom" }] });
    expect(hasGraphQLErrors(parsed)).toBe(true);
  });
});
