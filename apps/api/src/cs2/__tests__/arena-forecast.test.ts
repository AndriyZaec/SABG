import { describe, expect, it } from "vitest";
import { expectedSeriesDurationMs, forecastArenas } from "../arena-forecast.js";
import type { Cs2SeriesCandidate } from "../next-series.js";

const NOW = "2026-10-04T12:00:00.000Z";

function at(time: string): string {
  return `2026-10-04T${time}:00.000Z`;
}

function series(seriesId: string, start: string, overrides: Partial<Cs2SeriesCandidate> = {}): Cs2SeriesCandidate {
  return {
    seriesId,
    scheduledStartTime: at(start),
    priority: false,
    followerCount: 0,
    selectable: true,
    status: "active",
    hasArena: false,
    skipRequested: false,
    format: 3,
    ...overrides,
  };
}

describe("expectedSeriesDurationMs", () => {
  it.each([
    [1, 90],
    [3, 240],
    [5, 360],
    [2, 180],
  ])("Bo%i takes %i min", (format, minutes) => {
    expect(expectedSeriesDurationMs(format)).toBe(minutes * 60_000);
  });
});

describe("forecastArenas", () => {
  it("expects the priority series of two simultaneous ones and not the other", () => {
    const forecast = forecastArenas([series("plain", "14:00", { followerCount: 9 }), series("priority", "14:00", { priority: true })], NOW);
    expect(Object.fromEntries(forecast)).toEqual({ priority: "expected", plain: "unlikely" });
  });

  it("drops a series starting inside a Bo3's expected four hours and expects the one after", () => {
    const forecast = forecastArenas([series("bo3", "16:00"), series("overlap", "18:00"), series("after", "20:30")], NOW);
    expect(Object.fromEntries(forecast)).toEqual({ bo3: "expected", overlap: "unlikely", after: "expected" });
  });

  it("keeps a running series running and makes the ones it overlaps unlikely", () => {
    const forecast = forecastArenas(
      [series("running", "11:00", { hasArena: true }), series("overlap", "13:00"), series("after", "15:30")],
      NOW,
    );
    expect(Object.fromEntries(forecast)).toEqual({ running: "running", overlap: "unlikely", after: "expected" });
  });

  it("treats a running series past its expected end as holding the slot until now", () => {
    const forecast = forecastArenas(
      [series("long", "07:00", { hasArena: true }), series("late", "11:45"), series("clash", "13:00"), series("after", "16:00")],
      NOW,
    );
    // "late" can still launch now (within 30 min of its start) and then holds the slot until 15:45.
    expect(Object.fromEntries(forecast)).toEqual({ long: "running", late: "expected", clash: "unlikely", after: "expected" });
  });

  it("expects a series whose start passes at most 30 min before the slot frees, as the launcher would", () => {
    const forecast = forecastArenas(
      [series("bo1", "14:00", { format: 1 }), series("tight", "15:00"), series("too-early", "14:55", { format: 1 })],
      NOW,
    );
    // bo1 ends 15:30: "too-early" (14:55) is outside the 30-min window, "tight" (15:00) just inside it.
    expect(Object.fromEntries(forecast)).toEqual({ bo1: "expected", "too-early": "unlikely", tight: "expected" });
  });

  it("gives no arena to a past series that never ran, or to a skipped one", () => {
    const forecast = forecastArenas(
      [series("missed", "11:29"), series("skipped", "15:00", { status: "skipped" }), series("late", "11:31")],
      NOW,
    );
    expect(Object.fromEntries(forecast)).toEqual({ missed: "none", skipped: "none", late: "expected" });
  });

  it("gives no forecast to an upcoming series whose teams aren't known, and none to a skip-requested one", () => {
    const forecast = forecastArenas(
      [series("tbd", "14:00", { selectable: false }), series("skip", "15:00", { skipRequested: true })],
      NOW,
    );
    expect(Object.fromEntries(forecast)).toEqual({ tbd: "unknown", skip: "none" });
  });

  it("doesn't let a TBD series take the slot from a known one at the same time", () => {
    const forecast = forecastArenas([series("tbd", "14:00", { selectable: false, priority: true }), series("known", "14:00")], NOW);
    expect(Object.fromEntries(forecast)).toEqual({ tbd: "unknown", known: "expected" });
  });

  it("marks a series that ran and is over as ended, not as one that never had an arena", () => {
    const forecast = forecastArenas(
      [series("decided", "08:00", { status: "decided", hasArena: true }), series("no-show", "09:00", { status: "invalid", hasArena: true })],
      NOW,
    );
    expect(Object.fromEntries(forecast)).toEqual({ decided: "ended", "no-show": "ended" });
  });

  it("breaks a full tie the same way on every read", () => {
    const tied = [series("b", "14:00"), series("a", "14:00")];
    expect(forecastArenas(tied, NOW).get("a")).toBe("expected");
    expect(forecastArenas([...tied].reverse(), NOW).get("a")).toBe("expected");
  });

  it("expects nothing new while the autopilot is switched off, but keeps the running series", () => {
    const forecast = forecastArenas([series("running", "11:00", { hasArena: true }), series("next", "16:00")], NOW, {
      autopilotEnabled: false,
    });
    expect(Object.fromEntries(forecast)).toEqual({ running: "running", next: "unlikely" });
  });
});
