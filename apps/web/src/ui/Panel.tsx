import type { CSSProperties, ReactNode } from "react";

type Accent = "white" | "yellow" | "green" | "red" | "blue" | "pink" | "ink";

interface PanelProps {
  title?: ReactNode;
  accent?: Accent;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** Bordered card with a hard offset shadow and an optional colored title bar. */
export function Panel({ title, accent = "yellow", className = "", style, children }: PanelProps) {
  return (
    <section className={`nb-panel ${className}`} style={style}>
      {title != null && <header className={`nb-panel__bar nb-bg--${accent}`}>{title}</header>}
      <div className="nb-panel__body">{children}</div>
    </section>
  );
}
