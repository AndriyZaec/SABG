import type { ClassicZoneHud } from "../classicZone.js";

/** Classic arenas: where the zone is now and where it moves after this round. */
export function Cs2ZoneHud({ hud }: { hud: ClassicZoneHud }) {
  if (hud.stage === "final_circle") {
    return (
      <div className="nb-zone-hud nb-zone-hud--final" role="status" aria-live="polite">
        Final Circle · one miss and you&apos;re out
      </div>
    );
  }
  return (
    <div className="nb-zone-hud">
      <span className="nb-label">Zone</span>
      <b>{hud.zoneNow}</b>
      <span aria-hidden>→</span>
      <b>{hud.nextZone}</b>
      <span className="nb-label">after this round</span>
    </div>
  );
}
