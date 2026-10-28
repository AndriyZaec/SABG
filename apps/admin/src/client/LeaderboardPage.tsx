import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  AdminLeaderboardCompetition,
  AdminLeaderboardResponse,
  AdminLeaderboardScope,
  AdminMutationCommand,
} from "@arena/contracts";
import type { AdminSessionResponse } from "../shared/session.js";
import { AdminApiError, mutateControl, readLeaderboard } from "./api.js";

type Confirmation =
  | { kind: "current"; scope: AdminLeaderboardScope }
  | { kind: "close" }
  | { kind: "remove"; scopeId: string; competition: AdminLeaderboardCompetition };

const LAMPORTS_PER_SOL = 1_000_000_000;

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatSol(lamports: number): string {
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(lamports / LAMPORTS_PER_SOL)} SOL`;
}

function competitionName(competition: AdminLeaderboardCompetition): string {
  return competition.shortName ?? competition.name;
}

function ConfirmDialog({ eyebrow, title, children, confirmLabel, destructive = true, onCancel, onConfirm }: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
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
    <dialog className="confirm-modal" ref={dialogRef} aria-labelledby="leaderboard-confirm-title" onCancel={(event) => {
      event.preventDefault();
      onCancel();
    }}>
      <span className="eyebrow">{eyebrow}</span>
      <h2 id="leaderboard-confirm-title">{title}</h2>
      {children}
      <div className="confirm-modal__actions">
        <button className="secondary-action" type="button" autoFocus onClick={onCancel}>Cancel</button>
        <button className={destructive ? "danger-action" : "primary-action"} type="button" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}

export function LeaderboardPage({ session, onSessionExpired }: {
  session: AdminSessionResponse;
  onSessionExpired: () => void;
}) {
  const [data, setData] = useState<AdminLeaderboardResponse>();
  const [loadError, setLoadError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; message: string }>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [newName, setNewName] = useState("");
  const [rename, setRename] = useState<{ scope: AdminLeaderboardScope; value: string }>();
  const [editingScopeId, setEditingScopeId] = useState<string>();

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setLoadError(undefined);
    try {
      setData(await readLeaderboard());
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setLoadError("Could not read the leaderboard.");
    } finally {
      setRefreshing(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runMutation = async (command: AdminMutationCommand, successMessage: string) => {
    setConfirmation(undefined);
    setMutating(true);
    setNotice(undefined);
    try {
      const response = await mutateControl(session, command);
      if (response.result.status === "refused") {
        setNotice({ tone: "danger", message: response.result.reason });
      } else {
        setNotice({ tone: "success", message: successMessage });
        setRename(undefined);
        if (command.type === "leaderboard.scope.create") setNewName("");
      }
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setNotice({ tone: "danger", message: "The leaderboard command could not be completed." });
    } finally {
      await refresh();
      setMutating(false);
    }
  };

  if (data === undefined) {
    return (
      <section className="page leaderboard-page" aria-busy="true">
        <header className="page__header"><div><h1>Leaderboard</h1><p>Choose which tournaments count toward the player leaderboard.</p></div></header>
        <div className="blocking-overlay">
          <div className="blocking-overlay__panel">
            <span>{loadError ?? "Reading leaderboard scopes"}</span>
            {loadError && <button className="secondary-action" type="button" onClick={() => void refresh()}>Try again</button>}
          </div>
        </div>
      </section>
    );
  }

  const currentScope = data.scopes.find((scope) => scope.current);
  const openScopes = data.scopes.filter((scope) => scope.status === "open");
  const editingScope = openScopes.find((scope) => scope.id === editingScopeId)
    ?? (currentScope?.status === "open" ? currentScope : openScopes[0]);
  const scopeName = (scopeId: string) => data.scopes.find((scope) => scope.id === scopeId)?.name ?? scopeId;
  const unfinishedInCurrent = currentScope === undefined
    ? []
    : data.competitions.filter((competition) => competition.unfinished && competition.scopeIds.includes(currentScope.id));

  const createScope = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (name.length === 0) return;
    void runMutation({ type: "leaderboard.scope.create", name }, `Scope ${name} created.`);
  };

  const saveRename = (event: FormEvent) => {
    event.preventDefault();
    if (rename === undefined) return;
    const name = rename.value.trim();
    if (name.length === 0) return;
    void runMutation({ type: "leaderboard.scope.rename", scopeId: rename.scope.id, name }, `Scope renamed to ${name}.`);
  };

  const toggleCompetition = (scope: AdminLeaderboardScope, competition: AdminLeaderboardCompetition) => {
    if (!competition.scopeIds.includes(scope.id)) {
      void runMutation(
        { type: "leaderboard.competition.add", scopeId: scope.id, competitionId: competition.id },
        `${competitionName(competition)} added to ${scope.name}.`,
      );
    } else if (scope.current) {
      setConfirmation({ kind: "remove", scopeId: scope.id, competition });
    } else {
      void runMutation(
        { type: "leaderboard.competition.remove", scopeId: scope.id, competitionId: competition.id },
        `${competitionName(competition)} removed from ${scope.name}.`,
      );
    }
  };

  const unfinishedWarning = unfinishedInCurrent.length > 0 && currentScope !== undefined && (
    <p className="leaderboard-warning">
      {currentScope.name} holds an unfinished tournament: {unfinishedInCurrent.map(competitionName).join(", ")}.
      Its later arenas will not count unless it is added to another scope.
    </p>
  );

  return (
    <section className="page leaderboard-page">
      <header className="page__header leaderboard-page__header">
        <div>
          <h1>Leaderboard</h1>
          <p>Choose which tournaments count toward the player leaderboard and which scope players see.</p>
        </div>
        <button className="secondary-action" type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Refreshing" : "Refresh"}</button>
      </header>

      {loadError && <div className="status-alert" role="alert"><strong>Refresh failed</strong><span>{loadError}</span></div>}
      {notice && <div className={`operation-notice operation-notice--${notice.tone}`} role="status">{notice.message}</div>}

      <section className="control-panel leaderboard-current">
        <div className="control-panel__heading">
          <div>
            <span className="eyebrow">Shown to players</span>
            <h2>{currentScope?.name ?? "No current scope"}</h2>
          </div>
          <span className={`state-chip ${currentScope !== undefined ? "state-chip--on" : ""}`}>{currentScope !== undefined ? "Current" : "Coming soon"}</span>
        </div>
        <p>
          {currentScope === undefined
            ? "Players see a coming-soon page until a scope is made current."
            : data.current?.computedAt !== undefined
              ? `Last computed ${formatDateTime(data.current.computedAt)}.`
              : "Not computed yet: the first recompute runs after the next arena or within 15 minutes."}
        </p>
        {currentScope !== undefined && (
          <button className="danger-action" type="button" disabled={mutating} onClick={() => setConfirmation({ kind: "close" })}>Close current scope</button>
        )}
      </section>

      <section className="catalog-table-section">
        <div className="catalog-table-heading">
          <div><span className="eyebrow">Open and closed</span><h2>Scopes</h2></div>
          <form className="leaderboard-new-scope" onSubmit={createScope}>
            <label className="field"><span>New scope name</span><input value={newName} maxLength={80} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. November 2026" /></label>
            <button className="primary-action" type="submit" disabled={mutating || newName.trim().length === 0}>Create scope</button>
          </form>
        </div>
        {data.scopes.length === 0 ? (
          <div className="empty-state catalog-empty"><strong>No scopes yet</strong><span>Create a scope, add tournaments to it, then make it current.</span></div>
        ) : (
          <div className="catalog-table-wrap">
            <table className="catalog-table leaderboard-table">
              <thead><tr><th>Scope</th><th>State</th><th>Tournaments</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.scopes.map((scope) => (
                  <tr key={scope.id}>
                    <td><strong>{scope.name}</strong><small>{scope.id}</small></td>
                    <td>
                      <span className={`state-chip ${scope.current ? "state-chip--on" : ""}`}>{scope.current ? "Current" : scope.status === "open" ? "Open" : "Closed"}</span>
                      {scope.closedAt !== undefined && <small>Closed {formatDateTime(scope.closedAt)}</small>}
                    </td>
                    <td>{data.competitions.filter((competition) => competition.scopeIds.includes(scope.id)).length}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" disabled={mutating} onClick={() => setRename({ scope, value: scope.name })}>Rename</button>
                        {scope.status === "open" && !scope.current && (
                          <button type="button" disabled={mutating} onClick={() => setConfirmation({ kind: "current", scope })}>Make current</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {rename && (
        <section className="stream-editor">
          <div><span className="eyebrow">Rename scope</span><h2>{rename.scope.name}</h2></div>
          <form onSubmit={saveRename}>
            <label className="field"><span>Scope name</span><input autoFocus value={rename.value} maxLength={80} onChange={(event) => setRename({ ...rename, value: event.target.value })} /></label>
            <div className="stream-editor__actions">
              <button className="secondary-action" type="button" onClick={() => setRename(undefined)}>Cancel</button>
              <button className="primary-action" type="submit" disabled={mutating || rename.value.trim().length === 0}>Save name</button>
            </div>
          </form>
        </section>
      )}

      <section className="catalog-table-section">
        <div className="catalog-table-heading">
          <div><span className="eyebrow">Synced tournaments</span><h2>Tournaments</h2></div>
          {openScopes.length > 0 && editingScope !== undefined && (
            <label className="field leaderboard-scope-picker">
              <span>Edit tournaments of</span>
              <select value={editingScope.id} onChange={(event) => setEditingScopeId(event.target.value)}>
                {openScopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.name}{scope.current ? " (current)" : ""}</option>)}
              </select>
            </label>
          )}
        </div>
        {data.competitions.length === 0 ? (
          <div className="empty-state catalog-empty"><strong>No synced tournaments</strong><span>Tournaments appear here once their Series are synced.</span></div>
        ) : (
          <div className="catalog-table-wrap">
            <table className="catalog-table leaderboard-table">
              <thead><tr><th>Tournament</th><th>Arenas with results</th><th>In scopes</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.competitions.map((competition) => {
                  const included = editingScope !== undefined && competition.scopeIds.includes(editingScope.id);
                  return (
                    <tr key={competition.id}>
                      <td>
                        <strong>{competition.name}</strong>
                        {competition.unfinished && <small className="priority-marker">Unfinished</small>}
                      </td>
                      <td>{competition.arenasWithResults}</td>
                      <td>{competition.scopeIds.length === 0 ? <span className="muted-value">None</span> : competition.scopeIds.map(scopeName).join(", ")}</td>
                      <td>
                        {editingScope !== undefined && (
                          <div className="row-actions">
                            <button
                              type="button"
                              disabled={mutating}
                              aria-pressed={included}
                              className={included ? "is-active" : ""}
                              onClick={() => toggleCompetition(editingScope, competition)}
                            >
                              {included ? "In scope" : "Add to scope"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {currentScope !== undefined && (
        <section className="catalog-table-section">
          <div className="catalog-table-heading">
            <div><span className="eyebrow">{currentScope.name}</span><h2>Top players</h2></div>
            <span>{data.current?.entries.length ?? 0} shown</span>
          </div>
          {data.current === undefined || data.current.entries.length === 0 ? (
            <div className="empty-state catalog-empty"><strong>No results yet</strong><span>Players appear after an arena of a counted tournament finishes.</span></div>
          ) : (
            <div className="catalog-table-wrap">
              <table className="catalog-table leaderboard-table">
                <thead><tr><th>Rank</th><th>Player</th><th>Points</th><th>Wins</th><th>2nd places</th><th>Rounds</th><th>Arenas</th><th>Paid</th></tr></thead>
                <tbody>
                  {data.current.entries.map((entry) => (
                    <tr key={entry.userId}>
                      <td><strong>{entry.rank}</strong></td>
                      <td><strong>{entry.username}</strong><small>{entry.userId}</small></td>
                      <td>{entry.points}</td>
                      <td>{entry.wins}</td>
                      <td>{entry.secondPlaces}</td>
                      <td>{entry.roundsPlayed}</td>
                      <td>{entry.arenasPlayed}</td>
                      <td>{formatSol(entry.totalPayoutLamports)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {confirmation?.kind === "current" && (
        <ConfirmDialog
          eyebrow="Switch leaderboard scope"
          title={`Make ${confirmation.scope.name} current?`}
          confirmLabel="Make current"
          destructive={currentScope !== undefined}
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => void runMutation({ type: "leaderboard.scope.current.set", scopeId: confirmation.scope.id }, `${confirmation.scope.name} is now current.`)}
        >
          <p>
            {currentScope === undefined
              ? "Players will see this scope's leaderboard."
              : `${currentScope.name} gets a final recompute and closes for good: its tournaments can no longer change.`}
          </p>
          {unfinishedWarning}
        </ConfirmDialog>
      )}
      {confirmation?.kind === "close" && currentScope !== undefined && (
        <ConfirmDialog
          eyebrow="Close leaderboard scope"
          title={`Close ${currentScope.name}?`}
          confirmLabel="Close scope"
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => void runMutation({ type: "leaderboard.scope.close" }, `${currentScope.name} closed.`)}
        >
          <p>It gets a final recompute and closes for good. Players see a coming-soon page until another scope is made current.</p>
          {unfinishedWarning}
        </ConfirmDialog>
      )}
      {confirmation?.kind === "remove" && (
        <ConfirmDialog
          eyebrow="Change current scope"
          title={`Remove ${competitionName(confirmation.competition)}?`}
          confirmLabel="Remove"
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => void runMutation(
            { type: "leaderboard.competition.remove", scopeId: confirmation.scopeId, competitionId: confirmation.competition.id },
            `${competitionName(confirmation.competition)} removed from ${scopeName(confirmation.scopeId)}.`,
          )}
        >
          <p>Players see this scope now. Points from this tournament disappear from their leaderboard after the next recompute.</p>
        </ConfirmDialog>
      )}

      {mutating && <div className="blocking-overlay" role="status"><span>Applying leaderboard change</span></div>}
    </section>
  );
}
