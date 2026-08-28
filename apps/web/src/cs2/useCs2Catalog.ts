import { useEffect, useState } from "react";
import type { Cs2SeriesDetail, Cs2SeriesSummary } from "@arena/contracts";
import { fetchCs2Series, fetchCs2SeriesDetail } from "./api/cs2Client.js";

type LoadState<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "error" };

function useLoad<T>(load: () => Promise<T>, dependency: string): [LoadState<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<LoadState<T>>({ state: "loading" });

  useEffect(() => {
    let active = true;
    setResult({ state: "loading" });
    void load()
      .then((value) => {
        if (active) setResult({ state: "ready", value });
      })
      .catch(() => {
        if (active) setResult({ state: "error" });
      });
    return () => {
      active = false;
    };
  }, [attempt, dependency]);

  return [result, () => setAttempt((current) => current + 1)];
}

export function useCs2SeriesCatalog(): [LoadState<Cs2SeriesSummary[]>, () => void] {
  return useLoad(async () => (await fetchCs2Series()).series, "catalog");
}

export function useCs2Series(seriesId: string): [LoadState<Cs2SeriesDetail>, () => void] {
  return useLoad(async () => (await fetchCs2SeriesDetail(seriesId)).series, seriesId);
}
