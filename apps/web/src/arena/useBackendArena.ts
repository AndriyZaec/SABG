import { useEffect, useState } from "react";
import type { Arena, Match } from "@arena/contracts";
import { fetchPrimaryArena } from "../api/client.js";

/**
 * The backend-provisioned arena to target (with its match), if any. Null in mock mode / no backend
 * arena — callers then fall back to the standalone on-chain demo (client-created arena).
 */
export function useBackendArena(): { arena: Arena | null; match: Match | null; loading: boolean } {
  const [arena, setArena] = useState<Arena | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchPrimaryArena()
      .then((primary) => {
        if (!active) return;
        setArena(primary?.arena ?? null);
        setMatch(primary?.match ?? null);
      })
      .catch(() => {
        if (!active) return;
        setArena(null);
        setMatch(null);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return { arena, match, loading };
}
