import { useEffect, useRef, useState } from "react";
import type { Answer } from "@arena/contracts";
import type { Cs2AnswerSubmission } from "../cs2View.js";
import { streamEmbed } from "../stream/streamEmbed.js";
import { Cs2StageLayout } from "./Cs2StageLayout.js";
import { stageFixtures, type StageFixtureName } from "./stageFixtures.js";
import { stageSequence } from "./stageSequence.js";

export function Cs2StagePlayground() {
  const [selected, setSelected] = useState<StageFixtureName>("3 players");
  const [muted, setMuted] = useState(true);
  const [streamUrl, setStreamUrl] = useState("");
  const [answer, setAnswer] = useState<Answer | undefined>(undefined);
  const [submission, setSubmission] = useState<Cs2AnswerSubmission | undefined>(undefined);
  const [scene, setScene] = useState<(typeof stageFixtures)[StageFixtureName] | undefined>(undefined);
  const [sequenceLabel, setSequenceLabel] = useState("");
  const run = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const toolsRef = useRef<HTMLDetailsElement>(null);
  const closeTools = () => { if (toolsRef.current) toolsRef.current.open = false; };
  const stop = () => { timers.current.forEach(clearTimeout); timers.current = []; setSequenceLabel(""); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const fixture = scene ?? stageFixtures[selected];
  const normalizedStreamUrl = streamUrl.trim().replace(/^https:\/\/www\.twitch\.tv\//iu, "https://twitch.tv/");
  const embed = streamEmbed(normalizedStreamUrl, window.location.hostname);
  const view = answer && fixture.view.round
    ? { ...fixture.view, round: { ...fixture.view.round, myAnswer: answer } }
    : fixture.view;

  return (
    <div className="cs2-stage-playground">
      <details className="cs2-stage-playground__tools" ref={toolsRef}>
        <summary>Stage controls</summary>
        <div className="cs2-stage-playground__controls">
          <label>
            Fixture
            <select value={selected} onChange={(event) => {
              const name = event.target.value;
              if (!(name in stageFixtures)) return;
              setSelected(name as StageFixtureName);
              stop();
              setScene(undefined);
              setAnswer(undefined);
              setSubmission(undefined);
              closeTools();
            }}>
              {Object.keys(stageFixtures).map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label className="cs2-stage-playground__url">
            Stream URL
            <input type="url" value={streamUrl} onChange={(event) => setStreamUrl(event.target.value)} placeholder="Optional Twitch, Kick or YouTube URL" aria-describedby="cs2-stage-stream-help" />
          </label>
          <button type="button" className="nb-btn nb-btn--primary cs2-stage-playground__sequence" onClick={() => {
            closeTools();
            stop();
            const outcome = run.current++ % 2 === 0 ? "correct" : "wrong";
            const frames = stageSequence(run.current, outcome);
            frames.forEach((frame, i) => {
              const show = () => { setAnswer(undefined); setSubmission(undefined); setScene(frame.fixture); setSequenceLabel(`${outcome} · ${frame.label}`); };
              if (i === 0) show(); else timers.current.push(setTimeout(show, i * 1100));
            });
          }}>Play sequence</button>
          <button type="button" className="nb-btn nb-btn--plain cs2-stage-playground__sequence" onClick={() => { closeTools(); stop(); setAnswer(undefined); setSubmission(undefined); setScene(stageFixtures.Eliminated); }}>Eliminate</button>
          <button type="button" className="nb-btn nb-btn--plain cs2-stage-playground__sequence" onClick={() => { closeTools(); stop(); setAnswer(undefined); setSubmission(undefined); setScene(stageFixtures.Winner); }}>Winner</button>
          <span id="cs2-stage-stream-help" role="status" aria-live="polite">
            {streamUrl.trim() && !embed ? "Unsupported stream URL" : sequenceLabel || "Fixture preview"}
          </span>
        </div>
      </details>
      <Cs2StageLayout
        view={view}
        connected={fixture.connected}
        answerSubmission={submission ?? fixture.answerSubmission}
        submitAnswer={(next) => {
          if (!view.round) return;
          setAnswer(next);
          setSubmission({ status: "accepted", roundId: view.round.roundId, answer: next });
        }}
        muted={muted}
        onToggleMute={() => setMuted((current) => !current)}
        seriesId={fixture.seriesId}
        embed={embed}
        teams={fixture.teams}
        competition={fixture.competition}
        format={fixture.format}
        map={fixture.map}
      />
    </div>
  );
}
