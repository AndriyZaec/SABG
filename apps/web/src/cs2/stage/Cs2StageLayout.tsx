import { useId, useRef, useState } from "react";
import type { Answer, Cs2SeriesMapSummary, Cs2SeriesSummary, Cs2TeamSummary } from "@arena/contracts";
import { Panel } from "../../ui/Panel.js";
import type { Cs2AnswerSubmission, Cs2ArenaView } from "../cs2View.js";
import { cs2FeedForView } from "../live/cs2Feed.js";
import { Cs2MatchFeed } from "../live/Cs2MatchFeed.js";
import { Cs2Survivors } from "../live/Cs2Survivors.js";
import type { StreamEmbed } from "../stream/streamEmbed.js";
import { SURVIVORS_VISIBLE } from "../survivorsBoard.js";
import { StageMatchBar } from "./StageMatchBar.js";
import { StagePlayDock } from "./StagePlayDock.js";
import { StageRecentRounds } from "./StageRecentRounds.js";
import { StageStream } from "./StageStream.js";
import { useBoardMotion } from "./useStageMotion.js";
import { useStageSurvivorsBoard } from "./useStageSurvivorsBoard.js";

export function Cs2StageLayout({
  view, connected, answerSubmission, submitAnswer, muted, onToggleMute, seriesId, embed, teams, competition, format, map,
}: {
  view: Cs2ArenaView;
  connected: boolean;
  answerSubmission: Cs2AnswerSubmission;
  submitAnswer: (answer: Answer) => void;
  muted: boolean;
  onToggleMute: () => void;
  seriesId: string;
  embed?: StreamEmbed;
  teams?: readonly [Pick<Cs2TeamSummary, "name" | "logoUrl">, Pick<Cs2TeamSummary, "name" | "logoUrl">];
  competition?: Cs2SeriesSummary["competition"];
  format?: Cs2SeriesSummary["format"];
  map?: Pick<Cs2SeriesMapSummary, "seriesMatchIndex" | "mapName">;
}) {
  const [tab, setTab] = useState<"survivors" | "feed">("survivors");
  const id = useId();
  const railRef = useRef<HTMLElement>(null);
  const survivorsRef = useRef<HTMLDivElement>(null);
  const board = useStageSurvivorsBoard(view, survivorsRef);
  useBoardMotion(railRef, view, tab, board);
  const displayTeams = teams ?? view.teams?.map((name) => ({ name, logoUrl: undefined }));
  const feed = cs2FeedForView(view);

  return (
    <section className="cs2-stage" aria-label="Live CS2 arena" data-rail-tab={tab}>
      <div className="cs2-stage__size">
        <div className="cs2-stage__grid">
          <StageMatchBar seriesId={seriesId} teams={displayTeams} embed={embed} competition={competition} format={format} map={map} />
          <Panel className="cs2-stage__broadcast">
            <StageStream embed={embed} />
          </Panel>
          <StagePlayDock
            view={view}
            connected={connected}
            answerSubmission={answerSubmission}
            submitAnswer={submitAnswer}
            muted={muted}
            onToggleMute={onToggleMute}
          />

          <aside className="cs2-stage__rail" aria-label="Arena details" ref={railRef} data-dense={view.leaderboard.length > SURVIVORS_VISIBLE || undefined}>
            <div className="cs2-stage__tabs" role="tablist" aria-label="Arena details" onKeyDown={(event) => {
              const next = event.key === "Home" ? "survivors" : event.key === "End" ? "feed"
                : event.key === "ArrowLeft" || event.key === "ArrowRight" ? tab === "survivors" ? "feed" : "survivors" : undefined;
              if (next === undefined) return;
              event.preventDefault();
              setTab(next);
              document.getElementById(`${id}-${next}`)?.focus();
            }}>
              {(["survivors", "feed"] as const).map((name) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  id={`${id}-${name}`}
                  aria-selected={tab === name}
                  aria-controls={`${id}-${name}-panel`}
                  tabIndex={tab === name ? 0 : -1}
                  className="cs2-stage__tab"
                  onClick={() => setTab(name)}
                >{name === "survivors" ? "Survivors" : "Feed"}</button>
              ))}
            </div>
            <div className="cs2-stage__rail-panel cs2-stage__survivors-panel" role="tabpanel" id={`${id}-survivors-panel`} aria-labelledby={`${id}-survivors`} tabIndex={0} ref={survivorsRef}>
              <Cs2Survivors board={board} active={view.survivors} total={view.totalPlayers} />
            </div>
            <div className="cs2-stage__rail-panel cs2-stage__feed-panel" role="tabpanel" id={`${id}-feed-panel`} aria-labelledby={`${id}-feed`} tabIndex={0}>
              <Cs2MatchFeed items={feed} />
            </div>
            <StageRecentRounds view={view} connected={connected} onShowFeed={() => {
              setTab("feed");
              document.getElementById(`${id}-feed`)?.focus({ preventScroll: true });
            }} />
          </aside>
        </div>
      </div>
    </section>
  );
}
