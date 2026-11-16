import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type {
  AdminLeaderboardCompetition,
  AdminLeaderboardPrize,
  AdminLeaderboardResponse,
  AdminLeaderboardScope,
  AdminLeaderboardWinner,
  AdminMutationCommand,
} from "@arena/contracts";
import type { AdminSessionResponse } from "../shared/session.js";
import { AdminApiError, mutateControl, readLeaderboard } from "./api.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { FinalizePanel, WinnersTable, formatDateTime } from "./LeaderboardFinalize.js";
import { MAX_MARK_REASON_LENGTH, MarkDraftsPanel, PlayerMark, PlayerMarkActions, draftLabel } from "./LeaderboardMarks.js";
import { PrizeEditor } from "./LeaderboardPrizes.js";

type Confirmation =
  | { kind: "current"; scope: AdminLeaderboardScope }
  | { kind: "close" }
  | { kind: "remove"; scopeId: string; competition: AdminLeaderboardCompetition }
  | { kind: "prize-remove"; scope: AdminLeaderboardScope; prize: AdminLeaderboardPrize }
  | { kind: "apply"; scope: AdminLeaderboardScope }
  | { kind: "finalize"; scope: AdminLeaderboardScope }
  | { kind: "sent"; scope: AdminLeaderboardScope; winner: AdminLeaderboardWinner };

const LAMPORTS_PER_SOL = 1_000_000_000;

