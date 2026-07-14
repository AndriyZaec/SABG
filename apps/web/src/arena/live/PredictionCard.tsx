import { useState } from "react";
import type { Answer } from "@arena/contracts";
import type { RoundView } from "../arenaView.js";
import { useCountdown } from "./useCountdown.js";
import { Panel } from "../../ui/Panel.js";
import { Button } from "../../ui/Button.js";
import { Badge } from "../../ui/Badge.js";

const clock = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

/** The heart of the arena: question + countdown-to-lock + YES/NO. */
export function PredictionCard({ round, onAnswer }: { round: RoundView; onAnswer?: (a: Answer) => void }) {
  const [picked, setPicked] = useState<Answer | undefined>(round.myAnswer);
  const { remainingMs, locked } = useCountdown(round.lockAt);

  const isOpen = round.status === "open" && !locked;
  const secs = Math.ceil(remainingMs / 1000);
  const pct = Math.max(0, Math.min(100, (remainingMs / 60_000) * 100));
  const low = remainingMs <= 10_000 && !locked;

  const answer = (a: Answer) => {
    setPicked(a);
    onAnswer?.(a);
  };
  const pressed = { transform: "translate(4px, 4px)", boxShadow: "0 0 0 var(--ink)" } as const;

  return (
    <Panel title={`Round · ${round.windowStartMinute}:00–${round.windowEndMinute}:00`} accent="blue" className="nb-rise">
      <h2 style={{ marginBottom: 14 }}>{round.question}</h2>

      <div className="nb-row" style={{ justifyContent: "space-between" }}>
        <span className="nb-label">{locked ? "Answers locked" : "Locks in"}</span>
        <span className="nb-mono" style={{ fontWeight: 700, fontSize: "1.05rem" }}>
          {locked ? "LOCKED" : clock(secs)}
        </span>
      </div>
      <div className={`nb-timer ${low ? "nb-timer--low" : ""}`} style={{ marginTop: 6 }}>
        <div className="nb-timer__bar" style={{ width: locked ? "0%" : `${pct}%` }} />
      </div>

      {isOpen && (
        <div className="nb-yesno">
          <Button variant="survive" lg block onClick={() => answer("yes")} style={picked === "yes" ? pressed : undefined}>
            Yes
          </Button>
          <Button variant="danger" lg block onClick={() => answer("no")} style={picked === "no" ? pressed : undefined}>
            No
          </Button>
        </div>
      )}

      {picked && round.status !== "settled" && (
        <p className="nb-mono" style={{ marginTop: 12 }}>
          You answered <b>{picked.toUpperCase()}</b>
          {isOpen && <span className="nb-label"> — change until lock</span>}
        </p>
      )}

      {locked && round.status !== "settled" && (
        <p className="nb-label" style={{ marginTop: 12 }}>Locked — waiting for the outcome…</p>
      )}

      {round.status === "settled" && round.correctAnswer && (
        <div style={{ marginTop: 14 }}>
          <Badge tone={picked === round.correctAnswer ? "survive" : "eliminated"}>
            {picked === round.correctAnswer ? "Survived" : "Eliminated"} · answer was{" "}
            {round.correctAnswer.toUpperCase()}
          </Badge>
        </div>
      )}
    </Panel>
  );
}
