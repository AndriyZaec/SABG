import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { classicZoneHud } from "../classicZone.js";
import type { Cs2ArenaView } from "../cs2View.js";
import { SURVIVORS_VISIBLE, survivorsBoard } from "../survivorsBoard.js";

/** Fit real rendered rows, zone bands and the viewer's row into the desktop rail. */
export function useStageSurvivorsBoard(view: Cs2ArenaView, panelRef: RefObject<HTMLDivElement>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [visibleCount, setVisibleCount] = useState(SURVIVORS_VISIBLE);
  const zone = useMemo(() => classicZoneHud(view), [view.mode, view.zone, view.finished]);
  // Reuse capacity for score-only updates; regrouping, labels and the viewer's position may change it.
  const shape = useMemo(() => JSON.stringify([zone, view.leaderboard.map((row) => [row.status, row.name, !!row.you, zone?.stage === "zone" && row.score < zone.nextZone])]), [view.leaderboard, zone]);
  const input = useMemo(() => ({ rows: view.leaderboard, zone, shape }), [view.leaderboard, zone, shape]);
  const search = useRef<{ input: typeof input; width: number; height: number; low: number; high: number; best: number; done: boolean; phase: "search" | "check" | "higher" | "lower" }>();

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize(previous => Math.abs(previous.width - width) < .5 && Math.abs(previous.height - height) < .5 ? previous : { width, height });
    });
    observer.observe(panel);
    let active = true;
    void document.fonts.ready.then(() => {
      if (!active) return;
      search.current = undefined;
      setSize(previous => ({ ...previous }));
    });
    return () => { active = false; observer.disconnect(); };
  }, [panelRef]);

  useLayoutEffect(() => {
    // Compact boards size themselves from their rows, so their own height cannot be a fit budget.
    if (!window.matchMedia("(min-width: 1280px)").matches || view.leaderboard.length <= SURVIVORS_VISIBLE) {
      search.current = undefined;
      const body = panelRef.current?.querySelector<HTMLElement>(".cs2-board__body");
      body?.style.removeProperty("--cs2-stage-row-padding");
      if (body) body.style.flex = "";
      setVisibleCount(SURVIVORS_VISIBLE);
      return;
    }
    const panel = panelRef.current;
    const card = panel?.querySelector<HTMLElement>(".cs2-board");
    const body = card?.querySelector<HTMLElement>(".cs2-board__body");
    if (!panel || !card || !body) return;
    const rect = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    const width = rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (width <= 0 || height <= 0) return;
    if (search.current?.input !== input || Math.abs(search.current.width - width) > .5 || Math.abs(search.current.height - height) > .5) {
      const warm = search.current?.done && Math.abs(search.current.width - width) <= .5 && Math.abs(search.current.height - height) <= .5;
      if (warm && search.current && search.current.input.shape === shape) search.current.input = input;
      else search.current = { input, width, height, low: 1, high: view.leaderboard.length, best: 1, done: false, phase: warm ? "check" : "search" };
    }
    const current = search.current;
    // Measure the unexpanded rows before distributing the spare pixels.
    body.style.setProperty("--cs2-stage-row-padding", "0px");
    body.style.flex = "none";
    const naturalHeight = body.getBoundingClientRect().bottom - card.getBoundingClientRect().top + parseFloat(getComputedStyle(card).borderBottomWidth);
    const fillRemainingSpace = () => {
      const rows = body.querySelectorAll(".nb-board__row").length;
      const dense = panel.closest(".cs2-stage__rail[data-dense]") !== null;
      const padding = dense && rows > 0 ? Math.max(0, height - naturalHeight - 1) / (rows * 2) : 0;
      body.style.setProperty("--cs2-stage-row-padding", `${padding}px`);
      body.style.flex = "";
    };
    if (current.done) {
      fillRemainingSpace();
      return;
    }
    const fits = naturalHeight <= height + .5;
    const finish = () => {
      current.done = true;
      if (visibleCount === current.best) fillRemainingSpace();
      else setVisibleCount(current.best);
    };
    // A score update usually keeps the same capacity: verify the old best and its neighbor.
    if (current.phase === "check") {
      if (fits) {
        current.best = Math.min(visibleCount, view.leaderboard.length);
        if (visibleCount >= current.high) { finish(); return; }
        current.low = visibleCount + 1;
        current.phase = "higher";
        setVisibleCount(visibleCount + 1);
      } else {
        current.high = visibleCount - 1;
        if (visibleCount <= 1) { finish(); return; }
        current.phase = "lower";
        setVisibleCount(visibleCount - 1);
      }
      return;
    }
    if (current.phase === "higher" && !fits) { finish(); return; }
    if (current.phase === "lower" && fits) { current.best = visibleCount; finish(); return; }
    current.phase = "search";
    if (fits) {
      current.best = Math.min(visibleCount, view.leaderboard.length);
      current.low = visibleCount + 1;
    } else current.high = visibleCount - 1;
    if (current.low > current.high) {
      finish();
    } else setVisibleCount(Math.floor((current.low + current.high) / 2));
  }, [input, panelRef, shape, size, view.leaderboard.length, visibleCount]);

  return useMemo(() => survivorsBoard(view.leaderboard, zone, visibleCount), [view.leaderboard, zone, visibleCount]);
}
