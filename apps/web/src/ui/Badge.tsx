import type { ReactNode } from "react";

type Tone = "survive" | "eliminated" | "live" | "neutral";

/** Small bordered status tag. `live` renders a blinking dot. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`nb-badge nb-badge--${tone}`}>
      {tone === "live" && <span className="nb-dot" aria-hidden />}
      {children}
    </span>
  );
}
