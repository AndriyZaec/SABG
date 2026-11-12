import { useRef } from "react";
import type { Answer } from "@arena/contracts";
import { WinnerBanner } from "../../arena/live/WinnerBanner.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Panel } from "../../ui/Panel.js";
import { classicRoundScoring } from "../classicZone.js";
import type { Cs2AnswerSubmission, Cs2ArenaView } from "../cs2View.js";
import type { Cs2FeedItem } from "../live/cs2Feed.js";
import { stageRoundState } from "./stageRoundState.js";
import { useDockMotion } from "./useStageMotion.js";

export function StagePlayDock({ view, connected, answerSubmission, submitAnswer, muted, onToggleMute, feed }: {
  view: Cs2ArenaView;
  connected: boolean;
  answerSubmission: Cs2AnswerSubmission;
  submitAnswer: (answer: Answer) => void;
  muted: boolean;
  onToggleMute: () => void;
  feed: readonly Cs2FeedItem[];
}) {
  const round = view.round;
  const dockRef = useRef<HTMLDivElement>(null);
  useDockMotion(dockRef, view, answerSubmission, feed);
  const presentation = stageRoundState(view, connected, answerSubmission);
  const terminal = presentation.kind === "terminal" ? presentation.terminal : undefined;
  const picked = presentation.kind === "answers" ? presentation.picked : undefined;
  const classic = round ? classicRoundScoring(view, round.roundNumber) : undefined;
  const pending = (view.pendingPredictions ?? []).filter((prediction) => prediction.roundId !== round?.roundId)
    .reverse().sort((a, b) => (b.roundNumber ?? -1) - (a.roundNumber ?? -1));
  const now = pending[0];
  const question = round?.question ?? "";
  const questionSize = question.length > 120 ? "compact" : question.length > 45 ? "long" : "normal";
  const plateTone = presentation.kind === "answers" ? presentation.plateTone : "ink";

  return (
    <section className={`cs2-stage__dock${terminal ? ` cs2-stage__dock--${terminal}` : ""}`} aria-label="Now and next predictions">
      <div className={`cs2-stage__dock-content${terminal ? " cs2-stage__dock-content--terminal" : ""}`} ref={dockRef}>
        {presentation.kind === "terminal" ? (
          <Panel className={`cs2-stage__terminal-panel cs2-stage__takeover cs2-stage__takeover--${terminal}`}>
            {presentation.terminal === "winner" ? (
              <div className="cs2-stage__winner-content">
                <WinnerBanner />
                <div className="cs2-stage__confetti" aria-hidden="true">
                  {Array.from({ length: 18 }, (_, i) => <span key={i} style={{ left: `${4 + i * 5.3}%`, background: ["var(--yellow)", "var(--blue)", "var(--pink)"][i % 3], animationDelay: `${(i * 71) % 350}ms`, animationDuration: `${1000 + (i % 4) * 140}ms` }} />)}
                </div>
              </div>
            ) : (
              <div role="status" aria-live="polite">
                <p className="cs2-stage__takeover-title">{presentation.title}</p>
                {presentation.detail && <p className="cs2-stage__takeover-subtitle">{presentation.detail}</p>}
              </div>
            )}
          </Panel>
        ) : (
          <div className="cs2-stage__cards">
            <div className="cs2-stage__now-slot" data-round-id={now?.roundId}>
              <Panel className="cs2-stage__now-card" accent="ink" title={
                <div className="cs2-stage__now-heading">
                  <span>NOW{now?.roundNumber !== undefined ? ` · ROUND ${now.roundNumber}` : ""}</span>
                  {pending.length > 1 && <Badge>+{pending.length - 1}</Badge>}
                </div>
              }>
                {now ? <><p className="cs2-stage__now-question">{now.question}</p><div className="cs2-stage__your-pick"><span>YOUR PICK</span><Badge tone={now.answer === "yes" ? "survive" : "eliminated"}>{now.answer.toUpperCase()}</Badge></div></>
                  : <p className="cs2-stage__now-empty">No prediction in play.</p>}
              </Panel>
            </div>
            <Panel className="cs2-stage__next-card" accent={plateTone === "ink" ? "ink" : plateTone} title={
              <div className="cs2-stage__next-heading">
                <span>NEXT ·</span>
                <div className={`cs2-stage__round-plate cs2-stage__round-plate--${plateTone}`}>
                  <span>ROUND</span><b>{round?.roundNumber ?? "—"}</b>
                </div>
                <button type="button" className={`nb-btn nb-btn--plain cs2-stage__mute${muted ? "" : " cs2-stage__mute--on"}`} onClick={onToggleMute} title={muted ? "Game sounds: off" : "Game sounds: on"} aria-label={muted ? "Enable game sounds" : "Disable game sounds"} aria-pressed={!muted}>
                  <span aria-hidden="true">{muted ? "🔇" : "🔊"}</span>
                </button>
              </div>
            }>
              <div className="cs2-stage__question-content">
                <p className={`cs2-stage__question cs2-stage__question--${questionSize}`}>{question}</p>
                <div className="cs2-stage__notice-slot">
                  {presentation.kind === "answers" && presentation.rejection && <p className="cs2-stage__rejection" role="alert" aria-live="assertive">{presentation.rejection}</p>}
                </div>
              </div>
              <div className="cs2-stage__action-slot">
                {presentation.kind === "answers" ? (
                  <div className={`cs2-stage__answers${picked ? " cs2-stage__answers--picked" : ""}`}>
                    {(["yes", "no"] as const).map((answer) => (
                      <Button key={answer} type="button" variant={answer === "yes" ? "survive" : "danger"} lg block
                        className={`cs2-stage__answer cs2-stage__answer--${answer}${classic?.double ? " cs2-answer--double" : ""}`}
                        disabled={!presentation.canAnswer} aria-disabled={!presentation.canAnswer || (presentation.submitting && picked === answer)} aria-pressed={picked === answer}
                        onClick={() => { if (presentation.canAnswer && !(presentation.submitting && picked === answer)) submitAnswer(answer); }}>
                        {answer === "yes" ? "Yes" : "No"}{classic?.double && <span className="cs2-answer__points">+2</span>}
                      </Button>
                    ))}
                  </div>
                ) : <div className={`cs2-stage__action-tile cs2-stage__action-tile--${presentation.tone} cs2-stage__action-tile--${presentation.appearance}`} role="status" aria-live="polite" aria-atomic="true"><p className="cs2-stage__tile-title">{presentation.title}</p><p className="cs2-stage__tile-detail">{presentation.detail}</p></div>}
              </div>
            </Panel>
          </div>
        )}
      </div>
    </section>
  );
}
