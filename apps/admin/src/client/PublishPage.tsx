import { useEffect, useRef, useState } from "react";
import type { Cs2OperatorDiscoveryPayload, Cs2OperatorDiscoverySeries } from "@arena/contracts";
import type { AdminSessionResponse } from "../shared/session.js";
import { AdminApiError, discoverGridSeries, mutateControl, readControlCatalog } from "./api.js";
import type { ControlStatusController } from "./useControlStatus.js";

interface TournamentCandidate {
  id: string;
  name: string;
  shortName?: string;
  scheduledStartTime: string;
  series: Cs2OperatorDiscoverySeries[];
}

function teamName(series: Cs2OperatorDiscoverySeries, index: 0 | 1): string {
  const participant = series.participants[index];
  return participant.state === "known" ? participant.team.name : "TBD";
}

function formatStartTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function groupTournaments(payload: Cs2OperatorDiscoveryPayload, now = Date.now()): TournamentCandidate[] {
  const tournaments = new Map<string, Omit<TournamentCandidate, "scheduledStartTime">>();
  for (const series of payload.series) {
    const tournamentId = series.competition.gridTournamentId;
    const existing = tournaments.get(tournamentId);
    if (existing === undefined) {
      tournaments.set(tournamentId, {
        id: tournamentId,
        name: series.competition.name,
        ...(series.competition.shortName !== undefined ? { shortName: series.competition.shortName } : {}),
        series: [series],
      });
    } else {
      existing.series.push(series);
    }
  }
  return [...tournaments.values()]
    .map((tournament) => {
      const scheduledStartTime = tournament.series
        .map((series) => series.scheduledStartTime)
        .filter((value) => Date.parse(value) >= now)
        .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
      return scheduledStartTime === undefined ? undefined : { ...tournament, scheduledStartTime };
    })
    .filter((tournament): tournament is TournamentCandidate => tournament !== undefined)
    .sort((left, right) => Date.parse(left.scheduledStartTime) - Date.parse(right.scheduledStartTime))
    .slice(0, 25);
}

function disabledReason(series: Cs2OperatorDiscoverySeries): string | undefined {
  if (series.selection.state === "selectable") return undefined;
  switch (series.selection.reason) {
    case "PARTICIPANTS_INCOMPLETE": return undefined;
    case "PARTICIPANTS_INVALID": return "Participants invalid";
    case "FULL_LIVE_DATA_UNAVAILABLE": return "Full live data unavailable";
  }
}

function isPublishable(series: Cs2OperatorDiscoverySeries): boolean {
  return series.liveDataServiceLevel === "FULL" && (
    series.selection.state === "selectable" || series.selection.reason === "PARTICIPANTS_INCOMPLETE"
  );
}

function PublishConfirmation({ series, onCancel, onConfirm }: {
  series: Cs2OperatorDiscoverySeries;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState("");
  const tournamentId = series.competition.gridTournamentId;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog className="confirm-modal publish-modal" ref={dialogRef} aria-labelledby="publish-confirm-title" onCancel={(event) => {
      event.preventDefault();
      onCancel();
    }}>
      <span className="eyebrow">Guarded tournament switch</span>
      <h2 id="publish-confirm-title">Publish {series.competition.name}</h2>
      <div className="publish-confirmation-summary">
        <span>Anchor Series</span><strong>{teamName(series, 0)} vs {teamName(series, 1)}</strong>
        <span>GRID Series</span><strong>{series.gridSeriesId}</strong>
      </div>
      <p>Publishing replaces the active tournament. It does not change autopilot or skip a running Series.</p>
      <label className="field">
        <span>Type tournament ID <strong>{tournamentId}</strong> to confirm</span>
        <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" />
      </label>
      <div className="confirm-modal__actions">
        <button className="secondary-action" type="button" onClick={onCancel}>Cancel</button>
        <button className="primary-action" type="button" disabled={value !== tournamentId} onClick={onConfirm}>Publish tournament</button>
      </div>
    </dialog>
  );
}

