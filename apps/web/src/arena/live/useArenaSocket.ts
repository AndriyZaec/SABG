import { useCallback, useEffect, useRef, useState } from "react";
import type { Answer, ArenaDetailResponse, ServerMessage } from "@arena/contracts";
import {
  fetchArenaDetail,
  fetchArenaRounds,
  fetchEventAccessSession,
  fetchLeaderboard,
  notifyEventAccessRequired,
} from "../../api/client.js";
import { useAuth } from "../../auth/AuthContext.js";
import type { ArenaView, LeaderRow } from "../arenaView.js";
import { makeDemoView } from "../arenaView.js";
import {
  ELIMINATED_TEXT,
  feedFromRounds,
  formatSettleText,
  prependFeedItem,
  settleFeedId,
  SURVIVED_TEXT,
} from "../feedFromRounds.js";

function buildWsUrl(token: string | null): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${proto}//${window.location.host}/ws${query}`;
}

function initialView(d: ArenaDetailResponse): ArenaView {
  if (d.match.discipline !== "soccer") throw new Error(`Arena ${d.arena.id} is not a soccer arena`);
  const state = d.matchState;
  const round = d.currentRound;
  return {
    home: d.match.homeTeam,
    away: d.match.awayTeam,
    score: state?.score ?? d.match.score,
    minute: state?.currentMinute ?? d.match.currentMinute,
    period: state?.period ?? d.match.period,
    survivors: d.arena.activePlayersCount,
    totalPlayers: d.arena.activePlayersCount,
    // Restore the current round from the authoritative reconnect snapshot.
    ...(round
      ? {
          round: {
            roundId: round.id,
            question: round.question,
            windowStartMinute: round.windowStartMinute ?? 0,
            windowEndMinute: round.windowEndMinute ?? 0,
            status: round.status,
          },
        }
      : {}),
    feed: [],
    leaderboard: [],
  };
}

function reduce(view: ArenaView, msg: ServerMessage, myUserId?: string): ArenaView {
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
          windowStartMinute: msg.round.windowStartMinute!,
          windowEndMinute: msg.round.windowEndMinute!,
          status: "open",
          lockAt: new Date(msg.lockAt!).getTime(),
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
        feed: prependFeedItem(view.feed, {
          id: settleFeedId(msg.roundId),
          kind: "info",
          text: formatSettleText(msg.question, msg.correctAnswer),
          minute: view.minute,
        }),
      };
    case "leaderboard.update": {
      const leaderboard = msg.entries.map((e, i) => ({
        rank: e.rank ?? i + 1,
        name: e.username,
        score: e.score,
        status: e.status,
        you: myUserId != null && e.userId === myUserId,
      }));
      return {
        ...view,
        leaderboard,
        survivors: msg.entries.filter((e) => e.status !== "eliminated").length,
        totalPlayers: msg.entries.length,
      };
    }
    case "player.status": {
      // A stale reconnect snapshot must not downgrade a terminal winner state.
      const status = view.myStatus === "winner" ? "winner" : msg.status;
      const next = { ...view, myStatus: status };
      if (msg.roundId === undefined && msg.status !== "winner") return next;
      const kind = msg.status === "eliminated" ? "eliminated" : "survived";
      const text = msg.status === "eliminated" ? ELIMINATED_TEXT : msg.status === "winner" ? "You won!" : SURVIVED_TEXT;
      const id = msg.status === "winner" ? "me-winner" : `me-${msg.roundId}`;
      return { ...next, feed: prependFeedItem(view.feed, { id, kind, text, minute: view.minute }) };
    }
    case "player.pending":
      // Replace with the authoritative personal snapshot.
      return { ...view, pendingPredictions: msg.predictions };
    case "arena.finished": {
      // Reconnect state is authoritative for restoring the winner banner.
      const iWon = myUserId != null && msg.winners.includes(myUserId);
      return {
        ...view,
        ...(iWon ? { myStatus: "winner" as const } : {}),
        feed: prependFeedItem(view.feed, {
          id: "arena-finished",
          kind: "info",
          text: "Match finished",
          minute: view.minute,
        }),
      };
    }
    default:
      return view;
  }
}

export interface ArenaSocket {
  view: ArenaView | null;
  connected: boolean;
  submitAnswer: (answer: Answer) => void;
}

export function useArenaSocket(arenaId: string): ArenaSocket {
  const isDemo = arenaId === "demo";
  const { token, user } = useAuth();
  const [view, setView] = useState<ArenaView | null>(() => (isDemo ? makeDemoView() : null));
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const myUserId = useRef<string | undefined>(undefined);
  myUserId.current = user?.id;

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    void Promise.all([
      fetchArenaDetail(arenaId),
      fetchLeaderboard(arenaId).catch(() => null),
      fetchArenaRounds(arenaId).catch(() => null),
    ])
      .then(([detail, board, rounds]) => {
        if (cancelled) return;
        const rows: LeaderRow[] = (board?.entries ?? []).map((e, i) => ({
          rank: e.rank ?? i + 1,
          name: e.username,
          score: e.score,
          status: e.status,
          you: myUserId.current != null && e.userId === myUserId.current,
        }));
        const feed = rounds ? feedFromRounds(rounds.rounds, myUserId.current) : [];
        setView((v) => v ?? { ...initialView(detail), leaderboard: rows, feed });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [arenaId, isDemo]);

  useEffect(() => {
    if (isDemo || !token) return;
    const ws = new WebSocket(buildWsUrl(token));
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "subscribe", arenaId }));
    };
    ws.onclose = (event) => {
      setConnected(false);
      if (event.code !== 1006 && event.code !== 4403) return;
      void fetchEventAccessSession()
        .then((session) => {
          if (session.status === "unauthenticated") notifyEventAccessRequired();
        })
        .catch(() => undefined);
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ServerMessage;
        setView((v) => (v ? reduce(v, msg, myUserId.current) : v));
      } catch {
        /* Ignore malformed frames. */
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [arenaId, isDemo, token]);

  const submitAnswer = useCallback(
    (answer: Answer) => {
      const ws = wsRef.current;
      const roundId = view?.round?.roundId;
      if (!isDemo && ws && ws.readyState === WebSocket.OPEN && roundId && view?.myStatus !== "eliminated") {
        ws.send(JSON.stringify({ type: "answer", roundId, answer }));
      }
    },
    [isDemo, view],
  );

  return { view, connected, submitAnswer };
}
