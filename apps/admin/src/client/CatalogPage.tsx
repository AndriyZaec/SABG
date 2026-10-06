import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { normalizeCs2StreamUrl } from "@arena/contracts";
import type {
  AdminCatalogResponse,
  AdminCatalogSeries,
  AdminMutationCommand,
  Cs2OperatorDiscoverySeries,
} from "@arena/contracts";
import type { AdminSessionResponse } from "../shared/session.js";
import { AdminApiError, inspectGridSeries, mutateControl, readControlCatalog } from "./api.js";
import type { ControlStatusController } from "./useControlStatus.js";

function teamName(series: AdminCatalogSeries, index: 0 | 1): string {
  const participant = series.participants[index];
  return participant.state === "known" ? participant.team.name : "TBD";
}

function lookupTeamName(series: Cs2OperatorDiscoverySeries, index: 0 | 1): string {
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

function SkipConfirmation({ series, stale, onCancel, onConfirm }: {
  series: AdminCatalogSeries;
  stale: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState("");
  const matches = value === series.gridSeriesId;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog className="confirm-modal skip-modal" ref={dialogRef} aria-labelledby="skip-confirm-title" onCancel={(event) => {
      event.preventDefault();
      onCancel();
    }}>
      <span className="eyebrow">Destructive Series action</span>
      <h2 id="skip-confirm-title">Request Series skip</h2>
      <p>This stops Series <strong>{teamName(series, 0)} vs {teamName(series, 1)}</strong>. Paid entries will make the server refuse this request.</p>
      <label className="field">
        <span>Type <strong>{series.gridSeriesId}</strong> to confirm</span>
        <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" />
      </label>
      <div className="confirm-modal__actions">
        <button className="secondary-action" type="button" onClick={onCancel}>Cancel</button>
        <button className="danger-action" type="button" disabled={!matches || stale} onClick={onConfirm}>Request skip</button>
      </div>
    </dialog>
  );
}

export function CatalogPage({ session, onSessionExpired, control }: {
  session: AdminSessionResponse;
  onSessionExpired: () => void;
  control: ControlStatusController;
}) {
  const { status, stale, refreshing: statusRefreshing, loadError: statusError, refresh: refreshStatus } = control;
  const [catalog, setCatalog] = useState<AdminCatalogResponse>();
  const [catalogError, setCatalogError] = useState<string>();
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; message: string }>();
  const [streamEditor, setStreamEditor] = useState<{ series: AdminCatalogSeries; value: string; error?: string }>();
  const [skipSeries, setSkipSeries] = useState<AdminCatalogSeries>();
  const [lookupId, setLookupId] = useState("");
  const [lookupResult, setLookupResult] = useState<Cs2OperatorDiscoverySeries>();
  const [lookupError, setLookupError] = useState<string>();
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupOpen, setLookupOpen] = useState(false);
  const catalogRef = useRef<AdminCatalogResponse>();
  const catalogInFlight = useRef<Promise<void>>();

  const refreshCatalog = useCallback(async (force = false) => {
    if (catalogInFlight.current !== undefined) {
      if (!force) return catalogInFlight.current;
      await catalogInFlight.current;
    }
    if (catalogRef.current !== undefined) setCatalogRefreshing(true);
    setCatalogError(undefined);
    const operation = readControlCatalog()
      .then((nextCatalog) => {
        catalogRef.current = nextCatalog;
        setCatalog(nextCatalog);
      })
      .catch((error: unknown) => {
        if (error instanceof AdminApiError && error.status === 401) {
          onSessionExpired();
          return;
        }
        setCatalogError("Could not refresh the Series catalog.");
      })
      .finally(() => {
        setCatalogRefreshing(false);
        catalogInFlight.current = undefined;
      });
    catalogInFlight.current = operation;
    return operation;
  }, [onSessionExpired]);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  const runMutation = async (command: AdminMutationCommand, successMessage: string) => {
    if (stale) return;
    setMutating(true);
    setNotice(undefined);
    try {
      const response = await mutateControl(session, command);
      if (response.result.status === "refused") {
        setNotice({ tone: "danger", message: response.result.reason });
      } else {
        setNotice({ tone: "success", message: successMessage });
        setStreamEditor(undefined);
        setSkipSeries(undefined);
      }
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setNotice({ tone: "danger", message: "The control command could not be completed." });
    } finally {
      await Promise.all([refreshStatus(true), refreshCatalog(true)]);
      setMutating(false);
    }
  };

  const saveStream = (event: FormEvent) => {
    event.preventDefault();
    if (streamEditor === undefined) return;
    try {
      const stream = normalizeCs2StreamUrl(streamEditor.value);
      void runMutation(
        { type: "series.stream.set", gridSeriesId: streamEditor.series.gridSeriesId, streamUrl: stream.url },
        `${stream.provider} stream saved.`,
      );
    } catch (error) {
      setStreamEditor({
        ...streamEditor,
        error: error instanceof Error ? error.message : "Stream URL is invalid.",
      });
    }
  };

  const lookup = async (event: FormEvent) => {
    event.preventDefault();
    const gridSeriesId = lookupId.trim();
    if (gridSeriesId.length === 0) return;
    setLookingUp(true);
    setLookupError(undefined);
    setLookupResult(undefined);
    try {
      const payload = await inspectGridSeries(gridSeriesId);
      const result = payload.series.find((series) => series.gridSeriesId === gridSeriesId);
      if (result === undefined) setLookupError(`GRID Series ${gridSeriesId} was not found.`);
      else setLookupResult(result);
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setLookupError("GRID Series lookup failed.");
    } finally {
      setLookingUp(false);
    }
  };

  if (status === undefined || catalog === undefined) {
    return (
      <section className="page catalog-page" aria-busy="true">
        <header className="page__header"><div><h1>Series catalog</h1><p>Review active Series and make deliberate changes to priority and stream configuration.</p></div></header>
        <div className="blocking-overlay">
          <div className="blocking-overlay__panel">
            <span>{statusError ?? catalogError ?? "Reading authoritative Series catalog"}</span>
            {(statusError || catalogError) && <button className="secondary-action" type="button" onClick={() => void Promise.all([refreshStatus(), refreshCatalog()])}>Try again</button>}
          </div>
        </div>
      </section>
    );
  }

  const refreshAll = () => Promise.all([refreshStatus(), refreshCatalog()]);
  const refreshing = statusRefreshing || catalogRefreshing;

  return (
    <section className="page catalog-page">
      <header className="page__header catalog-page__header">
        <div>
          <h1>Series catalog</h1>
          <p>Review active Series and make deliberate changes to priority and stream configuration.</p>
        </div>
        <div className="catalog-header-actions">
          <button className="secondary-action" type="button" onClick={() => setLookupOpen((open) => !open)}>{lookupOpen ? "Close lookup" : "Find exact Series"}</button>
          <button className="secondary-action" type="button" onClick={() => void refreshAll()} disabled={refreshing}>{refreshing ? "Refreshing" : "Refresh catalog"}</button>
        </div>
      </header>

      {(statusError || catalogError || stale) && (
        <div className="status-alert" role="alert">
          <strong>{stale ? "Controls paused" : "Refresh failed"}</strong>
          <span>{stale ? "Refresh runtime status before making changes." : statusError ?? catalogError}</span>
        </div>
      )}
      {notice && <div className={`operation-notice operation-notice--${notice.tone}`} role="status">{notice.message}</div>}

      {lookupOpen && <section className="catalog-lookup">
        <div><span className="eyebrow">Manual GRID lookup</span><h2>Find exact Series</h2></div>
        <form onSubmit={(event) => void lookup(event)}>
          <label className="field"><span>GRID Series ID</span><input value={lookupId} onChange={(event) => setLookupId(event.target.value)} placeholder="e.g. 2985953" /></label>
          <button className="secondary-action" type="submit" disabled={lookingUp || lookupId.trim().length === 0}>{lookingUp ? "Looking up" : "Find Series"}</button>
        </form>
        {lookupError && <span className="field-error" role="alert">{lookupError}</span>}
        {lookupResult && (
          <div className="lookup-result">
            <div><strong>{lookupTeamName(lookupResult, 0)} vs {lookupTeamName(lookupResult, 1)}</strong><span>{lookupResult.competition.shortName ?? lookupResult.competition.name} · BO{lookupResult.format} · {formatStartTime(lookupResult.scheduledStartTime)}</span></div>
            <div><span className={`state-chip ${lookupResult.selection.state === "selectable" ? "state-chip--on" : ""}`}>{lookupResult.selection.state}</span><small>GRID {lookupResult.gridSeriesId}</small></div>
          </div>
        )}
      </section>}

      <section className="catalog-table-section">
        <div className="catalog-table-heading">
          <div><span className="eyebrow">Active tournament catalog</span><h2>Series</h2></div>
          <span>{catalog.series.length} Series</span>
        </div>
        {catalog.series.length === 0 ? (
          <div className="empty-state catalog-empty"><strong>No Series in the active catalog</strong><span>Publish a tournament to populate this workspace.</span></div>
        ) : (
          <div className="catalog-table-wrap">
            <table className="catalog-table">
              <thead><tr><th>Series</th><th>Start</th><th>Operational state</th><th>Stream</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {catalog.series.map((series) => {
                  let stream: ReturnType<typeof normalizeCs2StreamUrl> | undefined;
                  try { if (series.streamUrl !== undefined) stream = normalizeCs2StreamUrl(series.streamUrl); } catch { /* Stored legacy values remain visible without an action link. */ }
                  const mutable = series.status === "active" && !stale && !mutating;
                  return (
                    <tr key={series.gridSeriesId}>
                      <td><strong>{teamName(series, 0)} vs {teamName(series, 1)}</strong><span>{series.competition.shortName ?? series.competition.name} · BO{series.format}</span><small>GRID {series.gridSeriesId}</small></td>
                      <td><strong>{formatStartTime(series.scheduledStartTime)}</strong><span className="text-capitalize">{series.lifecycle}</span></td>
                      <td><span className={`catalog-status catalog-status--${series.status}`}>{series.arena}</span>{series.priority && <small className="priority-marker">Priority on</small>}{series.skipRequested && <small>Skip requested</small>}</td>
                      <td>{stream === undefined ? <span className="muted-value">Not set</span> : <><span className="provider-label">{stream.provider}</span><code className="stream-url">{stream.url}</code><a href={stream.url} target="_blank" rel="noreferrer">Open stream</a></>}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" disabled={!mutable} aria-pressed={series.priority} className={series.priority ? "is-active" : ""} onClick={() => void runMutation({ type: "series.priority.set", gridSeriesId: series.gridSeriesId, priority: !series.priority }, `Priority ${series.priority ? "removed" : "enabled"}.`)}>Priority {series.priority ? "on" : "off"}</button>
                          <button type="button" disabled={!mutable} onClick={() => setStreamEditor({ series, value: series.streamUrl ?? "" })}>Stream</button>
                          <button type="button" disabled={!mutable || series.skipRequested} className="row-actions__danger" onClick={() => setSkipSeries(series)}>Skip</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {streamEditor && (
        <section className="stream-editor">
          <div><span className="eyebrow">Stream configuration</span><h2>{teamName(streamEditor.series, 0)} vs {teamName(streamEditor.series, 1)}</h2></div>
          <form onSubmit={saveStream}>
            <label className="field"><span>Twitch, Kick, or YouTube URL</span><input autoFocus value={streamEditor.value} onChange={(event) => setStreamEditor({ ...streamEditor, value: event.target.value, error: undefined })} /></label>
            {streamEditor.error && <span className="field-error" role="alert">{streamEditor.error}</span>}
            <div className="stream-editor__actions">
              <button className="secondary-action" type="button" onClick={() => setStreamEditor(undefined)}>Cancel</button>
              {streamEditor.series.streamUrl !== undefined && <button className="danger-action" type="button" disabled={stale} onClick={() => void runMutation({ type: "series.stream.set", gridSeriesId: streamEditor.series.gridSeriesId, streamUrl: null }, "Stream cleared.")}>Clear stream</button>}
              <button className="primary-action" type="submit" disabled={stale || streamEditor.value.trim().length === 0}>Save stream</button>
            </div>
          </form>
        </section>
      )}

      {skipSeries && <SkipConfirmation series={skipSeries} stale={stale} onCancel={() => setSkipSeries(undefined)} onConfirm={() => void runMutation({ type: "series.skip.request", gridSeriesId: skipSeries.gridSeriesId }, "Skip requested.")} />}
      {mutating && <div className="blocking-overlay" role="status"><span>Applying Series change</span></div>}
    </section>
  );
}
