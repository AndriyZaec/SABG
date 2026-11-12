import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Cs2AnswerSubmission, Cs2ArenaView } from "../cs2View.js";
import { cs2FeedForView } from "../live/cs2Feed.js";
import type { SurvivorsBoard } from "../survivorsBoard.js";

const EASE = "cubic-bezier(.2, .8, .2, 1)";

function useStageAnimator(root: RefObject<HTMLElement>) {
  const running = useRef(new Set<Animation>());
  const animate = useCallback((element: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const animation = element.animate(frames, { easing: EASE, ...options });
    running.current.add(animation);
    const forget = () => running.current.delete(animation);
    animation.addEventListener("finish", forget, { once: true });
    animation.addEventListener("cancel", forget, { once: true });
    return animation;
  }, []);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const clear = () => {
      for (const animation of running.current) animation.cancel();
      running.current.clear();
      root.current?.querySelectorAll(".cs2-stage__motion-layer").forEach((element) => element.remove());
    };
    const changed = () => { if (preference.matches) clear(); };
    preference.addEventListener("change", changed);
    return () => { preference.removeEventListener("change", changed); clear(); };
  }, [root]);
  return animate;
}

function removeAfter(animation: Animation | undefined, element: Element) {
  if (!animation) { element.remove(); return; }
  animation.addEventListener("finish", () => element.remove(), { once: true });
  animation.addEventListener("cancel", () => element.remove(), { once: true });
}

function layer(root: HTMLElement) {
  const element = document.createElement("span");
  element.className = "cs2-stage__motion-layer";
  element.setAttribute("aria-hidden", "true");
  root.append(element);
  return element;
}

