import { cs2ClassicZoneAfter, isCs2ClassicDoubleRound } from "@arena/contracts";
import type { Cs2ArenaView } from "./cs2View.js";

export type ClassicZoneHud =
  | {
      stage: "zone";
      /** Zone after the last settled round. */
      zoneNow: number;
      /** Zone once the round being played settles. */
      nextZone: number;
      /** Own score minus `nextZone`; a miss is safe while it is not negative. Absent for spectators and eliminated players. */
      buffer?: number;
    }
  | { stage: "final_circle" };

/** Zone readout for a classic arena; undefined for hardcore or a finished arena. */
export function classicZoneHud(view: Pick<Cs2ArenaView, "mode" | "stage" | "round" | "leaderboard" | "finished">): ClassicZoneHud | undefined {
  if (view.mode !== "classic" || view.finished) return undefined;
  if (view.stage === "final_circle") return { stage: "final_circle" };
  const { round } = view;
  const playing = round === undefined ? 1 : round.status === "settled" ? round.roundNumber + 1 : round.roundNumber;
  const nextZone = cs2ClassicZoneAfter(playing);
  const me = view.leaderboard.find((row) => row.you && row.status === "active");
  return {
    stage: "zone",
    zoneNow: cs2ClassicZoneAfter(playing - 1),
    nextZone,
    ...(me ? { buffer: me.score - nextZone } : {}),
  };
}

/** Round-card scoring while the zone is in play; undefined in hardcore and Final Circle, where a miss eliminates. */
export function classicRoundScoring(
  view: Pick<Cs2ArenaView, "mode" | "stage">,
  roundNumber: number,
): { double: boolean } | undefined {
  if (view.mode !== "classic" || view.stage !== "zone") return undefined;
  return { double: isCs2ClassicDoubleRound(roundNumber) };
}
