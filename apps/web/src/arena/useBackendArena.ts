import { useEffect, useState } from "react";
import type { Arena } from "@arena/contracts";
import { fetchPrimaryArena } from "../api/client.js";

/**
 * The backend-provisioned arena to target, if any. Null in mock mode / no backend arena — callers
 * then fall back to the standalone on-chain demo (client-created arena).
 */
export function useBackendArena(): { arena: Arena | null; loading: boolean } {
  const [arena, setArena] = useState<Arena | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchPrimaryArena()
      .then((a) => active && setArena(a))
      .catch(() => active && setArena(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return { arena, loading };
}