export function useDockMotion(root: RefObject<HTMLDivElement>, view: Cs2ArenaView, submission: Cs2AnswerSubmission) {
  const animate = useStageAnimator(root);
  const previous = useRef<{
    roundId: string | undefined;
    status: string | undefined;
    tile: string;
    myStatus: Cs2ArenaView["myStatus"];
    width: number;
    height: number;
    now: Map<string, { node: HTMLElement; x: number; y: number; width: number; height: number }>;
    chips: Map<string, { x: number; y: number }>;
  }>();
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const stage = element.closest<HTMLElement>(".cs2-stage") ?? element;
    const stageBounds = stage.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const now = new Map<string, { node: HTMLElement; x: number; y: number; width: number; height: number }>();
    element.querySelectorAll<HTMLElement>(".cs2-stage__now-slot[data-round-id]:not(.cs2-stage__now-ghost)").forEach((card) => {
      const rect = card.getBoundingClientRect();
      now.set(card.dataset.roundId!, { node: card.cloneNode(true) as HTMLElement, x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height });
    });
    const chips = new Map<string, { x: number; y: number }>();
    const chipElements = new Map<string, { element: HTMLElement; rect: DOMRect }>();
    stage.querySelectorAll<HTMLElement>(".cs2-stage__result-chip[data-round-id]").forEach((chip) => {
      chips.set(chip.dataset.roundId!, { x: chip.offsetLeft, y: chip.offsetTop });
      chipElements.set(chip.dataset.roundId!, { element: chip, rect: chip.getBoundingClientRect() });
    });
    const tile = `${view.round?.roundId ?? ""}:${view.round?.status ?? ""}:${view.myStatus ?? ""}:${view.finished ?? ""}:${view.cancelled?.reason ?? ""}`;
    const old = previous.current;
    previous.current = { roundId: view.round?.roundId, status: view.round?.status, tile, myStatus: view.myStatus, width: bounds.width, height: bounds.height, now, chips };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (old && (Math.abs(old.width - bounds.width) > 1 || Math.abs(old.height - bounds.height) > 1)) return;

    if (!old || old.roundId !== view.round?.roundId) {
      const plate = element.querySelector(".cs2-stage__round-plate");
      animate(plate, [{ transform: "translateY(-5px)", opacity: .7 }, { transform: "none", opacity: 1 }], { duration: 260 });
      if (plate?.classList.contains("cs2-stage__round-plate--yellow")) animate(plate, [{ opacity: 1 }, { opacity: .4 }, { opacity: 1 }, { opacity: .4 }, { opacity: 1 }], { duration: 300, easing: "steps(1, end)" });
      animate(element.querySelector(".cs2-stage__question"), [{ transform: "translateY(5px)", opacity: .5 }, { transform: "none", opacity: 1 }], { duration: 280 });
    }
    if ((!old || old.status !== "locked") && view.round?.status === "locked") animate(element.querySelector(".cs2-stage__locked-tag"), [{ transform: "scale(1.12) rotate(-4deg)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 260 });
    if (!old || old.tile !== tile) {
      const result = element.querySelector(".cs2-stage__action-tile");
      if (result?.classList.contains("cs2-stage__action-tile--red")) {
        animate(result, [{ transform: "translateX(0)", opacity: .7 }, { transform: "translateX(-4px)", opacity: 1, offset: .35 }, { transform: "translateX(4px)", opacity: 1, offset: .65 }, { transform: "none", opacity: 1 }], { duration: 340 });
      } else animate(result, [{ transform: "translateY(6px)", opacity: .6 }, { transform: "none", opacity: 1 }], { duration: 300 });
      // Animate the smaller content blocks, never scale the full painted winner surface.
      animate(element.querySelector(".cs2-stage__winner-content .nb-winner > div"), [{ transform: "translateY(12px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380 });
      animate(element.querySelector(".cs2-stage__takeover-title"), [{ transform: "translateY(10px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 340 });
    }
    if (old && old.myStatus !== "eliminated" && view.myStatus === "eliminated") {
      const overlay = layer(element);
      const wipe = document.createElement("span");
      wipe.className = "cs2-stage__motion-wipe cs2-stage__motion-wipe--eliminated";
      overlay.append(wipe);
      removeAfter(animate(wipe, [{ transform: "scaleX(0)", opacity: .85 }, { transform: "scaleX(1)", opacity: .85, offset: .65 }, { transform: "scaleX(1)", opacity: 0 }], { duration: 360 }), overlay);
    }
    if (!old) return;
    const results = cs2FeedForView(view);
    for (const [id, card] of old.now) {
      if (now.has(id)) continue;
      const result = results.find((item) => item.kind === "result" && item.id === `result-${id}`);
      if (!result || result.kind !== "result") continue;
      const overlay = layer(stage);
      const ghost = card.node;
      ghost.classList.add("cs2-stage__now-ghost");
      Object.assign(ghost.style, { left: `${bounds.left - stageBounds.left + card.x}px`, top: `${bounds.top - stageBounds.top + card.y}px`, width: `${card.width}px`, height: `${card.height}px`, container: "cs2-stage-dock / inline-size" });
      overlay.append(ghost);
      const flash = document.createElement("span");
      flash.className = `cs2-stage__now-flash cs2-stage__now-flash--${result.outcome}`;
      ghost.append(flash);
      animate(flash, [{ opacity: 0 }, { opacity: .8, offset: .45 }, { opacity: 0 }], { duration: 220 });
      const target = chipElements.get(id);
      if (target) {
        animate(target.element, [{ opacity: 0 }, { opacity: 0, offset: .8 }, { opacity: 1 }], { duration: 420 });
        const end = `translate(${target.rect.left - bounds.left - card.x}px, ${target.rect.top - bounds.top - card.y}px) scale(${target.rect.width / card.width}, ${target.rect.height / card.height})`;
        removeAfter(animate(ghost, [{ transform: "none", opacity: 1 }, { transform: "none", opacity: 1, offset: .35 }, { transform: end, opacity: .9, offset: .9 }, { transform: end, opacity: 0 }], { duration: 420 }), overlay);
      } else {
        const label = document.createElement("b");
        label.className = `cs2-stage__now-resolution cs2-stage__now-resolution--${result.outcome}`;
        label.textContent = result.outcome.toUpperCase();
        ghost.append(label);
        removeAfter(animate(ghost, [{ opacity: 1 }, { opacity: 1, offset: .7 }, { opacity: 0 }], { duration: 440 }), overlay);
      }
    }
    for (const [id, chip] of chipElements) {
      const before = old.chips.get(id);
      const current = chips.get(id);
      if (before && current && (before.x !== current.x || before.y !== current.y)) animate(chip.element, [{ transform: `translate(${before.x - current.x}px, ${before.y - current.y}px)` }, { transform: "none" }], { duration: 320 });
    }
  }, [animate, root, view, submission]);
}

export function useBoardMotion(root: RefObject<HTMLElement>, view: Cs2ArenaView, tab: string, board: SurvivorsBoard) {
  const animate = useStageAnimator(root);
  const previous = useRef(new Map<string, { top: number; score: string; out: boolean }>());
  const previousZone = useRef<{ zone: number; height: number; bottom: number; width: number; viewport: number }>();
  const update = useCallback(() => {
    const panel = root.current?.querySelector<HTMLElement>(".cs2-stage__survivors-panel");
    if (!panel || panel.getClientRects().length === 0) { previous.current.clear(); previousZone.current = undefined; return; }
    const body = panel.querySelector<HTMLElement>(".cs2-board__body");
    if (!body) return;
    const origin = body.getBoundingClientRect().top - body.scrollTop;
    // Read the entire visible board before any animation writes.
    const rows = [...panel.querySelectorAll<HTMLElement>(".nb-board__row")].map((element) => ({
      element,
      key: element.classList.contains("nb-board__row--you") ? "__you" : `player:${element.querySelector(".nb-board__name")?.textContent ?? ""}`,
      top: element.getBoundingClientRect().top - origin,
      score: element.querySelector<HTMLElement>(".nb-board__score"),
      out: element.classList.contains("nb-board__row--eliminated"),
    }));
    const lines = [...panel.querySelectorAll<HTMLElement>(".cs2-board__line")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { element, key: element.classList.contains("cs2-board__line--zone") ? "__zone" : "__next", top: rect.top + rect.height / 2 - origin };
    });
    const outBand = panel.querySelector<HTMLElement>(".cs2-board__band--out");
    const outBounds = outBand?.getBoundingClientRect();
    const oldZone = previousZone.current;
    const zone = view.mode === "classic" && view.zone.stage === "zone" && !view.finished ? view.zone.zone : undefined;
    const zoneAdvanced = zone !== undefined && oldZone !== undefined && zone > oldZone.zone && Math.abs(body.clientWidth - oldZone.width) < 1 && Math.abs(body.clientHeight - oldZone.viewport) < 1;
    previousZone.current = zone !== undefined && outBounds ? { zone, height: outBounds.height, bottom: outBounds.bottom - origin, width: body.clientWidth, viewport: body.clientHeight } : undefined;
    const duration = zoneAdvanced ? 420 : 340;
    const next = new Map<string, { top: number; score: string; out: boolean }>();
    for (const row of rows) {
      const score = row.score?.textContent ?? "";
      next.set(row.key, { top: row.top, score, out: row.out });
      const old = previous.current.get(row.key);
      if (!old) continue;
      if (Math.abs(old.top - row.top) > 1) animate(row.element, [{ transform: `translateY(${old.top - row.top}px)` }, { transform: "none" }], { duration });
      if (row.key === "__you" && score && old.score !== score) animate(row.score, [{ transform: "scale(1.2)" }, { transform: "none" }], { duration: 300 });
      if (!old.out && row.out && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const overlay = layer(row.element);
        const wipe = document.createElement("span");
        wipe.className = "cs2-stage__motion-wipe cs2-stage__motion-wipe--row";
        overlay.append(wipe);
        removeAfter(animate(wipe, [{ transform: "scaleX(0)", opacity: .8 }, { transform: "scaleX(1)", opacity: .8, offset: .7 }, { transform: "scaleX(1)", opacity: 0 }], { duration: 340 }), overlay);
      }
    }
    for (const line of lines) {
      next.set(line.key, { top: line.top, score: "", out: false });
      const old = previous.current.get(line.key);
      if (old && Math.abs(old.top - line.top) > 1) animate(line.element, [{ transform: `translateY(${old.top - line.top}px)` }, { transform: "none" }], { duration });
    }
    if (zoneAdvanced && outBand && outBounds && outBounds.height > 0 && oldZone && (Math.abs(oldZone.height - outBounds.height) > 1 || Math.abs(oldZone.bottom - (outBounds.bottom - origin)) > 1)) {
      animate(outBand, [{ transform: `translateY(${oldZone.bottom - (outBounds.bottom - origin)}px) scaleY(${oldZone.height / outBounds.height})` }, { transform: "none" }], { duration, pseudoElement: "::before" });
    }
    previous.current = next;
  }, [animate, root, view.leaderboard, view.zone, view.mode, view.finished, tab, board]);
  useLayoutEffect(() => {
    // Fit rows and distribute their spacing before taking the animation snapshot.
    const frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [update]);
}
