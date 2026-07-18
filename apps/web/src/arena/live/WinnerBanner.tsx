/** Celebratory banner shown to a player once the arena finishes with them among the winners
 *  (view.myStatus === "winner" — see useArenaSocket.ts's arena.finished/player.status handling). */
export function WinnerBanner() {
  return (
    <div className="nb-winner nb-rise" role="status" aria-live="polite">
      <span className="nb-winner__icon" aria-hidden>
        🏆
      </span>
      <div>
        <p className="nb-winner__title">You won!</p>
        <p className="nb-winner__subtitle">You survived to the final whistle — your winnings are on the way.</p>
      </div>
    </div>
  );
}
