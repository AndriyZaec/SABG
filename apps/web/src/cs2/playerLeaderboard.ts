import type { Cs2CompetitionSummary, PlayerLeaderboardEntry, PlayerLeaderboardResponse } from "@arena/contracts";

export interface PlayerBoardRow extends PlayerLeaderboardEntry {
  you: boolean;
}

export type PlayerLeaderboardView =
  | { kind: "coming_soon" }
  | {
      kind: "board";
      scopeName: string;
      competitions: Cs2CompetitionSummary[];
      rows: PlayerBoardRow[];
      /** The viewer's own entry, wherever they rank. */
      me?: PlayerLeaderboardEntry;
      /** The viewer's own row when it is ranked below the shown top. */
      pinned?: PlayerBoardRow;
      computedAt?: string;
    };

/** Marks the viewer in the top, pins their row below it when they rank outside, and keeps their entry for the summary. */
export function playerLeaderboardView(
  response: PlayerLeaderboardResponse,
  me: PlayerLeaderboardEntry | null,
): PlayerLeaderboardView {
  if (response.scope === null) return { kind: "coming_soon" };
  const rows = response.entries.map((entry) => ({ ...entry, you: entry.userId === me?.userId }));
  const pinned = me !== null && !rows.some((row) => row.you) ? { ...me, you: true } : undefined;
  return {
    kind: "board",
    scopeName: response.scope.name,
    competitions: response.competitions,
    rows,
    ...(me !== null ? { me } : {}),
    ...(pinned !== undefined ? { pinned } : {}),
    ...(response.computedAt !== undefined ? { computedAt: response.computedAt } : {}),
  };
}
