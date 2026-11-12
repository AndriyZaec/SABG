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
  const input = useMemo(() => ({ rows: view.leaderboard, zone }), [view.leaderboard, zone]);
  const search = useRef<{ input: typeof input; width: number; height: number; low: number; high: number; best: number; done: boolean }>();

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
    if (!window.matchMedia("(min-width: 1280px)").matches) {
      search.current = undefined;
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
      search.current = { input, width, height, low: 1, high: view.leaderboard.length, best: 1, done: false };
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
    if (naturalHeight <= height + .5) {
      current.best = Math.min(visibleCount, view.leaderboard.length);
      current.low = visibleCount + 1;
    } else current.high = visibleCount - 1;
    if (current.low > current.high) {
      current.done = true;
      if (visibleCount === current.best) fillRemainingSpace();
      else setVisibleCount(current.best);
    } else setVisibleCount(Math.floor((current.low + current.high) / 2));
  }, [input, panelRef, size, view.leaderboard.length, visibleCount]);

  return survivorsBoard(view.leaderboard, zone, visibleCount);
}
