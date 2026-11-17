import type { AdminLeaderboardMark, AdminLeaderboardMarkDraft, LeaderboardMarkAction, LeaderboardMarkStatus } from "@arena/contracts";

export const MAX_MARK_REASON_LENGTH = 280;

export function draftLabel(draft: AdminLeaderboardMarkDraft): string {
  switch (draft.action) {
    case "approve": return "Approve";
    case "disqualify": return `Disqualify: ${draft.reason ?? ""}`;
    case "clear": return "Lift disqualification";
  }
}

/** The mark the player gets once the drafts are applied. */
function stagedStatus(mark: AdminLeaderboardMark | undefined, draft: AdminLeaderboardMarkDraft | undefined): LeaderboardMarkStatus | undefined {
  if (draft === undefined) return mark?.status;
  switch (draft.action) {
    case "approve": return "approved";
    case "disqualify": return "disqualified";
    case "clear": return undefined;
  }
}

export function PlayerMark({ mark, draft }: { mark: AdminLeaderboardMark | undefined; draft: AdminLeaderboardMarkDraft | undefined }) {
  return (
    <>
      {mark === undefined
        ? <span className="muted-value">Not verified</span>
        : <span className={`leaderboard-mark leaderboard-mark--${mark.status}`}>{mark.status === "approved" ? "Approved" : "Disqualified"}</span>}
      {mark?.reason !== undefined && <small>{mark.reason}</small>}
      {draft !== undefined && <small className="priority-marker">Draft: {draftLabel(draft)} · @{draft.actorLogin}</small>}
    </>
  );
}

export function PlayerMarkActions({ mark, draft, disabled, onStage, onDisqualify, onRemoveDraft }: {
  mark: AdminLeaderboardMark | undefined;
  draft: AdminLeaderboardMarkDraft | undefined;
  disabled: boolean;
  onStage: (action: Exclude<LeaderboardMarkAction, "disqualify">) => void;
  /** Opens the reason form, prefilled with the staged reason when the player stays disqualified. */
  onDisqualify: (currentReason?: string) => void;
  onRemoveDraft: () => void;
}) {
  const staged = stagedStatus(mark, draft);
  // The staged reason: the draft's, else the applied mark's when no draft changes it.
  const stagedReason = draft !== undefined ? draft.reason : mark?.reason;
  return (
    <div className="row-actions">
      {staged !== "approved" && <button type="button" disabled={disabled} onClick={() => onStage("approve")}>Approve</button>}
      {staged === "disqualified"
        ? <button type="button" disabled={disabled} onClick={() => onDisqualify(stagedReason ?? "")}>Edit reason</button>
        : <button className="row-actions__danger" type="button" disabled={disabled} onClick={() => onDisqualify()}>Disqualify</button>}
      {mark?.status === "disqualified" && draft?.action !== "clear" && (
        <button type="button" disabled={disabled} onClick={() => onStage("clear")}>Lift disqualification</button>
      )}
      {draft !== undefined && <button type="button" disabled={disabled} onClick={onRemoveDraft}>Remove draft</button>}
    </div>
  );
}

/** Staged mark changes of the current scope; none reach the board before "Apply changes". */
export function MarkDraftsPanel({ drafts, nameOf, disabled, onApply }: {
  drafts: AdminLeaderboardMarkDraft[];
  nameOf: (userId: string) => string;
  disabled: boolean;
  onApply: () => void;
}) {
  if (drafts.length === 0) return null;
  return (
    <div className="leaderboard-drafts">
      <div>
        <strong>{drafts.length} staged {drafts.length === 1 ? "change" : "changes"}</strong>
        <span>Seen only here until applied.</span>
      </div>
      <ul>{drafts.map((draft) => <li key={draft.userId}><strong>{nameOf(draft.userId)}</strong> {draftLabel(draft)}</li>)}</ul>
      <button className="primary-action" type="button" disabled={disabled} onClick={onApply}>Apply changes</button>
    </div>
  );
}
