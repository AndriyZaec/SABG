import { useEffect, useRef } from "react";
import { playRoundSound } from "./playRoundSound.js";
import { startTabFlash } from "./tabFlash.js";
import { useCs2SoundMuted } from "./useCs2SoundMuted.js";

export interface Cs2NewRoundSignal {
  roundId: string;
}

export function useCs2RoundAlerts(newRoundSignal: Cs2NewRoundSignal | null, participant: boolean): [boolean, () => void] {
  const [muted, toggleMuted] = useCs2SoundMuted();
  const lastAlertedRoundId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!newRoundSignal || !participant) return;
    if (lastAlertedRoundId.current === newRoundSignal.roundId) return;
    lastAlertedRoundId.current = newRoundSignal.roundId;

    if (!muted) playRoundSound();
    if (document.hidden) startTabFlash();
  }, [newRoundSignal, participant, muted]);

  return [muted, toggleMuted];
}
