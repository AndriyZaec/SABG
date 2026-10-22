import type { ClassicZoneHud } from "../classicZone.js";

function bufferText(buffer: number): string {
  if (buffer > 0) return `Buffer +${buffer} — a miss is safe`;
  if (buffer === 0) return "Buffer 0 — a miss is still safe";
  return `Buffer ${buffer} — answer correctly to stay`;
}

/** Classic arenas: where the zone is now, where it moves after this round, and how far above it you are. */
export function Cs2ZoneHud({ hud }: { hud: ClassicZoneHud }) {
  if (hud.stage === "final_circle") {
    return (
      <div className="nb-zone-hud nb-zone-hud--final nb-rise" role="status" aria-live="polite">
        <p className="nb-zone-hud__title">Final Circle</p>
        <p className="nb-zone-hud__subtitle">One miss and you&apos;re out.</p>
      </div>
    );
  }
  return (
    <div className="nb-zone-hud nb-rise">
      <div className="nb-zone-hud__cells">
        <div>
          <span className="nb-label">Zone now</span>
          <span className="nb-stat">{hud.zoneNow}</span>
        </div>
        <div>
          <span className="nb-label">After this round</span>
          <span className="nb-stat">{hud.nextZone}</span>
        </div>
      </div>
      {hud.buffer !== undefined && (
        <p className={`nb-zone-hud__buffer${hud.buffer < 0 ? " nb-zone-hud__buffer--danger" : ""}`}>
          {bufferText(hud.buffer)}
        </p>
      )}
    </div>
  );
}
