import { useCallback, useEffect, useRef, useState } from "react";
import type { Answer, ArenaDetailResponse, LeaderboardEntry, ServerMessage } from "@arena/contracts";
import { fetchCs2ArenaDetail, fetchCs2Leaderboard, fetchCs2ArenaRounds } from "../api/cs2Client.js";
import { notifyEventAccessRequired, fetchEventAccessSession } from "../../api/client.js";
import { useAuth } from "../../auth/AuthContext.js";
import type { Cs2AnswerSubmission, Cs2ArenaView, LeaderRow } from "../cs2View.js";
import { cs2FeedRoundFromHistory, cs2FeedRoundFromLive, type Cs2FeedRound } from "./cs2Feed.js";
import type { Cs2NewRoundSignal } from "./useCs2RoundAlerts.js";

function buildCs2WsUrl(token: string | null): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${proto}//${window.location.host}/cs2-ws${query}`;
}

function reconcileArenaStatus(view: Cs2ArenaView, detail: ArenaDetailResponse): Cs2ArenaView {
  return detail.arena.status === "finished" ? { ...view, finished: true } : view;
}

function leaderRows(entries: LeaderboardEntry[], myUserId: string | undefined): LeaderRow[] {
  return entries.map((e, i) => ({
    rank: e.rank ?? i + 1,
    name: e.username,
    score: e.score,
    status: e.status,
    you: myUserId != null && e.userId === myUserId,
    ...(e.eliminatedRound !== undefined ? { eliminatedRound: e.eliminatedRound } : {}),
  }));
}

function updateRound(rounds: Cs2FeedRound[], roundId: string, patch: Partial<Cs2FeedRound>): Cs2FeedRound[] {
  return rounds.map((round) => (round.id === roundId ? { ...round, ...patch } : round));
}

const DONE: ReadonlySet<Cs2FeedRound["status"]> = new Set(["settled", "voided"]);

/** A refetched history can lag the write queue: keep live rounds it lacks and live outcomes it hasn't stored yet. */
function mergeRounds(history: Cs2FeedRound[], live: Cs2FeedRound[]): Cs2FeedRound[] {
  const liveById = new Map(live.map((round) => [round.id, round]));
  const merged = history.map((round) => {
    const current = liveById.get(round.id);
    return current !== undefined && DONE.has(current.status) && !DONE.has(round.status)
      ? { ...current, ...(round.mine !== undefined ? { mine: round.mine } : {}) }
      : round;
  });
  const known = new Set(history.map((round) => round.id));
  return [...merged, ...live.filter((round) => !known.has(round.id))];
}

function initialView(d: ArenaDetailResponse): Cs2ArenaView {
  if (d.match.discipline !== "cs2") throw new Error(`Arena ${d.arena.id} is not a CS2 arena`);
  const round = d.currentRound;
  return reconcileArenaStatus(
    {
      mode: d.arena.mode,
      zone: { type: "arena.zone", stage: "zone", zone: 0, nextZone: 0 },
      teams: [d.match.teamScores[0].name, d.match.teamScores[1].name],
      teamIdentities: d.match.teamScores.map(({ teamId, name }) => ({ teamId, name })),
      ...(d.arena.finalCircleFromRound !== undefined ? { finalCircleFromRound: d.arena.finalCircleFromRound } : {}),
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
      rounds: [],
      liveResults: {},
      leaderboard: [],
    },
    d,
  );
}

