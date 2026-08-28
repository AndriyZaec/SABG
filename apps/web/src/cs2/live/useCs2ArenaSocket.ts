import { useCallback, useEffect, useRef, useState } from "react";
import type { Answer, ArenaDetailResponse, ServerMessage } from "@arena/contracts";
import { fetchCs2ArenaDetail, fetchCs2Leaderboard, fetchCs2ArenaRounds } from "../api/cs2Client.js";
import { notifyEventAccessRequired, fetchEventAccessSession } from "../../api/client.js";
import { useAuth } from "../../auth/AuthContext.js";
import {
  ELIMINATED_TEXT,
  feedFromRounds,
  formatSettleText,
  prependFeedItem,
  settleFeedId,
  SURVIVED_TEXT,
  voidFeedId,
  VOID_FEED_TEXT,
} from "../../arena/feedFromRounds.js";
import type { Cs2AnswerSubmission, Cs2ArenaView, LeaderRow } from "../cs2View.js";

function buildCs2WsUrl(token: string | null): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${proto}//${window.location.host}/cs2-ws${query}`;
}

function initialView(d: ArenaDetailResponse): Cs2ArenaView {
  if (d.match.discipline !== "cs2") throw new Error(`Arena ${d.arena.id} is not a CS2 arena`);
  const round = d.currentRound;
  return {
    teams: [d.match.teamScores[0].name, d.match.teamScores[1].name],
    survivors: d.arena.activePlayersCount,
    totalPlayers: d.arena.activePlayersCount,
    // Restore the current round from the authoritative reconnect snapshot.
    ...(round
      ? {
          round: {
            roundId: round.id,
            roundNumber: round.roundNumber ?? 0,
            question: round.question,
            status: round.status,
          },
        }
      : {}),
    feed: [],
    leaderboard: [],
  };
}

