import { useEffect, useState } from "react";

/** Ticks 4×/sec and reports time left until `lockAt` (epoch ms). */
export function useCountdown(lockAt: number): { remainingMs: number; locked: boolean } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const remainingMs = Math.max(0, lockAt - now);
  return { remainingMs, locked: remainingMs <= 0 };
}