function reduce(view: Cs2ArenaView, msg: ServerMessage, myUserId?: string): Cs2ArenaView {
  switch (msg.type) {
    case "round.open": {
      const known = view.rounds.some((round) => round.id === msg.round.id);
      return {
        ...view,
        round: {
          roundId: msg.round.id,
          roundNumber: msg.round.roundNumber ?? 0,
          question: msg.round.question,
          status: "open",
        },
        rounds: known ? view.rounds : [...view.rounds, cs2FeedRoundFromLive(msg.round)],
      };
    }
    case "round.lock":
      return {
        ...view,
        ...(view.round ? { round: { ...view.round, status: "locked" as const } } : {}),
        rounds: updateRound(view.rounds, msg.roundId, { status: "locked" }),
      };
    case "round.settle":
      return {
        ...view,
        survivors: msg.survivorsCount,
        ...(view.round && view.round.roundId === msg.roundId
          ? { round: { ...view.round, status: "settled" as const, correctAnswer: msg.correctAnswer, survivalRuleApplied: msg.survivalRuleApplied } }
          : {}),
        rounds: updateRound(view.rounds, msg.roundId, {
          status: "settled",
          correctAnswer: msg.correctAnswer,
          ...(msg.survivalRuleApplied !== undefined ? { survivalRuleApplied: msg.survivalRuleApplied } : {}),
        }),
      };
    case "round.void": {
      const known = view.rounds.some((round) => round.id === msg.roundId);
      const roundNumber = msg.roundNumber ?? (view.round?.roundId === msg.roundId ? view.round.roundNumber : undefined);
      return {
        ...view,
        ...(view.round && view.round.roundId === msg.roundId ? { round: undefined } : {}),
        rounds: known
          ? updateRound(view.rounds, msg.roundId, { status: "voided" })
          : roundNumber === undefined
            ? view.rounds
            : [...view.rounds, { id: msg.roundId, roundNumber, status: "voided", question: "" }],
      };
    }
    case "player.result":
      return {
        ...view,
        liveResults: { ...view.liveResults, [msg.roundId]: { answer: msg.answer, result: msg.result, points: msg.points } },
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
    case "arena.zone":
      return {
        ...view,
        zone: msg,
        ...(msg.stage === "final_circle" ? { finalCircleFromRound: msg.fromRound } : {}),
      };
    case "arena.cancelled":
      return { ...view, cancelled: { reason: msg.reason } };
    case "leaderboard.update":
      return {
        ...view,
        leaderboard: leaderRows(msg.entries, myUserId),
        survivors: msg.entries.filter((e) => e.status !== "eliminated").length,
        totalPlayers: msg.entries.length,
      };
    case "player.status":
      // A stale reconnect snapshot must not downgrade a terminal winner state.
      return { ...view, myStatus: view.myStatus === "winner" ? "winner" : msg.status };
    case "arena.finished": {
      const iWon = myUserId != null && msg.winners.includes(myUserId);
      return { ...view, finished: true, ...(iWon ? { myStatus: "winner" as const } : {}) };
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
  newRoundSignal: Cs2NewRoundSignal | null;
  /** Increments once, the first time this player's status genuinely becomes "winner". */
  victorySignal: number;
}

export function useCs2ArenaSocket(arenaId: string): Cs2ArenaSocket {
  const { token, user } = useAuth();
  const [detail, setDetail] = useState<ArenaDetailResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [view, setView] = useState<Cs2ArenaView | null>(null);
  const [connected, setConnected] = useState(false);
  const [answerSubmission, setAnswerSubmission] = useState<Cs2AnswerSubmission>({ status: "idle" });
  const [newRoundSignal, setNewRoundSignal] = useState<Cs2NewRoundSignal | null>(null);
  const [victorySignal, setVictorySignal] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  // WS replays can beat the first REST load; hold them until there is a view to apply them to.
  const viewReady = useRef(false);
  const earlyMessages = useRef<ServerMessage[]>([]);
  const myUserId = useRef<string | undefined>(undefined);
  const lastRoundId = useRef<string | undefined>(undefined);
  // Tracks whether we've already counted this player's win, so a duplicate signal for the same
  // win (player.status AND arena.finished both arrive for one finish) doesn't double-fire.
  const wasWinner = useRef(false);
  myUserId.current = user?.id;

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setLoadError(false);
    setView(null);
    viewReady.current = false;
    earlyMessages.current = [];
    lastRoundId.current = undefined;
    wasWinner.current = false;
    const applyEarlyMessages = (view: Cs2ArenaView): Cs2ArenaView => {
      const queued = earlyMessages.current;
      earlyMessages.current = [];
      viewReady.current = true;
      return queued.reduce((acc, msg) => reduce(acc, msg, myUserId.current), view);
    };
    void Promise.all([
      fetchCs2ArenaDetail(arenaId),
      fetchCs2Leaderboard(arenaId).catch(() => null),
      fetchCs2ArenaRounds(arenaId).catch(() => null),
    ])
      .then(([detail, board, rounds]) => {
        if (cancelled) return;
        setDetail(detail);
        lastRoundId.current = detail.currentRound?.id;
        const leaderboard = leaderRows(board?.entries ?? [], myUserId.current);
        const history = (rounds?.rounds ?? []).map((round) => cs2FeedRoundFromHistory(round, myUserId.current));
        const fresh = applyEarlyMessages(reconcileArenaStatus({ ...initialView(detail), leaderboard, rounds: history }, detail));
        setView((v) => (v ? reconcileArenaStatus(v, detail) : fresh));
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
          // round/feed/leaderboard/survivors/totalPlayers are only ever set via WS.
          if (next.match.discipline !== "cs2") return;
          const teams: readonly [string, string] = [next.match.teamScores[0].name, next.match.teamScores[1].name];
          const fresh = viewReady.current ? undefined : applyEarlyMessages(reconcileArenaStatus(initialView(next), next));
          setView((current) => (current ? reconcileArenaStatus({ ...current, teams }, next) : fresh ?? reconcileArenaStatus(initialView(next), next)));
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
    let hasConnectedBefore = false;

    const connect = () => {
      const ws = new WebSocket(buildCs2WsUrl(token));
      wsRef.current = ws;
      // The subscribe response always includes a personal-state resync as its first
      // status-bearing message (apps/api/src/gateway/ws.ts's subscribe handler) — never a live
      // transition. Skip it so reconnecting to an already-won arena doesn't replay the sound.
      let restoredStatus = false;
      ws.onopen = () => {
        reconnectAttempt = 0;
        setConnected(true);
        ws.send(JSON.stringify({ type: "subscribe", arenaId }));
        if (hasConnectedBefore) {
          void fetchCs2ArenaRounds(arenaId)
            .then((rounds) => {
              if (disposed) return;
              // Rounds settled while offline come from the history.
              const history = rounds.rounds.map((round) => cs2FeedRoundFromHistory(round, myUserId.current));
              setView((v) => (v ? { ...v, rounds: mergeRounds(history, v.rounds) } : v));
            })
            .catch(() => undefined);
        }
        hasConnectedBefore = true;
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
              if (lastRoundId.current !== msg.round.id) {
                lastRoundId.current = msg.round.id;
                setNewRoundSignal({ roundId: msg.round.id });
              }
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
            case "player.status":
              if (!restoredStatus) {
                restoredStatus = true;
                if (msg.status === "winner") wasWinner.current = true;
              } else if (msg.status === "winner" && !wasWinner.current) {
                wasWinner.current = true;
                setVictorySignal((n) => n + 1);
              }
              break;
            case "arena.finished": {
              const iWon = myUserId.current != null && msg.winners.includes(myUserId.current);
              if (!restoredStatus) {
                restoredStatus = true;
                if (iWon) wasWinner.current = true;
              } else if (iWon && !wasWinner.current) {
                wasWinner.current = true;
                setVictorySignal((n) => n + 1);
              }
              break;
            }
          }
          if (viewReady.current) setView((v) => (v ? reduce(v, msg, myUserId.current) : v));
          else earlyMessages.current.push(msg);
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
    newRoundSignal,
    victorySignal,
  };
}
