import { useCallback, useEffect, useRef, useState } from "react";
import type { Answer, ArenaDetailResponse, ServerMessage } from "@arena/contracts";
import {
  fetchArenaDetail,
  fetchEventAccessSession,
  fetchLeaderboard,
  notifyEventAccessRequired,
} from "../../api/client.js";
import { useAuth } from "../../auth/AuthContext.js";
import type { ArenaView, FeedItem, LeaderRow } from "../arenaView.js";
import { makeDemoView } from "../arenaView.js";

function buildWsUrl(token: string | null): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
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

/** Keeps feed entries readable — a long question shouldn't blow out the feed item's width. */
function truncate(text: string, max = 64): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Fold a server message into the current view. */
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
          text: msg.question
            ? `Round settled · ${truncate(msg.question)} · answer ${msg.correctAnswer.toUpperCase()}`
            : `Round settled · answer ${msg.correctAnswer.toUpperCase()}`,
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
      // A declared winner never reverts: the arena-player store only tracks eliminations, so a
      // reconnect's personal status resync (ws.ts's `runtime.statusFor`) would otherwise still
      // read "active" for a winner and downgrade them right after the arena.finished resync sets
      // myStatus to "winner" — see the arena.finished case below.
      const status = view.myStatus === "winner" ? "winner" : msg.status;
      const next = { ...view, myStatus: status };
      // A resync push (subscribe/reconnect) carries no roundId and isn't a fresh event to
      // announce — except "winner", which has no roundId even live (harmless to show again).
      if (msg.roundId === undefined && msg.status !== "winner") return next;
      const kind = msg.status === "eliminated" ? "eliminated" : "survived";
      const text =
        msg.status === "eliminated" ? "You were eliminated" : msg.status === "winner" ? "You won!" : "You survived";
      return { ...next, feed: prepend(view.feed, { id: `me-${Date.now()}`, kind, text, minute: view.minute }) };
    }
    case "player.pending":
      // Full-list snapshot from the server (re-sent on lock/settle/subscribe) — replace, don't merge.
      return { ...view, pendingPredictions: msg.predictions };
    case "arena.finished": {
      // Cached and replayed on every (re)subscribe (ws.ts's handleSubscribe), so this is what
      // makes the winner banner survive a page reload — myStatus is set here from the winners
      // list itself, not just from the live personal player.status push.
      const iWon = myUserId != null && msg.winners.includes(myUserId);
      return {
        ...view,
        ...(iWon ? { myStatus: "winner" as const } : {}),
        feed: prepend(view.feed, { id: `fin-${Date.now()}`, kind: "info", text: "Match finished", minute: view.minute }),
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

/** Live arena state over WebSocket. `arenaId === "demo"` returns the seeded view (no socket). */
export function useArenaSocket(arenaId: string): ArenaSocket {
  const isDemo = arenaId === "demo";
  const { token, user } = useAuth();
  const [view, setView] = useState<ArenaView | null>(() => (isDemo ? makeDemoView() : null));
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  // Kept current so the (once-created) message handler always sees the latest signed-in user.
  const myUserId = useRef<string | undefined>(undefined);
  myUserId.current = user?.id;

  // Initial snapshot over REST (no auth) so the scoreboard + current board show immediately —
  // WS leaderboard.update only fires on settle, so without this the board is empty until then.
  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    void Promise.all([fetchArenaDetail(arenaId), fetchLeaderboard(arenaId).catch(() => null)])
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
  }, [arenaId, isDemo]);

  // Live updates over WS — the gateway requires auth, so (re)connect once a token arrives.
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
        /* ignore malformed frames */
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
      // Belt-and-suspenders: PredictionCard already hides the buttons once eliminated, and the
      // backend rejects an eliminated player's answer regardless — but never even send it.
      if (!isDemo && ws && ws.readyState === WebSocket.OPEN && roundId && view?.myStatus !== "eliminated") {
        ws.send(JSON.stringify({ type: "answer", roundId, answer }));
      }
    },
    [isDemo, view],
  );

  return { view, connected, submitAnswer };
}
