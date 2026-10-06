import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminControlStatus } from "@arena/contracts";
import { AdminApiError, readControlStatus } from "./api.js";

const POLL_INTERVAL_MS = 10_000;
const STALE_AFTER_MS = 30_000;

export function formatUpdatedAt(generatedAt: number, now: number): string {
  if (!Number.isFinite(generatedAt)) return "unknown";
  const seconds = Math.max(0, Math.floor((now - generatedAt) / 1_000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

export function useControlStatus(onSessionExpired: () => void) {
  const [status, setStatus] = useState<AdminControlStatus>();
  const [now, setNow] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const statusRef = useRef<AdminControlStatus>();
  const inFlight = useRef<Promise<void>>();

  const refresh = useCallback(async (force = false) => {
    if (inFlight.current !== undefined) {
      if (!force) return inFlight.current;
      await inFlight.current;
    }
    if (statusRef.current !== undefined) setRefreshing(true);
    setLoadError(undefined);

    const operation = readControlStatus()
      .then((nextStatus) => {
        statusRef.current = nextStatus;
        setStatus(nextStatus);
      })
      .catch((error: unknown) => {
        if (error instanceof AdminApiError && error.status === 401) {
          onSessionExpired();
          return;
        }
        setLoadError("Could not refresh runtime status.");
      })
      .finally(() => {
        setRefreshing(false);
        inFlight.current = undefined;
      });
    inFlight.current = operation;
    return operation;
  }, [onSessionExpired]);

  useEffect(() => {
    void refresh();
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  const generatedAt = status === undefined ? Number.NaN : Date.parse(status.generatedAt);
  return {
    status,
    stale: !Number.isFinite(generatedAt) || now - generatedAt > STALE_AFTER_MS,
    generatedAt,
    now,
    refreshing,
    loadError,
    refresh,
  };
}
