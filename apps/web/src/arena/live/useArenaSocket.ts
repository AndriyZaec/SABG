import { useCallback, useEffect, useRef, useState } from "react";
import type { Answer, ArenaDetailResponse, ServerMessage } from "@arena/contracts";
import { fetchArenaDetail, getAuthToken } from "../../api/client.js";
import type { ArenaView, FeedItem } from "../arenaView.js";
import { makeDemoView } from "../arenaView.js";

function buildWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = getAuthToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${proto}//${window.location.host}/ws${query}`;
}

function initialView(d: ArenaDetailResponse): ArenaView {
  const state = d.matchState;
  return {
    home: d.match.homeTeam,
    away: d.match.awayTeam,
    score: state?.score ?? d.match.score,
    minute: state?.currentMinute ?? d.match.currentMinute,
    period: state?.period ?? d.match.period,
    survivors: d.arena.activePlayersCount,
    totalPlayers: d.arena.activePlayersCount,
    feed: [],
    leaderboard: [],
  };
}

function prepend(feed: FeedItem[], item: FeedItem): FeedItem[] {
  return [item, ...feed].slice(0, 20);
}

/** Fold a server message into the current view. */
function reduce(view: ArenaView, msg: ServerMessage): ArenaView {
  switch (msg.type) {
    case "match.state":
      return {
        ...view,
        score: msg.state.score,
        minute: msg.state.currentMinute,
        period: msg.state.period,
      };
    case "round.open":
      return {
        ...view,
        round: {
          roundId: msg.round.id,
          question: msg.round.question,
          windowStartMinute: msg.round.windowStartMinute,
          windowEndMinute: msg.round.windowEndMinute,
          status: "open",
          lockAt: new Date(msg.lockAt).getTime(),
        },
      };
    case "round.lock":
      return view.round ? { ...view, round: { ...view.round, status: "locked" } } : view;
    case "round.settle":
      return {
        ...view,
        survivors: msg.survivorsCount,
        ...(view.round && view.round.roundId === msg.roundId
          ? { round: { ...view.round, status: "settled" as const, correctAnswer: msg.correctAnswer } }
          : {}),
        feed: prepend(view.feed, {
          id: `settle-${msg.roundId}`,
          kind: "info",
          text: `Round settled · answer ${msg.correctAnswer.toUpperCase()}`,
          minute: view.minute,
        }),
      };
    case "leaderboard.update": {
      const leaderboard = msg.entries.map((e, i) => ({
        rank: e.rank ?? i + 1,
        name: e.username,
        score: e.score,
        status: e.status,
      }));
      return {
        ...view,
        leaderboard,
        survivors: msg.entries.filter((e) => e.status !== "eliminated").length,
        totalPlayers: msg.entries.length,
      };
    }
    case "player.status": {
      const kind = msg.status === "eliminated" ? "eliminated" : "survived";
      const text =
        msg.status === "eliminated" ? "You were eliminated" : msg.status === "winner" ? "You won!" : "You survived";
      return { ...view, feed: prepend(view.feed, { id: `me-${Date.now()}`, kind, text, minute: view.minute }) };
    }
    case "arena.finished":
      return {
        ...view,
        feed: prepend(view.feed, { id: `fin-${Date.now()}`, kind: "info", text: "Match finished", minute: view.minute }),
      };
    default:
      return view;
  }
}

export interface ArenaSocket {
  view: ArenaView | null;
  connected: boolean;
  submitAnswer: (answer: Answer) => void;
}

/** Live arena state over WebSocket. `arenaId === "demo"` returns the seeded view (no socket). */
export function useArenaSocket(arenaId: string): ArenaSocket {
  const isDemo = arenaId === "demo";
  const [view, setView] = useState<ArenaView | null>(() => (isDemo ? makeDemoView() : null));
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;

    void fetchArenaDetail(arenaId)
      .then((detail) => !cancelled && setView((v) => v ?? initialView(detail)))
      .catch(() => undefined);

    const ws = new WebSocket(buildWsUrl());
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "subscribe", arenaId }));
    };
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ServerMessage;
        setView((v) => (v ? reduce(v, msg) : v));
      } catch {
        /* ignore malformed frames */
      }
    };

    return () => {
      cancelled = true;
      ws.close();
      wsRef.current = null;
    };
  }, [arenaId, isDemo]);

  const submitAnswer = useCallback(
    (answer: Answer) => {
      const ws = wsRef.current;
      const roundId = view?.round?.roundId;
      if (!isDemo && ws && ws.readyState === WebSocket.OPEN && roundId) {
        ws.send(JSON.stringify({ type: "answer", roundId, answer }));
      }
    },
    [isDemo, view],
  );

  return { view, connected, submitAnswer };
}
