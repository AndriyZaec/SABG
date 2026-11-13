import type { Cs2SeriesMapSummary, Cs2SeriesSummary, Cs2TeamSummary } from "@arena/contracts";
import { Link } from "react-router-dom";
import { Badge } from "../../ui/Badge.js";
import { Panel } from "../../ui/Panel.js";
import type { StreamEmbed } from "../stream/streamEmbed.js";
import { TeamLogo } from "../TeamLogo.js";

export function StageMatchBar({ seriesId, teams, embed, competition, format, map }: {
  seriesId: string;
  teams?: readonly Pick<Cs2TeamSummary, "name" | "logoUrl">[];
  embed?: StreamEmbed;
  competition?: Cs2SeriesSummary["competition"];
  format?: Cs2SeriesSummary["format"];
  map?: Pick<Cs2SeriesMapSummary, "seriesMatchIndex" | "mapName">;
}) {
  const info = [competition?.shortName ?? competition?.name, format !== undefined ? `BO${format}` : undefined, map ? `Map ${map.seriesMatchIndex}` : undefined, map?.mapName].filter((part) => part !== undefined && part !== "").join(" · ");
  return (
    <div className="cs2-stage__match-row">
      <Link className="nb-btn nb-btn--plain cs2-stage__back" to={`/cs2/series/${seriesId}`} title="Back to series" aria-label="Back to series">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7" /></svg>
      </Link>
      <Panel className="cs2-stage__match-bar">
        <div className="cs2-stage__teams">
          {teams ? teams.map((team, i) => (
            <div className="cs2-stage__team" key={i}>
              {i === 0 && <TeamLogo name={team.name} src={team.logoUrl} />}
              {i > 0 && <span className="cs2-stage__versus">vs</span>}
              <span className="cs2-stage__team-name">{team.name}</span>
              {i > 0 && <TeamLogo name={team.name} src={team.logoUrl} />}
            </div>
          )) : <span>Waiting for teams…</span>}
        </div>
        {info && <span className="cs2-stage__series-info" title={info}>{info}</span>}
        {embed && <Badge tone="live">LIVE · {embed.label}</Badge>}
      </Panel>
    </div>
  );
}
