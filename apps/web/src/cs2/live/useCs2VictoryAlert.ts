import { useEffect, useRef } from "react";
import { playVictorySound } from "./playVictorySound.js";

export function useCs2VictoryAlert(victorySignal: number, muted: boolean): void {
  const lastSignal = useRef(0);

  useEffect(() => {
    if (victorySignal === lastSignal.current) return;
    lastSignal.current = victorySignal;
    if (victorySignal > 0 && !muted) playVictorySound();
  }, [victorySignal, muted]);
}
