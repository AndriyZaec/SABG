import { useEffect, useRef, useState } from "react";
import type { AdminCatalogResponse, AdminCatalogSeries } from "@arena/contracts";
import type { AdminSessionResponse } from "../shared/session.js";
import { AdminApiError, readControlCatalog, setAutopilot } from "./api.js";
import type { ControlStatusController } from "./useControlStatus.js";

function teamName(series: AdminCatalogSeries, index: 0 | 1): string {
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

function AutopilotConfirmation({ enabled, onCancel, onConfirm }: {
  enabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      className="confirm-modal"
      ref={dialogRef}
      aria-labelledby="autopilot-confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <span className="eyebrow">Confirm runtime change</span>
      <h2 id="autopilot-confirm-title">Turn autopilot {enabled ? "on" : "off"}?</h2>
      <p>{enabled ? "The system may launch the next eligible Series." : "Running Series continue, but no new Series will launch automatically."}</p>
      <div className="confirm-modal__actions">
        <button className="secondary-action" type="button" autoFocus onClick={onCancel}>Cancel</button>
        <button className={enabled ? "primary-action" : "danger-action"} type="button" onClick={onConfirm}>Confirm</button>
      </div>
    </dialog>
  );
}

export function OverviewPage({ session, onSessionExpired, control }: {
  session: AdminSessionResponse;
  onSessionExpired: () => void;
  control: ControlStatusController;
}) {
  const [catalog, setCatalog] = useState<AdminCatalogResponse>();
  const [confirmation, setConfirmation] = useState<boolean>();
  const [mutating, setMutating] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; message: string }>();
  const { status, stale, refreshing, loadError, refresh } = control;

  useEffect(() => {
    if (status === undefined) return;
    void readControlCatalog()
      .then(setCatalog)
      .catch((error: unknown) => {
        if (error instanceof AdminApiError && error.status === 401) onSessionExpired();
      });
  }, [status?.generatedAt, onSessionExpired]);

  const confirmAutopilot = async () => {
    if (confirmation === undefined || stale) return;
    const enabled = confirmation;
    setConfirmation(undefined);
    setMutating(true);
    setNotice(undefined);
    try {
      const response = await setAutopilot(session, enabled);
      if (response.result.status === "refused") {
        setNotice({ tone: "danger", message: response.result.reason });
      } else {
        setNotice({ tone: "success", message: `Autopilot ${enabled ? "enabled" : "disabled"}.` });
      }
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setNotice({ tone: "danger", message: "Autopilot could not be changed." });
    } finally {
      await refresh(true);
      setMutating(false);
    }
  };

  if (status === undefined) {
    return (
      <section className="page overview" aria-busy="true">
        <header className="page__header">
          <div><h1>Overview</h1><p>Monitor the active tournament, application state, and autopilot from one control surface.</p></div>
        </header>
        <div className="blocking-overlay">
          <div className="blocking-overlay__panel">
            <span>{loadError ?? "Reading authoritative runtime state"}</span>
            {loadError && <button className="secondary-action" type="button" onClick={() => void refresh()}>Try again</button>}
          </div>
        </div>
      </section>
    );
  }

  const runningSeries = status.runningSeriesIds.map((gridSeriesId) => ({
    gridSeriesId,
    detail: catalog?.series.find((series) => series.gridSeriesId === gridSeriesId),
  }));

  return (
    <section className="page overview">
      <header className="page__header overview__header">
        <div>
          <h1>Live operations</h1>
          <p>See what is running, what needs attention, and what the autopilot can do next.</p>
        </div>
        <div className="overview__freshness">
          <button type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Refreshing" : "Refresh status"}</button>
        </div>
      </header>

      {(loadError || stale) && (
        <div className="status-alert" role="alert">
          <strong>{stale ? "Controls paused" : "Background refresh failed"}</strong>
          <span>{stale ? "Refresh runtime status before making changes." : loadError}</span>
        </div>
      )}
      {notice && <div className={`operation-notice operation-notice--${notice.tone}`} role="status">{notice.message}</div>}

      <div className="overview-panels">
        <section className="series-panel series-panel--primary">
          <div className="series-panel__heading">
            <div>
              <span className="eyebrow">Now running</span>
              <h2>Active Series</h2>
            </div>
            <span className="series-count">{runningSeries.length}</span>
          </div>
          {runningSeries.length === 0 ? (
            <div className="empty-state"><strong>No Series running</strong><span>The autopilot is waiting for an eligible Series.</span></div>
          ) : (
            <ul className="series-list">
              {runningSeries.map(({ gridSeriesId, detail }) => (
                <li key={gridSeriesId}>
                  <i />
                  <div className="series-list__body">
                    <strong>{detail === undefined ? "Running Series" : `${teamName(detail, 0)} vs ${teamName(detail, 1)}`}</strong>
                    {detail !== undefined && (
                      <span>{detail.competition.shortName ?? detail.competition.name} · BO{detail.format} · {formatStartTime(detail.scheduledStartTime)} · {detail.lifecycle}</span>
                    )}
                  </div>
                  <span className="series-list__id">GRID {gridSeriesId}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="control-panel">
          <div className="control-panel__heading">
            <div>
              <span className="eyebrow">Automatic selection</span>
              <h2>Autopilot</h2>
            </div>
            <span className={`state-chip ${status.autopilotEnabled ? "state-chip--on" : ""}`}>{status.autopilotEnabled ? "On" : "Off"}</span>
          </div>
          <p>{status.autopilotEnabled ? "Eligible Series may start automatically." : "Automatic Series selection is paused."}</p>
          <button
            className={status.autopilotEnabled ? "danger-action" : "primary-action"}
            type="button"
            disabled={stale || mutating}
            onClick={() => setConfirmation(!status.autopilotEnabled)}
          >
            Turn autopilot {status.autopilotEnabled ? "off" : "on"}
          </button>
        </section>

        <section className={status.unfinishedArenaCount > 0 || status.appHealth !== "healthy" ? "attention-panel attention-panel--warning" : "attention-panel"}>
          <span className="eyebrow">Attention</span>
          <h2>{status.unfinishedArenaCount > 0 || status.appHealth !== "healthy" ? "Action required" : "No blockers"}</h2>
          <ul>
            {status.unfinishedArenaCount > 0 && <li><strong>{status.unfinishedArenaCount} unfinished Arena{status.unfinishedArenaCount === 1 ? "" : "s"}</strong><span>Publication stays blocked until the Arena finishes or an eligible Series is skipped.</span></li>}
            {status.appHealth !== "healthy" && <li><strong>Application {status.appHealth}</strong><span>Confirm service health before changing runtime state.</span></li>}
            {status.unfinishedArenaCount === 0 && status.appHealth === "healthy" && <li><strong>Runtime clear</strong><span>No unfinished Arena blocks tournament publication.</span></li>}
          </ul>
        </section>
      </div>

      {confirmation !== undefined && (
        <AutopilotConfirmation
          enabled={confirmation}
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => void confirmAutopilot()}
        />
      )}

      {mutating && <div className="blocking-overlay" role="status"><span>Applying runtime change</span></div>}
    </section>
  );
}
