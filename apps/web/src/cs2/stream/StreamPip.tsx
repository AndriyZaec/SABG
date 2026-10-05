import { useEffect, useRef, useState } from "react";
import type { StreamEmbed } from "./streamEmbed.js";

const STORAGE_KEY = "cs2.streamPip";
const MARGIN = 16;
const MIN_WIDTH = 200;
const VIDEO_RATIO = 9 / 16;

interface Position {
  left: number;
  top: number;
}

interface PipState {
  /** Undefined until the viewer drags or resizes it: the CSS default corner applies. */
  position?: Position;
  /** Undefined until the viewer resizes it: the CSS default width applies. */
  width?: number;
  collapsed: boolean;
}

type Gesture =
  | { kind: "move"; dx: number; dy: number }
  | { kind: "resize"; startX: number; startY: number; startWidth: number; right: number; top: number; extra: number };

function loadState(): PipState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { collapsed: false };
    const parsed = JSON.parse(raw) as Partial<PipState>;
    const position = parsed.position;
    return {
      collapsed: parsed.collapsed === true,
      ...(position !== undefined && Number.isFinite(position.left) && Number.isFinite(position.top)
        ? { position: { left: position.left, top: position.top } }
        : {}),
      ...(Number.isFinite(parsed.width) ? { width: parsed.width! } : {}),
    };
  } catch {
    return { collapsed: false };
  }
}

function saveState(state: PipState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked (private window): the player still works, it just won't remember.
  }
}

/** Height beyond the 16:9 video, the bar and the borders, measured so the bounds below are exact. */
function extraHeight(element: HTMLElement): number {
  const { width, height } = element.getBoundingClientRect();
  return height - width * VIDEO_RATIO;
}

/** The widest the player may get: 90% of the viewport's width, or of its height for the 16:9 video plus `extra`. */
function clampWidth(width: number, extra: number): number {
  const max = Math.max(MIN_WIDTH, Math.min(window.innerWidth * 0.9, (window.innerHeight * 0.9 - extra) / VIDEO_RATIO));
  return Math.min(Math.max(width, MIN_WIDTH), max);
}

function clampPosition(position: Position, width: number, height: number): Position {
  const maxLeft = Math.max(0, window.innerWidth - width - MARGIN);
  const maxTop = Math.max(0, window.innerHeight - height - MARGIN);
  return {
    left: Math.min(Math.max(position.left, Math.min(MARGIN, maxLeft)), maxLeft),
    top: Math.min(Math.max(position.top, Math.min(MARGIN, maxTop)), maxTop),
  };
}

/**
 * A muted live stream that floats over the arena page: drag it by its bar, resize it by its bottom-left corner,
 * collapse it to a button that always sits in the bottom-right corner.
 */
export function StreamPip({ embed }: { embed: StreamEmbed }) {
  const [state, setState] = useState<PipState>(loadState);
  const [gesturing, setGesturing] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);

  // Remember where it was left, once a gesture ends rather than on every move.
  useEffect(() => {
    if (!gesturing) saveState(state);
  }, [state, gesturing]);

  // A rotation or a smaller window must not leave it off screen or oversized.
  useEffect(() => {
    if (state.collapsed) return;
    const reclamp = () => {
      const element = elementRef.current;
      if (element === null) return;
      const extra = extraHeight(element);
      setState((current) => {
        if (current.position === undefined && current.width === undefined) return current;
        const width = clampWidth(current.width ?? element.getBoundingClientRect().width, extra);
        return {
          ...current,
          ...(current.width !== undefined ? { width } : {}),
          ...(current.position !== undefined
            ? { position: clampPosition(current.position, width, width * VIDEO_RATIO + extra) }
            : {}),
        };
      });
    };
    reclamp();
    window.addEventListener("resize", reclamp);
    window.addEventListener("orientationchange", reclamp);
    return () => {
      window.removeEventListener("resize", reclamp);
      window.removeEventListener("orientationchange", reclamp);
    };
  }, [state.collapsed]);

  const startGesture = (event: React.PointerEvent<HTMLDivElement>, kind: Gesture["kind"]) => {
    const element = elementRef.current;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    gestureRef.current = kind === "move"
      ? { kind, dx: event.clientX - rect.left, dy: event.clientY - rect.top }
      : {
          kind,
          startX: event.clientX,
          startY: event.clientY,
          startWidth: rect.width,
          right: rect.right,
          top: rect.top,
          extra: extraHeight(element),
        };
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesturing(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const element = elementRef.current;
    if (gesture === null || element === null) return;
    if (gesture.kind === "move") {
      const rect = element.getBoundingClientRect();
      const position = clampPosition({ left: event.clientX - gesture.dx, top: event.clientY - gesture.dy }, rect.width, rect.height);
      setState((current) => ({ ...current, position }));
      return;
    }
    // Bottom-left handle: leftwards or downwards grows it, along the diagonal; the right and top edges stay put.
    const grow = ((gesture.startX - event.clientX) + (event.clientY - gesture.startY) / VIDEO_RATIO) / 2;
    const width = clampWidth(gesture.startWidth + grow, gesture.extra);
    const position = clampPosition({ left: gesture.right - width, top: gesture.top }, width, width * VIDEO_RATIO + gesture.extra);
    setState((current) => ({ ...current, width, position }));
  };

  const endGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current === null) return;
    gestureRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setGesturing(false);
  };

  if (state.collapsed) {
    return (
      <button
        className="cs2-stream-pip__expand"
        type="button"
        onClick={() => setState((current) => ({ ...current, collapsed: false }))}
        aria-label={`Show the ${embed.label} stream`}
      >
        ▶ {embed.label}
      </button>
    );
  }

  const style: React.CSSProperties = {
    ...(state.width !== undefined ? { width: state.width } : {}),
    ...(state.position !== undefined
      ? { left: state.position.left, top: state.position.top, right: "auto", bottom: "auto" }
      : {}),
  };

  return (
    <div className={`cs2-stream-pip${gesturing ? " cs2-stream-pip--gesturing" : ""}`} ref={elementRef} style={style}>
      <div
        className="cs2-stream-pip__bar"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button") === null) startGesture(event, "move");
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        <span className="cs2-stream-pip__label">Live · {embed.label}</span>
        <button
          className="cs2-stream-pip__collapse"
          type="button"
          onClick={() => setState((current) => ({ ...current, collapsed: true }))}
          aria-label="Hide the stream"
        >
          –
        </button>
      </div>
      <iframe
        className="cs2-stream-pip__frame"
        src={embed.src}
        title={`${embed.label} live stream`}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
      />
      <div
        className="cs2-stream-pip__resize"
        aria-hidden="true"
        onPointerDown={(event) => startGesture(event, "resize")}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      />
    </div>
  );
}
