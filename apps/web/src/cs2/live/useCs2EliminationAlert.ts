import { useEffect, useRef } from "react";
import { playEliminationSound } from "./playEliminationSound.js";

export function useCs2EliminationAlert(eliminationSignal: number, muted: boolean): void {
  const lastSignal = useRef(0);

  useEffect(() => {
    if (eliminationSignal === lastSignal.current) return;
    lastSignal.current = eliminationSignal;
    if (eliminationSignal > 0 && !muted) playEliminationSound();
  }, [eliminationSignal, muted]);
}
