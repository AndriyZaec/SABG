import { useEffect, useRef, useState } from "react";
import type { StreamEmbed } from "./streamEmbed.js";

const STORAGE_KEY = "cs2.streamPip";
const MARGIN = 16;

interface Position {
  left: number;
  top: number;
}

interface PipState {
  /** Undefined until the viewer drags it: the CSS default corner applies. */
  position?: Position;
  collapsed: boolean;
}

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

/** Keeps the whole element inside the viewport, MARGIN from the edges when it fits. */
function clamp(position: Position, element: HTMLElement): Position {
  const { width, height } = element.getBoundingClientRect();
  const maxLeft = Math.max(0, window.innerWidth - width - MARGIN);
  const maxTop = Math.max(0, window.innerHeight - height - MARGIN);
  return {
    left: Math.min(Math.max(position.left, Math.min(MARGIN, maxLeft)), maxLeft),
    top: Math.min(Math.max(position.top, Math.min(MARGIN, maxTop)), maxTop),
  };
}

/** A muted live stream that floats over the arena page: drag it by its bar, collapse it to a button. */
export function StreamPip({ embed }: { embed: StreamEmbed }) {
  const [state, setState] = useState<PipState>(loadState);
  const [dragging, setDragging] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);
  const grabRef = useRef<{ dx: number; dy: number } | null>(null);

  // Remember where it was left, once a drag ends rather than on every move.
  useEffect(() => {
    if (!dragging) saveState(state);
  }, [state, dragging]);

  // A rotation or a smaller window must not leave it off screen.
  useEffect(() => {
    const reclamp = () => {
      const element = elementRef.current;
      setState((current) => (current.position !== undefined && element !== null
        ? { ...current, position: clamp(current.position, element) }
        : current));
    };
    reclamp();
    window.addEventListener("resize", reclamp);
    window.addEventListener("orientationchange", reclamp);
    return () => {
      window.removeEventListener("resize", reclamp);
      window.removeEventListener("orientationchange", reclamp);
    };
  }, [state.collapsed]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = elementRef.current;
    if (element === null || (event.target as HTMLElement).closest("button") !== null) return;
    const rect = element.getBoundingClientRect();
    grabRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const grab = grabRef.current;
    const element = elementRef.current;
    if (grab === null || element === null) return;
    const position = clamp({ left: event.clientX - grab.dx, top: event.clientY - grab.dy }, element);
    setState((current) => ({ ...current, position }));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (grabRef.current === null) return;
    grabRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  const style = state.position === undefined ? undefined : { left: state.position.left, top: state.position.top, right: "auto", bottom: "auto" };

  if (state.collapsed) {
    return (
      <div className="cs2-stream-pip cs2-stream-pip--collapsed" ref={elementRef} style={style}>
        <button
          className="cs2-stream-pip__expand"
          type="button"
          onClick={() => setState((current) => ({ ...current, collapsed: false }))}
          aria-label={`Show the ${embed.label} stream`}
        >
          ▶ {embed.label}
        </button>
      </div>
    );
  }

  return (
    <div className={`cs2-stream-pip${dragging ? " cs2-stream-pip--dragging" : ""}`} ref={elementRef} style={style}>
      <div
        className="cs2-stream-pip__bar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
    </div>
  );
}