function formatSol(lamports: number): string {
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(lamports / LAMPORTS_PER_SOL)} SOL`;
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
  const [search, setSearch] = useState("");
  // The applied search, blank for none; a refresh after a mutation keeps it.
  const [appliedSearch, setAppliedSearch] = useState("");
  const [prizeScopeId, setPrizeScopeId] = useState<string>();
  const [disqualify, setDisqualify] = useState<{ userId: string; username: string; reason: string; editing: boolean }>();

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setLoadError(undefined);
    try {
      setData(await readLeaderboard(appliedSearch === "" ? undefined : appliedSearch));
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setLoadError("Could not read the leaderboard.");
    } finally {
      setRefreshing(false);
    }
  }, [onSessionExpired, appliedSearch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Resolves true when the command succeeded. */
  const runMutation = async (command: AdminMutationCommand, successMessage: string): Promise<boolean> => {
    setConfirmation(undefined);
    setMutating(true);
    setNotice(undefined);
    try {
      const response = await mutateControl(session, command);
      if (response.result.status === "refused") {
        setNotice({ tone: "danger", message: response.result.reason });
        return false;
      }
      setNotice({ tone: "success", message: successMessage });
      setRename(undefined);
      setDisqualify(undefined);
      if (command.type === "leaderboard.scope.create") setNewName("");
      return true;
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        onSessionExpired();
        return false;
      }
      setNotice({ tone: "danger", message: "The leaderboard command could not be completed." });
      return false;
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
  const unfinishedInCurrent = currentScope?.unfinishedCompetitions ?? [];
  const prizeScope = openScopes.find((scope) => scope.id === prizeScopeId)
    ?? (currentScope?.status === "open" ? currentScope : openScopes[0]);
  const current = data.current;
  const markOf = (userId: string) => current?.marks.find((mark) => mark.userId === userId);
  const draftOf = (userId: string) => current?.drafts.find((draft) => draft.userId === userId);
  const playerName = (userId: string) => current?.entries.find((entry) => entry.userId === userId)?.username ?? userId;

  const createScope = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (name.length === 0) return;
    void runMutation({ type: "leaderboard.scope.create", name }, `Scope ${name} created.`);
  };

  const applySearch = (event: FormEvent) => {
    event.preventDefault();
    setAppliedSearch(search.trim());
  };

  const clearSearch = () => {
    setSearch("");
    setAppliedSearch("");
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
        `${competition.name} added to ${scope.name}.`,
      );
    } else if (scope.current) {
      setConfirmation({ kind: "remove", scopeId: scope.id, competition });
    } else {
      void runMutation(
        { type: "leaderboard.competition.remove", scopeId: scope.id, competitionId: competition.id },
        `${competition.name} removed from ${scope.name}.`,
      );
    }
  };

  const stageMark = (userId: string, action: "approve" | "clear") => {
    if (currentScope === undefined) return;
    void runMutation(
      { type: "leaderboard.mark.draft.set", scopeId: currentScope.id, userId, action },
      `Staged: ${action === "approve" ? "approve" : "lift the disqualification of"} ${playerName(userId)}.`,
    );
  };

  const saveDisqualify = (event: FormEvent) => {
    event.preventDefault();
    if (disqualify === undefined || currentScope === undefined) return;
    const reason = disqualify.reason.trim();
    if (reason.length === 0) return;
    void runMutation(
      { type: "leaderboard.mark.draft.set", scopeId: currentScope.id, userId: disqualify.userId, action: "disqualify", reason },
      `Staged: disqualify ${disqualify.username}.`,
    );
  };

  // Closing a scope another way than finalize leaves it without winners for good.
  const unfinalizedPrizesWarning = currentScope !== undefined && currentScope.prizes.length > 0 && currentScope.finalizedAt === undefined && (
    <p className="leaderboard-warning">
      {currentScope.name} has prizes but is not finalized: it closes without winners and can no longer be finalized.
      Finalize it instead to award the prizes.
    </p>
  );
  const finalizedScopes = data.scopes
    .filter((scope) => scope.winners !== undefined)
    .sort((a, b) => (b.finalizedAt ?? "").localeCompare(a.finalizedAt ?? ""));

  const unfinishedWarning = unfinishedInCurrent.length > 0 && currentScope !== undefined && (
    <p className="leaderboard-warning">
      {currentScope.name} holds an unfinished tournament: {unfinishedInCurrent.join(", ")}.
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
              : "Not computed yet: recompute now, or it runs after the next arena or within 15 minutes."}
        </p>
        {currentScope !== undefined && (
          <div className="leaderboard-current__actions">
            <button
              className="secondary-action"
              type="button"
              disabled={mutating}
              onClick={() => void runMutation({ type: "leaderboard.recompute" }, "Recompute started. The leaderboard will update shortly.")}
            >
              Recompute now
            </button>
            <button className="danger-action" type="button" disabled={mutating} onClick={() => setConfirmation({ kind: "close" })}>Close current scope</button>
          </div>
        )}
        {currentScope !== undefined && (
          <FinalizePanel scope={currentScope} board={data.current} disabled={mutating} onFinalize={() => setConfirmation({ kind: "finalize", scope: currentScope })} />
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
                      <span className={`state-chip ${scope.current ? "state-chip--on" : ""}`}>{scope.current ? "Current" : scope.status === "open" ? "Open" : scope.finalizedAt !== undefined ? "Finalized" : "Closed"}</span>
                      {scope.closedAt !== undefined && <small>Closed {formatDateTime(scope.closedAt)}</small>}
                    </td>
                    <td>{scope.competitionCount}</td>
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

      {prizeScope !== undefined && (
        <PrizeEditor
          scopes={openScopes}
          scope={prizeScope}
          disabled={mutating}
          onSelectScope={setPrizeScopeId}
          onSet={(place, imageUrl) => runMutation(
            { type: "leaderboard.prize.set", scopeId: prizeScope.id, place, imageUrl },
            `Prize for place ${place} of ${prizeScope.name} set.`,
          )}
          onRemove={(prize) => setConfirmation({ kind: "prize-remove", scope: prizeScope, prize })}
        />
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
          <form className="leaderboard-search" onSubmit={applySearch}>
            <label className="field"><span>Tournament name</span><input value={search} maxLength={80} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. ESL Pro League" /></label>
            <div className="leaderboard-search__actions"><button type="button" onClick={clearSearch} disabled={refreshing}>Clear</button><button className="primary-action" type="submit" disabled={refreshing}>Search</button></div>
          </form>
        </div>
        {data.competitions.length === 0 ? (
          appliedSearch === ""
            ? <div className="empty-state catalog-empty"><strong>No synced tournaments</strong><span>Tournaments appear here once their Series are synced.</span></div>
            : <div className="empty-state catalog-empty"><strong>No matching tournaments</strong><span>No tournament name contains “{appliedSearch}”.</span></div>
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
        {data.competitions.length > 0 && (
          <p className="leaderboard-search__caption">
            {appliedSearch === ""
              ? "Latest 10 synced tournaments. Search to find older ones."
              : `${data.competitions.length} ${data.competitions.length === 1 ? "match" : "matches"}`}
          </p>
        )}
      </section>

      {currentScope !== undefined && (
        <section className="catalog-table-section">
          <div className="catalog-table-heading">
            <div><span className="eyebrow">{currentScope.name}</span><h2>Top players</h2></div>
            <span>{current?.entries.length ?? 0} shown · marks are set on these rows</span>
          </div>
          {current !== undefined && (
            <MarkDraftsPanel
              drafts={current.drafts}
              nameOf={playerName}
              disabled={mutating}
              onApply={() => setConfirmation({ kind: "apply", scope: currentScope })}
            />
          )}
          {disqualify && (
            <section className="stream-editor">
              <div><span className="eyebrow">{disqualify.editing ? "Edit the disqualification reason" : "Stage a disqualification"}</span><h2>{disqualify.username}</h2><p>Only this player sees the reason. The row stays on the board with a virtual rank and takes no prize.</p></div>
              <form onSubmit={saveDisqualify}>
                <label className="field">
                  <span>Reason ({disqualify.reason.trim().length}/{MAX_MARK_REASON_LENGTH})</span>
                  <input autoFocus value={disqualify.reason} maxLength={MAX_MARK_REASON_LENGTH} onChange={(event) => setDisqualify({ ...disqualify, reason: event.target.value })} />
                </label>
                <div className="stream-editor__actions">
                  <button className="secondary-action" type="button" onClick={() => setDisqualify(undefined)}>Cancel</button>
                  <button className="danger-action" type="submit" disabled={mutating || disqualify.reason.trim().length === 0}>{disqualify.editing ? "Stage new reason" : "Stage disqualification"}</button>
                </div>
              </form>
            </section>
          )}
          {current === undefined || current.entries.length === 0 ? (
            <div className="empty-state catalog-empty"><strong>No results yet</strong><span>Players appear after an arena of a counted tournament finishes.</span></div>
          ) : (
            <div className="catalog-table-wrap">
              <table className="catalog-table leaderboard-table leaderboard-players">
                <thead><tr><th>Rank</th><th>Prize</th><th>Player</th><th>Mark</th><th>Points</th><th>Wins</th><th>2nd places</th><th>Rounds</th><th>Arenas</th><th>Paid</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {current.entries.map((entry) => {
                    const mark = markOf(entry.userId);
                    const draft = draftOf(entry.userId);
                    const rowClass = entry.disqualified ? "leaderboard-row--disqualified" : entry.prizePlace !== undefined ? "leaderboard-row--prize" : undefined;
                    return (
                      <tr key={entry.userId} className={rowClass}>
                        <td><strong>{entry.rank}</strong>{entry.disqualified && <small>Virtual rank</small>}</td>
                        <td>{entry.prizePlace !== undefined ? <strong className="leaderboard-prize-place">#{entry.prizePlace}</strong> : <span className="muted-value">—</span>}</td>
                        <td><strong>{entry.username}</strong><small>{entry.userId}</small></td>
                        <td><PlayerMark mark={mark} draft={draft} /></td>
                        <td>{entry.points}</td>
                        <td>{entry.wins}</td>
                        <td>{entry.secondPlaces}</td>
                        <td>{entry.roundsPlayed}</td>
                        <td>{entry.arenasPlayed}</td>
                        <td>{formatSol(entry.totalPayoutLamports)}</td>
                        <td>
                          <PlayerMarkActions
                            mark={mark}
                            draft={draft}
                            disabled={mutating}
                            onStage={(action) => stageMark(entry.userId, action)}
                            onDisqualify={(reason) => setDisqualify({ userId: entry.userId, username: entry.username, reason: reason ?? "", editing: reason !== undefined })}
                            onRemoveDraft={() => void runMutation(
                              { type: "leaderboard.mark.draft.remove", scopeId: currentScope.id, userId: entry.userId },
                              `Draft for ${entry.username} removed.`,
                            )}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}


      {finalizedScopes.map((scope) => (
        <WinnersTable
          key={scope.id}
          scope={scope}
          winners={scope.winners ?? []}
          disabled={mutating}
          onMarkSent={(winner) => setConfirmation({ kind: "sent", scope, winner })}
        />
      ))}

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
          {unfinalizedPrizesWarning}
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
          {unfinalizedPrizesWarning}
          {unfinishedWarning}
        </ConfirmDialog>
      )}
      {confirmation?.kind === "remove" && (
        <ConfirmDialog
          eyebrow="Change current scope"
          title={`Remove ${confirmation.competition.name}?`}
          confirmLabel="Remove"
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => void runMutation(
            { type: "leaderboard.competition.remove", scopeId: confirmation.scopeId, competitionId: confirmation.competition.id },
            `${confirmation.competition.name} removed from ${scopeName(confirmation.scopeId)}.`,
          )}
        >
          <p>Players see this scope now. Points from this tournament disappear from their leaderboard after the next recompute.</p>
        </ConfirmDialog>
      )}

      {confirmation?.kind === "prize-remove" && (
        <ConfirmDialog
          eyebrow="Remove prize"
          title={`Remove the prize for place ${confirmation.prize.place}?`}
          confirmLabel="Remove prize"
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => void runMutation(
            { type: "leaderboard.prize.remove", scopeId: confirmation.scope.id, place: confirmation.prize.place },
            `Prize for place ${confirmation.prize.place} of ${confirmation.scope.name} removed.`,
          )}
        >
          <p>Players of {confirmation.scope.name} no longer see this prize.</p>
        </ConfirmDialog>
      )}
      {confirmation?.kind === "apply" && current !== undefined && (
        <ConfirmDialog
          eyebrow="Apply mark changes"
          title={`Apply ${current.drafts.length} ${current.drafts.length === 1 ? "change" : "changes"} to ${confirmation.scope.name}?`}
          confirmLabel="Apply changes"
          destructive={false}
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => void runMutation(
            { type: "leaderboard.marks.apply", scopeId: confirmation.scope.id },
            "Mark changes applied. The board updates after the queued recompute.",
          )}
        >
          <ul className="leaderboard-drafts__list">
            {current.drafts.map((draft) => <li key={draft.userId}><strong>{playerName(draft.userId)}</strong> {draftLabel(draft)}</li>)}
          </ul>
          <p>Players see the changes after the recompute that runs next.</p>
        </ConfirmDialog>
      )}

      {confirmation?.kind === "finalize" && (
        <ConfirmDialog
          eyebrow="Finalize leaderboard scope"
          title={`Finalize ${confirmation.scope.name}?`}
          confirmLabel="Finalize"
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => void runMutation(
            { type: "leaderboard.scope.finalize", scopeId: confirmation.scope.id },
            `${confirmation.scope.name} finalized. Winners can now send their trade URLs.`,
          )}
        >
          <p>
            It gets a final recompute and closes for good: prizes and player marks lock, and the players on prize
            places become winners. Players see this scope until another one is made current.
          </p>
          {unfinishedWarning}
        </ConfirmDialog>
      )}
      {confirmation?.kind === "sent" && (
        <ConfirmDialog
          eyebrow="Prize delivery"
          title={`Mark the prize for place ${confirmation.winner.place} sent?`}
          confirmLabel="Mark sent"
          destructive={false}
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => void runMutation(
            { type: "leaderboard.prize.sent", scopeId: confirmation.scope.id, place: confirmation.winner.place },
            `Prize for place ${confirmation.winner.place} of ${confirmation.scope.name} marked sent.`,
          )}
        >
          <p>
            {confirmation.winner.username} can no longer change their trade URL, and it is erased 30 days from now.
            Mark it only after the Steam trade went out.
          </p>
        </ConfirmDialog>
      )}

      {mutating && <div className="blocking-overlay" role="status"><span>Applying leaderboard change</span></div>}
    </section>
  );
}
