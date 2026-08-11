import { useCallback, useEffect, useRef, useState } from "react";
import type { Answer, ArenaDetailResponse, ServerMessage } from "@arena/contracts";
import { fetchCs2ArenaDetail, fetchCs2Leaderboard } from "../api/cs2Client.js";
import { notifyEventAccessRequired, fetchEventAccessSession } from "../../api/client.js";
import { useAuth } from "../../auth/AuthContext.js";
import type { Cs2ArenaView, FeedItem, LeaderRow } from "../cs2View.js";

// Mirrors arena/live/useArenaSocket.ts's structure (REST snapshot + WS effect + submitAnswer),
// but connects to the CS2 gateway's own /cs2-ws (see vite.config.ts) and folds CS2's own message
// shapes — no windowStartMinute/windowEndMinute, no lockAt (CS2 rounds have no fixed answer
// window, spec §6), plus round.void/arena.cancelled, which soccer's reducer doesn't handle.

function buildCs2WsUrl(token: string | null): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${proto}//${window.location.host}/cs2-ws${query}`;
}

function initialView(d: ArenaDetailResponse): Cs2ArenaView {
  return {
    homeTeam: d.match.homeTeam,
    awayTeam: d.match.awayTeam,
    survivors: d.arena.activePlayersCount,
    totalPlayers: d.arena.activePlayersCount,
    feed: [],
    leaderboard: [],
  };
}

function prepend(feed: FeedItem[], item: FeedItem): FeedItem[] {
  return [item, ...feed].slice(0, 20);
}

function truncate(text: string, max = 64): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function reduce(view: Cs2ArenaView, msg: ServerMessage, myUserId?: string): Cs2ArenaView {
  switch (msg.type) {
    case "round.open":
      return {
        ...view,
        round: {
          roundId: msg.round.id,
          // CS2 rounds always carry roundNumber (cs2/round-engine.ts); soccer's do not.
          roundNumber: msg.round.roundNumber ?? 0,
          question: msg.round.question,
          status: "open",
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
          text: msg.question
            ? `Round settled · ${truncate(msg.question)} · answer ${msg.correctAnswer.toUpperCase()}`
            : `Round settled · answer ${msg.correctAnswer.toUpperCase()}`,
        }),
      };
    case "round.void":
      return {
        ...view,
        ...(view.round && view.round.roundId === msg.roundId ? { round: undefined } : {}),
        feed: prepend(view.feed, { id: `void-${msg.roundId}`, kind: "info", text: "Round voided — match ended first" }),
      };
    case "arena.cancelled":
      return {
        ...view,
        cancelled: { reason: msg.reason },
        feed: prepend(view.feed, { id: "cancelled", kind: "info", text: `Arena cancelled (${msg.reason})` }),
      };
    case "leaderboard.update": {
      const leaderboard: LeaderRow[] = msg.entries.map((e, i) => ({
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
      // Same reasoning as soccer's reducer: a declared winner never reverts on a stale resync.
      const status = view.myStatus === "winner" ? "winner" : msg.status;
      const next = { ...view, myStatus: status };
      if (msg.roundId === undefined && msg.status !== "winner") return next;
      const kind = msg.status === "eliminated" ? "eliminated" : "survived";
      const text =
        msg.status === "eliminated" ? "You were eliminated" : msg.status === "winner" ? "You won!" : "You survived";
      return { ...next, feed: prepend(view.feed, { id: `me-${Date.now()}`, kind, text }) };
    }
    case "arena.finished": {
      const iWon = myUserId != null && msg.winners.includes(myUserId);
      return {
        ...view,
        ...(iWon ? { myStatus: "winner" as const } : {}),
        feed: prepend(view.feed, { id: `fin-${Date.now()}`, kind: "info", text: "Series finished" }),
      };
    }
    default:
      return view;
  }
}

export interface Cs2ArenaSocket {
  view: Cs2ArenaView | null;
  connected: boolean;
  submitAnswer: (answer: Answer) => void;
}

export function useCs2ArenaSocket(arenaId: string): Cs2ArenaSocket {
  const { token, user } = useAuth();
  const [view, setView] = useState<Cs2ArenaView | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const myUserId = useRef<string | undefined>(undefined);
  myUserId.current = user?.id;

  // Initial snapshot over REST — leaderboard.update only fires on settle, so without this the
  // board is empty until the first round settles.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchCs2ArenaDetail(arenaId), fetchCs2Leaderboard(arenaId).catch(() => null)])
      .then(([detail, board]) => {
        if (cancelled) return;
        const rows: LeaderRow[] = (board?.entries ?? []).map((e, i) => ({
          rank: e.rank ?? i + 1,
          name: e.username,
          score: e.score,
          status: e.status,
          you: myUserId.current != null && e.userId === myUserId.current,
        }));
        setView((v) => v ?? { ...initialView(detail), leaderboard: rows });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [arenaId]);

  useEffect(() => {
    if (!token) return;
    const ws = new WebSocket(buildCs2WsUrl(token));
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
        /* ignore malformed frames */
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [arenaId, token]);

  const submitAnswer = useCallback(
    (answer: Answer) => {
      const ws = wsRef.current;
      const roundId = view?.round?.roundId;
      if (ws && ws.readyState === WebSocket.OPEN && roundId && view?.myStatus !== "eliminated") {
        ws.send(JSON.stringify({ type: "answer", roundId, answer }));
      }
    },
    [view],
  );

  return { view, connected, submitAnswer };
}
