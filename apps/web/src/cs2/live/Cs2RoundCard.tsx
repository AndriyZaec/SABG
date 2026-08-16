import { useState } from "react";
import type { Answer } from "@arena/contracts";
import type { Cs2RoundView } from "../cs2View.js";
import { Panel } from "../../ui/Panel.js";
import { Button } from "../../ui/Button.js";
import { Badge } from "../../ui/Badge.js";

/** CS2's analog of arena/live/PredictionCard.tsx — no countdown-to-lock (CS2 rounds have no
 *  fixed answer window, spec §6: locking depends on when freezetime ends, unknowable in
 *  advance), and an extra "voided" state (arena/live/PredictionCard.tsx has none — voided rounds
 *  are CS2-only). */
export function Cs2RoundCard({
  round,
  onAnswer,
  eliminated = false,
  participant = true,
}: {
  round: Cs2RoundView;
  onAnswer?: (a: Answer) => void;
  eliminated?: boolean;
  participant?: boolean;
}) {
  const [picked, setPicked] = useState<Answer | undefined>(round.myAnswer);
  const isOpen = round.status === "open";
  const pressed = { transform: "translate(4px, 4px)", boxShadow: "0 0 0 var(--ink)" } as const;

  const answer = (a: Answer) => {
    setPicked(a);
    onAnswer?.(a);
  };

  return (
    <Panel title={`Round ${round.roundNumber}`} accent="blue" className="nb-rise">
      <h2 style={{ marginBottom: 14 }}>{round.question}</h2>

      <div className="nb-row" style={{ justifyContent: "space-between" }}>
        <span className="nb-label">
          {round.status === "voided" ? "Voided" : round.status === "locked" ? "Locked" : "Open — no fixed lock time"}
        </span>
      </div>

      {isOpen && participant && !eliminated && (
        <div className="nb-yesno">
          <Button variant="survive" lg block onClick={() => answer("yes")} style={picked === "yes" ? pressed : undefined}>
            Yes
          </Button>
          <Button variant="danger" lg block onClick={() => answer("no")} style={picked === "no" ? pressed : undefined}>
            No
          </Button>
        </div>
      )}

      {isOpen && participant && eliminated && (
        <p className="nb-label" style={{ marginTop: 12 }}>You&apos;re eliminated — spectating only.</p>
      )}

      {isOpen && !participant && (
        <p className="nb-label" style={{ marginTop: 12 }}>You&apos;re spectating — joining CS2 arenas isn&apos;t available yet.</p>
      )}

      {picked && round.status !== "settled" && round.status !== "voided" && (
        <p className="nb-mono" style={{ marginTop: 12 }}>
          You answered <b>{picked.toUpperCase()}</b>
          {isOpen && <span className="nb-label"> — change until lock</span>}
        </p>
      )}

      {round.status === "locked" && (
        <p className="nb-label" style={{ marginTop: 12 }}>Locked — waiting for the outcome…</p>
      )}

      {round.status === "voided" && (
        <p className="nb-label" style={{ marginTop: 12 }}>The match ended before this round played out — no penalty.</p>
      )}

      {round.status === "settled" && round.correctAnswer && participant && (
        <div style={{ marginTop: 14 }}>
          <Badge tone={!eliminated && picked === round.correctAnswer ? "survive" : "eliminated"}>
            {!eliminated && picked === round.correctAnswer ? "Survived" : "Eliminated"} · answer
            was {round.correctAnswer.toUpperCase()}
          </Badge>
        </div>
      )}
    </Panel>
  );
}