export function PublishPage({ session, onSessionExpired, control }: {
  session: AdminSessionResponse;
  onSessionExpired: () => void;
  control: ControlStatusController;
}) {
  const { status, stale, refreshing, loadError, refresh } = control;
  const [discovery, setDiscovery] = useState<Cs2OperatorDiscoveryPayload>();
  const [discoveryError, setDiscoveryError] = useState<string>();
  const [discovering, setDiscovering] = useState(false);
  const [confirmation, setConfirmation] = useState<Cs2OperatorDiscoverySeries>();
  const [mutating, setMutating] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; message: string }>();

  const refreshFromGrid = async () => {
    if (discovering) return;
    setDiscovering(true);
    setDiscoveryError(undefined);
    try {
      setDiscovery(await discoverGridSeries());
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setDiscoveryError("GRID discovery could not be refreshed.");
    } finally {
      setDiscovering(false);
    }
  };

  const publish = async () => {
    if (confirmation === undefined || stale || status === undefined) return;
    const selected = confirmation;
    setConfirmation(undefined);
    setMutating(true);
    setNotice(undefined);
    try {
      const response = await mutateControl(session, {
        type: "tournament.publish",
        gridTournamentId: selected.competition.gridTournamentId,
        gridSeriesId: selected.gridSeriesId,
      });
      if (response.httpStatus === 409) {
        setNotice({ tone: "danger", message: "Another tournament publication is already in progress." });
      } else if (response.result.status === "refused") {
        setNotice({ tone: "danger", message: response.result.reason });
      } else {
        setNotice({ tone: "success", message: `${selected.competition.name} published.` });
      }
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setNotice({ tone: "danger", message: "Tournament publication failed." });
    } finally {
      await Promise.all([
        refresh(true),
        readControlCatalog().catch((error: unknown) => {
          if (error instanceof AdminApiError && error.status === 401) onSessionExpired();
        }),
      ]);
      setMutating(false);
    }
  };

  if (status === undefined) {
    return (
      <section className="page publish-page" aria-busy="true">
        <header className="page__header"><div><h1>Publish tournament</h1><p>Inspect GRID candidates and switch the active tournament through the guarded publication flow.</p></div></header>
        <div className="blocking-overlay"><div className="blocking-overlay__panel"><span>{loadError ?? "Reading publication safety state"}</span>{loadError && <button className="secondary-action" type="button" onClick={() => void refresh()}>Try again</button>}</div></div>
      </section>
    );
  }

  const blockers = [
    ...(status.runningSeriesIds.length > 0 ? [`${status.runningSeriesIds.length} Series running`] : []),
    ...(status.unfinishedArenaCount > 0 ? [`${status.unfinishedArenaCount} unfinished Arena${status.unfinishedArenaCount === 1 ? "" : "s"}`] : []),
  ];
  const publishBlocked = stale || blockers.length > 0;
  const tournaments = discovery === undefined ? [] : groupTournaments(discovery);

  return (
    <section className="page publish-page">
      <header className="page__header publish-page__header">
        <div><h1>Publish tournament</h1><p>Inspect GRID candidates and switch the active tournament through the guarded publication flow.</p></div>
        <div className="publish-page__actions">
          <div><button className="status-refresh" type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Refreshing" : "Refresh status"}</button><button className="grid-refresh" type="button" onClick={() => void refreshFromGrid()} disabled={discovering}>{discovering ? "Refreshing GRID" : "Refresh from GRID"}</button></div>
        </div>
      </header>

      {(loadError || stale) && <div className="status-alert" role="alert"><strong>{stale ? "Publishing paused" : "Status refresh failed"}</strong><span>{stale ? "Refresh runtime status before publishing." : loadError}</span><button type="button" onClick={() => void refresh()} disabled={refreshing}>Refresh status</button></div>}
      {notice && <div className={`operation-notice operation-notice--${notice.tone}`} role="status">{notice.message}</div>}

      <section className="publish-safety">
        <div className={blockers.length > 0 ? "publish-safety__item publish-safety__item--blocked" : "publish-safety__item"}><span>Runtime blockers</span><strong>{blockers.length > 0 ? blockers.join(" · ") : "Clear"}</strong></div>
        <div className={status.autopilotEnabled ? "publish-safety__item publish-safety__item--warning" : "publish-safety__item"}><span>Autopilot</span><strong>{status.autopilotEnabled ? "On · eligible Series may launch" : "Off"}</strong></div>
      </section>

      {blockers.length > 0 && <div className="publish-guidance"><strong>Skip, wait, then publish.</strong><span>Publishing never skips a Series automatically. Paid entries can prevent Skip.</span></div>}

      <section className="discovery-workspace" aria-busy={discovering}>
        <div className="discovery-workspace__heading">
          <div><span className="eyebrow">GRID discovery</span><h2>Upcoming tournament candidates</h2></div>
          {discovery && <span>{tournaments.length} tournaments · {discovery.series.length} Series<br />{formatStartTime(discovery.window.from)} – {formatStartTime(discovery.window.to)}</span>}
        </div>

        {discoveryError && <div className="inline-error" role="alert">{discoveryError}</div>}
        {discovery === undefined && !discovering && !discoveryError && <div className="discovery-empty"><strong>Discovery has not run</strong><span>Use Refresh from GRID to fetch upcoming candidates. This action is never automatic.</span></div>}
        {discovering && discovery === undefined && <div className="discovery-empty"><strong>Reading GRID</strong><span>Fetching and validating upcoming Series.</span></div>}
        {discovery && tournaments.length === 0 && <div className="discovery-empty"><strong>No candidates found</strong><span>GRID returned no Series in the configured discovery window.</span></div>}

        <div className="tournament-list">
          {tournaments.map((tournament) => {
            const eligible = tournament.series.filter(isPublishable);
            const anchor = eligible[0];
            return (
              <article className="tournament-candidate" key={tournament.id}>
                <header className="tournament-row">
                  <div className="tournament-row__name"><strong>{tournament.name}</strong><code>{tournament.id}</code></div>
                  <div><span>Next start</span><strong>{formatStartTime(tournament.scheduledStartTime)}</strong></div>
                  <div><span>Series ready</span><strong>{eligible.length} / {tournament.series.length}</strong></div>
                  <div><span>Anchor</span><strong>{anchor === undefined ? "Unavailable" : `${teamName(anchor, 0)} vs ${teamName(anchor, 1)}`}</strong></div>
                  <button className="primary-action" type="button" disabled={anchor === undefined || publishBlocked} onClick={() => anchor !== undefined && setConfirmation(anchor)}>Publish tournament</button>
                </header>
                <details className="tournament-series-details"><summary>View {tournament.series.length} Series</summary><div>{tournament.series.map((series) => <p key={series.gridSeriesId}><span><strong>{teamName(series, 0)} vs {teamName(series, 1)}</strong><small>{formatStartTime(series.scheduledStartTime)} · BO{series.format} · GRID {series.gridSeriesId}</small></span>{disabledReason(series) !== undefined && <em>{disabledReason(series)}</em>}</p>)}</div></details>
              </article>
            );
          })}
        </div>
      </section>

      {confirmation && <PublishConfirmation series={confirmation} onCancel={() => setConfirmation(undefined)} onConfirm={() => void publish()} />}
      {mutating && <div className="blocking-overlay" role="status"><span>Publishing tournament</span></div>}
    </section>
  );
}
