import { useEffect, useState } from "react";

/** Ticks 4×/sec and reports time left until `lockAt` (epoch ms). `lockAt` is undefined right
 *  after a reload seeds the round from the REST snapshot (`PredictionRound` carries no lockAt) —
 *  in that window there's simply no countdown to show; `locked` then reflects only `round.status`
 *  until the next live `round.open`/`round.lock` message supplies a real one. */
export function useCountdown(lockAt: number | undefined): { remainingMs: number | undefined; locked: boolean } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (lockAt === undefined) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [lockAt]);
  if (lockAt === undefined) return { remainingMs: undefined, locked: false };
  const remainingMs = Math.max(0, lockAt - now);
  return { remainingMs, locked: remainingMs <= 0 };
}
