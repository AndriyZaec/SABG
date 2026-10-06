import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { OperatorAuditEntry, OperatorAuditValue } from "@arena/contracts";
import { AdminApiError, readAudit } from "./api.js";

interface AuditFilters {
  actorId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: AuditFilters = { actorId: "", from: "", to: "" };

const ACTION_LABELS: Record<OperatorAuditEntry["action"], string> = {
  "autopilot.set": "Autopilot",
  "series.priority.set": "Series priority",
  "series.stream.set": "Series stream",
  "series.skip.request": "Series skip",
  "tournament.publish": "Tournament publish",
};

function startOfDay(value: string): string | undefined {
  if (value === "") return undefined;
  return new Date(`${value}T00:00:00`).toISOString();
}

function dayAfter(value: string): string | undefined {
  if (value === "") return undefined;
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function formatValue(value: OperatorAuditValue | undefined): string {
  if (value === undefined) return "—";
  if (value === null) return "None";
  return String(value);
}

function AuditDetails({ entry }: { entry: OperatorAuditEntry }) {
  if (entry.details.reason !== undefined) return <span className="audit-reason">{entry.details.reason}</span>;
  if (entry.details.before === undefined && entry.details.after === undefined) return <span className="muted-value">No details</span>;
  return <span className="audit-change"><code>{formatValue(entry.details.before)}</code><i>→</i><code>{formatValue(entry.details.after)}</code></span>;
}

export function AuditPage({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [form, setForm] = useState<AuditFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AuditFilters>(EMPTY_FILTERS);
  const [entries, setEntries] = useState<OperatorAuditEntry[]>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async (filters: AuditFilters, cursor?: string, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(undefined);
    try {
      const page = await readAudit({
        ...(filters.actorId.trim() !== "" ? { actorId: filters.actorId.trim() } : {}),
        ...(startOfDay(filters.from) !== undefined ? { from: startOfDay(filters.from)! } : {}),
        ...(dayAfter(filters.to) !== undefined ? { to: dayAfter(filters.to)! } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      });
      setEntries((current) => append ? [...(current ?? []), ...page.entries] : page.entries);
      setNextCursor(page.nextCursor);
    } catch (loadError) {
      if (loadError instanceof AdminApiError && loadError.status === 401) {
        onSessionExpired();
        return;
      }
      setError("Operator history could not be loaded.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    void load(EMPTY_FILTERS);
  }, [load]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    setApplied(form);
    void load(form);
  };

  const clearFilters = () => {
    setForm(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    void load(EMPTY_FILTERS);
  };

  const initialLoading = entries === undefined && loading;
  const busy = loading || loadingMore;

  return (
    <section className="page audit-page" aria-busy={initialLoading}>
      <header className="page__header audit-page__header">
        <div><h1>Operator audit</h1><p>Trace state-changing commands, their actor, target, and final result.</p></div>
        <button className="secondary-action" type="button" disabled={busy} onClick={() => void load(applied)}>{loading ? "Refreshing" : "Refresh history"}</button>
      </header>

      <form className="audit-filters" onSubmit={applyFilters}>
        <label className="field"><span>Actor ID</span><input disabled={busy} value={form.actorId} onChange={(event) => setForm({ ...form, actorId: event.target.value })} placeholder="GitHub user ID or legacy-wizard" /></label>
        <label className="field"><span>From date</span><input disabled={busy} type="date" value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })} /></label>
        <label className="field"><span>Through date</span><input disabled={busy} type="date" value={form.to} min={form.from || undefined} onChange={(event) => setForm({ ...form, to: event.target.value })} /></label>
        <div className="audit-filters__actions"><button type="button" onClick={clearFilters} disabled={busy}>Clear</button><button className="primary-action" type="submit" disabled={busy}>Apply filters</button></div>
      </form>

      {error && <div className="status-alert" role="alert"><strong>Audit unavailable</strong><span>{error}</span><button type="button" onClick={() => void load(applied)}>Try again</button></div>}

      {entries !== undefined && (
        <section className="audit-log">
          <div className="audit-log__heading"><div><span className="eyebrow">Append-only history</span><h2>Control commands</h2></div><span>{entries.length} loaded</span></div>
          {entries.length === 0 ? (
            <div className="empty-state audit-empty"><strong>No audit records</strong><span>No state-changing commands match these filters.</span></div>
          ) : (
            <div className="audit-table-wrap">
              <table className="audit-table">
                <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Result</th><th>Summary</th></tr></thead>
                <tbody>{entries.map((entry) => (
                  <tr key={entry.id}>
                    <td><time dateTime={entry.createdAt}>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.createdAt))}</time></td>
                    <td><strong>@{entry.actorLogin}</strong></td>
                    <td><details className="audit-metadata"><summary>{ACTION_LABELS[entry.action]}</summary><small>{entry.action}</small><code>Actor {entry.actorId}</code><code>Request {entry.requestId}</code></details></td>
                    <td><code>{entry.targetId ?? "—"}</code></td>
                    <td><span className={`audit-result audit-result--${entry.result}`}>{entry.result}</span></td>
                    <td><AuditDetails entry={entry} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {nextCursor && <div className="audit-log__pagination"><button className="secondary-action" type="button" disabled={busy} onClick={() => void load(applied, nextCursor, true)}>{loadingMore ? "Loading" : "Load older"}</button></div>}
        </section>
      )}

      {initialLoading && <div className="blocking-overlay"><div className="blocking-overlay__panel"><span>Reading operator history</span></div></div>}
    </section>
  );
}