function reduce(view: Cs2ArenaView, msg: ServerMessage, myUserId?: string): Cs2ArenaView {
  switch (msg.type) {
    case "round.open":
      return {
        ...view,
        round: {
          roundId: msg.round.id,
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
        feed: prependFeedItem(view.feed, {
          id: settleFeedId(msg.roundId),
          kind: "info",
          text: formatSettleText(msg.question, msg.correctAnswer),
        }),
      };
    case "round.void":
      return {
        ...view,
        ...(view.round && view.round.roundId === msg.roundId ? { round: undefined } : {}),
        feed: prependFeedItem(view.feed, { id: voidFeedId(msg.roundId), kind: "info", text: VOID_FEED_TEXT }),
      };
    case "player.pending":
      // Replace with the authoritative personal snapshot.
      return { ...view, pendingPredictions: msg.predictions };
    case "answer.accepted":
      return view.round?.roundId === msg.roundId
        ? { ...view, round: { ...view.round, myAnswer: msg.answer } }
        : view;
    case "answer.snapshot": {
      if (view.round?.roundId !== msg.roundId) return view;
      if (msg.answer !== null) return { ...view, round: { ...view.round, myAnswer: msg.answer } };
      const { myAnswer: _myAnswer, ...round } = view.round;
      return { ...view, round };
    }
    case "arena.cancelled":
      return {
        ...view,
        cancelled: { reason: msg.reason },
        feed: prependFeedItem(view.feed, { id: "cancelled", kind: "info", text: `Arena cancelled (${msg.reason})` }),
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
      // A stale reconnect snapshot must not downgrade a terminal winner state.
      const status = view.myStatus === "winner" ? "winner" : msg.status;
      const next = { ...view, myStatus: status };
      if (msg.roundId === undefined && msg.status !== "winner") return next;
      const kind = msg.status === "eliminated" ? "eliminated" : "survived";
      const text = msg.status === "eliminated" ? ELIMINATED_TEXT : msg.status === "winner" ? "You won!" : SURVIVED_TEXT;
      return { ...next, feed: prependFeedItem(view.feed, { id: `me-${Date.now()}`, kind, text }) };
    }
    case "arena.finished": {
      const iWon = myUserId != null && msg.winners.includes(myUserId);
      return {
        ...view,
        ...(iWon ? { myStatus: "winner" as const } : {}),
        feed: prependFeedItem(view.feed, { id: `fin-${Date.now()}`, kind: "info", text: "Series finished" }),
      };
    }
    default:
      return view;
  }
}

export interface Cs2ArenaSocket {
  detail: ArenaDetailResponse | null;
  loadError: boolean;
  view: Cs2ArenaView | null;
  connected: boolean;
  answerSubmission: Cs2AnswerSubmission;
  submitAnswer: (answer: Answer) => void;
  retry: () => void;
}

export function useCs2ArenaSocket(arenaId: string): Cs2ArenaSocket {
  const { token, user } = useAuth();
  const [detail, setDetail] = useState<ArenaDetailResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [view, setView] = useState<Cs2ArenaView | null>(null);
  const [connected, setConnected] = useState(false);
  const [answerSubmission, setAnswerSubmission] = useState<Cs2AnswerSubmission>({ status: "idle" });
  const wsRef = useRef<WebSocket | null>(null);
  const myUserId = useRef<string | undefined>(undefined);
  myUserId.current = user?.id;

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setLoadError(false);
    setView(null);
    void Promise.all([
      fetchCs2ArenaDetail(arenaId),
      fetchCs2Leaderboard(arenaId).catch(() => null),
      fetchCs2ArenaRounds(arenaId).catch(() => null),
    ])
      .then(([detail, board, rounds]) => {
        if (cancelled) return;
        setDetail(detail);
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
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    const poll = window.setInterval(() => {
      void fetchCs2ArenaDetail(arenaId)
        .then((next) => {
          if (cancelled) return;
          setDetail(next);
          setLoadError(false);
          setView((current) => current ?? initialView(next));
        })
        .catch(() => undefined);
    }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [arenaId, loadAttempt]);

  useEffect(() => {
    if (!token) return;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectAttempt = 0;

    const connect = () => {
      const ws = new WebSocket(buildCs2WsUrl(token));
      wsRef.current = ws;
      ws.onopen = () => {
        reconnectAttempt = 0;
        setConnected(true);
        ws.send(JSON.stringify({ type: "subscribe", arenaId }));
      };
      ws.onclose = (event) => {
        if (wsRef.current === ws) wsRef.current = null;
        setConnected(false);
        if (disposed) return;

        if (event.code === 4401 || event.code === 4403) {
          void fetchEventAccessSession()
            .then((session) => {
              if (session.status === "unauthenticated") notifyEventAccessRequired();
            })
            .catch(() => undefined);
          return;
        }

        const delayMs = Math.min(1_000 * 2 ** reconnectAttempt, 8_000);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, delayMs);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as ServerMessage;
          switch (msg.type) {
            case "round.open":
              setAnswerSubmission((current) =>
                "roundId" in current && current.roundId === msg.round.id ? current : { status: "idle" },
              );
              break;
            case "answer.accepted":
              setAnswerSubmission({ status: "accepted", roundId: msg.roundId, answer: msg.answer });
              break;
            case "answer.rejected":
              setAnswerSubmission({
                status: "rejected",
                roundId: msg.roundId,
                answer: msg.answer,
                reason: msg.reason,
              });
              break;
            case "answer.snapshot":
              setAnswerSubmission(
                msg.answer === null
                  ? { status: "idle" }
                  : { status: "accepted", roundId: msg.roundId, answer: msg.answer },
              );
              break;
          }
          setView((v) => (v ? reduce(v, msg, myUserId.current) : v));
        } catch {
          /* Ignore malformed frames. */
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [arenaId, token]);

  const submitAnswer = useCallback(
    (answer: Answer) => {
      const ws = wsRef.current;
      const roundId = view?.round?.roundId;
      const duplicate =
        answerSubmission.status === "accepted" &&
        answerSubmission.roundId === roundId &&
        answerSubmission.answer === answer;
      if (
        ws &&
        ws.readyState === WebSocket.OPEN &&
        roundId &&
        view?.myStatus !== "eliminated" &&
        answerSubmission.status !== "submitting" &&
        !duplicate
      ) {
        setAnswerSubmission({ status: "submitting", roundId, answer });
        ws.send(JSON.stringify({ type: "answer", roundId, answer }));
      }
    },
    [answerSubmission, view],
  );

  return {
    detail,
    loadError,
    view,
    connected,
    answerSubmission,
    submitAnswer,
    retry: () => setLoadAttempt((current) => current + 1),
  };
}
