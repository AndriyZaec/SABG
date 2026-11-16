import type {
  Cs2CompetitionSummary,
  PlayerLeaderboardEntry,
  PlayerLeaderboardMeResponse,
  PlayerLeaderboardPrize,
  PlayerLeaderboardPrizeClaim,
  PlayerLeaderboardResponse,
} from "@arena/contracts";

export interface PlayerBoardRow extends PlayerLeaderboardEntry {
  you: boolean;
  /** The prize this row holds by its place. */
  prize?: PlayerLeaderboardPrize;
}

export type PlayerLeaderboardView =
  | { kind: "coming_soon" }
  | {
      kind: "board";
      scopeName: string;
      /** Final results: prizes and marks are locked and winners claim their prizes. */
      finalized: boolean;
      competitions: Cs2CompetitionSummary[];
      prizes: PlayerLeaderboardPrize[];
      rows: PlayerBoardRow[];
      /** The viewer's own row, wherever they rank. */
      me?: PlayerBoardRow;
      /** The viewer's own row when it is ranked below the shown top. */
      pinned?: PlayerBoardRow;
      /** Shown only to the disqualified viewer. */
      disqualificationReason?: string;
      /** The viewer's prize on a finalized scope. */
      claim?: PlayerLeaderboardPrizeClaim;
      computedAt?: string;
    };

/**
 * Marks the viewer in the top, pins their row below it when they rank outside, gives each row the prize
 * of its place, and keeps the viewer's own reason and prize for the summary.
 */
export function playerLeaderboardView(
  response: PlayerLeaderboardResponse,
  mine: PlayerLeaderboardMeResponse | null,
): PlayerLeaderboardView {
  if (response.scope === null) return { kind: "coming_soon" };
  const prizeOf = (place: number | undefined) =>
    place === undefined ? undefined : response.prizes.find((prize) => prize.place === place);
  const myId = mine?.entry?.userId;
  const rows: PlayerBoardRow[] = response.entries.map((entry) => {
    const prize = prizeOf(entry.prizePlace);
    return { ...entry, you: entry.userId === myId, ...(prize !== undefined ? { prize } : {}) };
  });
  const ownTopRow = rows.find((row) => row.you);
  const me = ownTopRow ?? (mine?.entry ? { ...mine.entry, you: true } : undefined);
  const pinned = ownTopRow === undefined ? me : undefined;
  return {
    kind: "board",
    scopeName: response.scope.name,
    finalized: response.scope.finalized,
    competitions: response.competitions,
    prizes: response.prizes,
    rows,
    ...(me !== undefined ? { me } : {}),
    ...(pinned !== undefined ? { pinned } : {}),
    ...(mine?.disqualificationReason !== undefined ? { disqualificationReason: mine.disqualificationReason } : {}),
    ...(mine?.prize !== undefined ? { claim: mine.prize } : {}),
    ...(response.computedAt !== undefined ? { computedAt: response.computedAt } : {}),
  };
}
