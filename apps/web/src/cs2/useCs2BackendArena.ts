import { useEffect, useState } from "react";
import type { Arena, Match } from "@arena/contracts";
import { fetchPrimaryCs2Arena } from "./api/cs2Client.js";

export function useCs2BackendArena(): { arena: Arena | null; match: Match | null; loading: boolean } {
  const [arena, setArena] = useState<Arena | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchPrimaryCs2Arena()
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
