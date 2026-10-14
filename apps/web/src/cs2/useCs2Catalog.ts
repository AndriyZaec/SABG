import { useEffect, useState } from "react";
import type { Cs2SeriesDetail, Cs2SeriesSummary } from "@arena/contracts";
import { useAuth } from "../auth/AuthContext.js";
import { fetchCs2Series, fetchCs2SeriesDetail, fetchCs2SeriesFollows } from "./api/cs2Client.js";

type LoadState<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "error" };

function useLoad<T>(load: () => Promise<T>, dependency: string, preserveValue = false): [LoadState<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<LoadState<T>>({ state: "loading" });

  useEffect(() => {
    let active = true;
    setResult((current) => preserveValue && current.state === "ready" ? current : { state: "loading" });
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
  }, [attempt, dependency, preserveValue]);

  return [result, () => setAttempt((current) => current + 1)];
}

export interface Cs2SeriesCatalog {
  series: Cs2SeriesSummary[];
  followedIds: string[];
}

export function useCs2SeriesCatalog(): [LoadState<Cs2SeriesCatalog>, () => void] {
  const { token } = useAuth();
  // Wallet sign-in must not unmount an in-progress notification toggle.
  const [result, retry] = useLoad(async () => {
    const { series } = await fetchCs2Series();
    if (!token || series.length === 0) return { series, followedIds: [], token };
    const { followedIds } = await fetchCs2SeriesFollows(series.map((item) => item.id))
      .catch(() => ({ followedIds: [] }));
    return { series, followedIds, token };
  }, `catalog:${token ?? ""}`, true);
  if (result.state !== "ready") return [result, retry];
  return [{
    state: "ready",
    value: {
      series: result.value.series,
      followedIds: result.value.token === token ? result.value.followedIds : [],
    },
  }, retry];
}

export function useCs2Series(seriesId: string): [LoadState<Cs2SeriesDetail>, () => void] {
  return useLoad(async () => (await fetchCs2SeriesDetail(seriesId)).series, seriesId);
}
