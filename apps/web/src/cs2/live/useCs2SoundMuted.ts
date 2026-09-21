import { useCallback, useState } from "react";

const STORAGE_KEY = "cs2.roundSoundMuted";

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function useCs2SoundMuted(): [boolean, () => void] {
  const [muted, setMuted] = useState(readMuted);

  const toggle = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  return [muted, toggle];
}
