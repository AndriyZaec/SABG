import { isCs2ClassicDoubleRound } from "@arena/contracts";
import type { Cs2ArenaView } from "./cs2View.js";

export type ClassicZoneHud =
  | {
      stage: "zone";
      /** Zone after the last settled round. */
      zoneNow: number;
      /** Zone after the next round to settle. */
      nextZone: number;
    }
  | { stage: "final_circle" };

/** Zone readout for a classic arena, as the server sent it; undefined for hardcore or a finished arena. */
export function classicZoneHud(view: Pick<Cs2ArenaView, "mode" | "zone" | "finished">): ClassicZoneHud | undefined {
  if (view.mode !== "classic" || view.finished) return undefined;
  return view.zone.stage === "final_circle"
    ? { stage: "final_circle" }
    : { stage: "zone", zoneNow: view.zone.zone, nextZone: view.zone.nextZone };
}

/** Round-card scoring while the zone is in play; undefined in hardcore and Final Circle, where a miss eliminates. */
export function classicRoundScoring(
  view: Pick<Cs2ArenaView, "mode" | "zone">,
  roundNumber: number,
): { double: boolean } | undefined {
  if (view.mode !== "classic" || view.zone.stage !== "zone") return undefined;
  return { double: isCs2ClassicDoubleRound(roundNumber) };
}
