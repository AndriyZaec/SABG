import { useState } from "react";
import type { AdminLeaderboardMark, AdminLeaderboardResponse, AdminLeaderboardScope, AdminLeaderboardWinner } from "@arena/contracts";

type CurrentBoard = NonNullable<AdminLeaderboardResponse["current"]>;

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

/**
 * What stops the current scope from being finalized, read from the preview. The server checks again on
 * a fresh recompute, so this only explains why the button is disabled.
 */
export function finalizeBlockers(scope: AdminLeaderboardScope, board: CurrentBoard | undefined): string[] {
  const blockers: string[] = [];
  if (scope.prizes.length === 0) blockers.push("The scope has no prizes.");
  const drafts = board?.drafts.length ?? 0;
  if (drafts > 0) blockers.push(`${drafts} staged mark ${drafts === 1 ? "change is" : "changes are"} not applied.`);
  const approved = (mark: AdminLeaderboardMark | undefined) => mark?.status === "approved";
  for (const entry of board?.entries ?? []) {
    if (entry.prizePlace === undefined) continue;
    if (!approved(board?.marks.find((mark) => mark.userId === entry.userId))) {
      blockers.push(`${entry.username} holds place ${entry.prizePlace} without an applied approval.`);
    }
  }
  return blockers;
}

export function FinalizePanel({ scope, board, disabled, onFinalize }: {
  scope: AdminLeaderboardScope;
  board: CurrentBoard | undefined;
  disabled: boolean;
  onFinalize: () => void;
}) {
  const blockers = finalizeBlockers(scope, board);
  const heldPlaces = new Set(board?.entries.flatMap((entry) => entry.prizePlace !== undefined ? [entry.prizePlace] : []));
  const emptyPlaces = scope.prizes.map((prize) => prize.place).filter((place) => !heldPlaces.has(place));
  return (
    <div className="leaderboard-finalize">
      <div>
        <strong>Finalize {scope.name}</strong>
        {blockers.length === 0
          ? <span>Ready to finalize.</span>
          : <ul>{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
        {emptyPlaces.length > 0 && <span>No player holds {emptyPlaces.length === 1 ? "place" : "places"} {emptyPlaces.join(", ")}: {emptyPlaces.length === 1 ? "it is" : "they are"} not awarded.</span>}
      </div>
      <button className="primary-action" type="button" disabled={disabled || blockers.length > 0} onClick={onFinalize}>Finalize</button>
    </div>
  );
}

function TradeUrl({ winner }: { winner: AdminLeaderboardWinner }) {
  const [copied, setCopied] = useState(false);
  if (winner.tradeUrl === undefined) {
    return <span className="muted-value">{winner.tradeUrlErasedAt !== undefined ? `Erased ${formatDateTime(winner.tradeUrlErasedAt)}` : "Not sent yet"}</span>;
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(winner.tradeUrl ?? "");
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <a className="stream-url" href={winner.tradeUrl} target="_blank" rel="noreferrer">{winner.tradeUrl}</a>
      <div className="row-actions leaderboard-copy"><button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button></div>
      {winner.tradeUrlUpdatedAt !== undefined && <small>Sent by the winner {formatDateTime(winner.tradeUrlUpdatedAt)}</small>}
    </>
  );
}

/** A finalized scope's winners; "Mark sent" waits for the winner's trade URL and locks it. */
export function WinnersTable({ scope, winners, disabled, onMarkSent }: {
  scope: AdminLeaderboardScope;
  winners: AdminLeaderboardWinner[];
  disabled: boolean;
  onMarkSent: (winner: AdminLeaderboardWinner) => void;
}) {
  return (
    <section className="catalog-table-section">
      <div className="catalog-table-heading">
        <div><span className="eyebrow">{scope.name} · finalized {scope.finalizedAt !== undefined ? formatDateTime(scope.finalizedAt) : ""}</span><h2>Winners</h2></div>
        <span>{winners.filter((winner) => winner.sentAt !== undefined).length} of {winners.length} sent</span>
      </div>
      {winners.length === 0 ? (
        <div className="empty-state catalog-empty"><strong>No winners</strong><span>No player held a prize place when the scope was finalized.</span></div>
      ) : (
        <div className="catalog-table-wrap">
          <table className="catalog-table leaderboard-table leaderboard-winners">
            <thead><tr><th>Place</th><th>Prize</th><th>Player</th><th>Wallet</th><th>Trade URL</th><th>Sent</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {winners.map((winner) => (
                <tr key={winner.place}>
                  <td><strong className="leaderboard-prize-place">#{winner.place}</strong></td>
                  <td><img className="leaderboard-prize-image" src={winner.imageUrl} alt={`Prize for place ${winner.place}`} loading="lazy" /></td>
                  <td><strong>{winner.username}</strong><small>{winner.userId}</small></td>
                  <td><code className="stream-url">{winner.walletAddress}</code></td>
                  <td><TradeUrl winner={winner} /></td>
                  <td>{winner.sentAt !== undefined ? formatDateTime(winner.sentAt) : <span className="muted-value">—</span>}</td>
                  <td>
                    {winner.sentAt === undefined && winner.tradeUrl !== undefined && (
                      <div className="row-actions">
                        <button type="button" disabled={disabled} onClick={() => onMarkSent(winner)}>Mark sent</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
