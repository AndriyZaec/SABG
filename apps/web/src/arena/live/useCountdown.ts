import { useEffect, useState } from "react";

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
