import { describe, expect, it } from "vitest";
import { renderQuestion } from "../templates.js";

describe("renderQuestion", () => {
  it("uses the real team name when provided, for a team-specific question", () => {
    const question = renderQuestion("shot", "home", 10, 15, { home: "England", away: "Argentina" });
    expect(question).toBe("Will the England team have a shot between 10:00 and 15:00?");
  });

  it("uses the away team's real name too", () => {
    const question = renderQuestion("goal", "away", 20, 25, { home: "England", away: "Argentina" });
    expect(question).toBe("Will the Argentina team score between 20:00 and 25:00?");
  });

  it("falls back to Home/Away labels when no team names are supplied", () => {
    expect(renderQuestion("card", "home", 0, 5)).toBe("Will the Home team receive a card between 0:00 and 5:00?");
    expect(renderQuestion("card", "away", 0, 5)).toBe("Will the Away team receive a card between 0:00 and 5:00?");
  });

  it("ignores teamNames for an 'any' question — no {team} placeholder to fill", () => {
    const question = renderQuestion("corner", "any", 0, 5, { home: "England", away: "Argentina" });
    expect(question).toBe("Will there be a corner between 0:00 and 5:00?");
  });
});
