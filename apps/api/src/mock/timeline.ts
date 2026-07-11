// Mock WS scripted round lifecycle — implements the WS catalog (@arena/contracts ws.ts) so the
// frontend can develop against a realistic push sequence. Replaced by the real Realtime Gateway.
//
// Spectator privacy (spec §8): round.lock only ever carries an aggregate, never
// individual answers — mirrored here even though it's fixture data.

import type { WebSocket } from "ws";
import { MATCH_WINDOWS, MIN_LEAD_TIME_SECONDS } from "@arena/contracts";
import type { Answer, ClientMessage, LeaderboardEntry, ServerMessage } from "@arena/contracts";

import {
  MOCK_USER_ID,
  buildMockRound,
  mockLeaderboard,
  mockMatchState,
} from "./fixtures.js";

const FAN_BOGDAN_ID = "00000000-0000-0000-0000-000000000002";
const FAN_CARLA_ID = "00000000-0000-0000-0000-000000000003";

/** Lead time before lock (spec §5: >= 60s in prod). Override for fast manual testing. */
const LEAD_MS = Number(process.env["MOCK_LEAD_MS"] ?? MIN_LEAD_TIME_SECONDS * 1000);
/** How many windows to play through before emitting arena.finished. */
const ROUNDS_TO_PLAY = 3;

/** Scripted per-round aggregate/settlement, one entry per round (index = played - 1). */
const ROUND_SCRIPTS: {
  aggregate: { yesPct: number; noPct: number; total: number };
  correctAnswer: Answer;
  survivorsCount: number;
}[] = [
  { aggregate: { yesPct: 62, noPct: 38, total: 47 }, correctAnswer: "yes", survivorsCount: 96 },
  { aggregate: { yesPct: 45, noPct: 55, total: 64 }, correctAnswer: "no", survivorsCount: 68 },
  { aggregate: { yesPct: 70, noPct: 30, total: 41 }, correctAnswer: "yes", survivorsCount: 41 },
];

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

/**
 * Mutates `entries` in place to reflect round `roundNumber` (1-based) of the scripted
 * playthrough. When `eliminateMockUser` is true, the mock user loses in round 2 and
 * fan_carla goes on to win instead — so reconnecting exercises both the "you won" and
 * "you were eliminated" flows deterministically.
 */
function evolveLeaderboard(
  entries: LeaderboardEntry[],
  roundNumber: number,
  eliminateMockUser: boolean,
): void {
  const mock = entries.find((e) => e.userId === MOCK_USER_ID);
  const bogdan = entries.find((e) => e.userId === FAN_BOGDAN_ID);
  const carla = entries.find((e) => e.userId === FAN_CARLA_ID);

  switch (roundNumber) {
    case 1:
      if (mock && mock.status === "active") {
        if (eliminateMockUser) mock.missedCount++;
        else mock.score++;
      }
      if (bogdan && bogdan.status === "active") bogdan.score++;
      if (carla && carla.status === "active") carla.missedCount++;
      break;
    case 2:
      if (mock && mock.status === "active") {
        if (eliminateMockUser) {
          mock.missedCount++;
          mock.status = "eliminated";
        } else {
          mock.score++;
        }
      }
      if (bogdan && bogdan.status === "active") bogdan.status = "eliminated";
      if (carla && carla.status === "active") carla.score++;
      break;
    case 3:
      if (mock && mock.status === "active") mock.score++;
      if (carla && carla.status === "active") {
        if (eliminateMockUser) {
          carla.score++;
        } else {
          carla.missedCount++;
          carla.status = "eliminated";
        }
      }
      break;
  }

  const ranked = entries.filter((e) => e.status === "active").sort((a, b) => b.score - a.score);
  for (const entry of entries) entry.rank = undefined;
  ranked.forEach((entry, i) => {
    entry.rank = i + 1;
  });
}

let connectionSeq = 0;

/**
 * Drives one connection through a scripted match: match.state, then
 * open -> lock -> settle -> leaderboard.update -> player.status per round,
 * looping ROUNDS_TO_PLAY times, then arena.finished.
 * Returns a cleanup function to clear pending timers on socket close.
 */
export function startMockTimeline(socket: WebSocket): () => void {
  connectionSeq += 1;
  const eliminateMockUser = connectionSeq % 2 === 0;

  const timers: NodeJS.Timeout[] = [];
  const schedule = (fn: () => void, delayMs: number): void => {
    timers.push(setTimeout(fn, delayMs));
  };

  send(socket, { type: "match.state", state: mockMatchState });

  const leaderboard: LeaderboardEntry[] = mockLeaderboard.map((e) => ({ ...e }));

  let windowIndex = 2; // start mid-match, matches fixtures.mockCurrentRound
  let played = 0;

  const playRound = (): void => {
    if (played >= ROUNDS_TO_PLAY) {
      const winners = leaderboard.filter((e) => e.status === "active").map((e) => e.userId);
      send(socket, { type: "arena.finished", winners });
      if (winners.includes(MOCK_USER_ID)) {
        send(socket, { type: "player.status", status: "winner" });
      }
      return;
    }
    played += 1;
    const script = ROUND_SCRIPTS[played - 1]!;

    const round = buildMockRound(windowIndex);
    windowIndex = (windowIndex + 1) % MATCH_WINDOWS.length;
    const lockAt = new Date(Date.now() + LEAD_MS).toISOString();

    send(socket, { type: "round.open", round: { ...round, status: "open", openedAt: new Date().toISOString() }, lockAt });

    schedule(() => {
      send(socket, {
        type: "round.lock",
        roundId: round.id,
        aggregate: script.aggregate,
      });

      schedule(() => {
        send(socket, {
          type: "round.settle",
          roundId: round.id,
          correctAnswer: script.correctAnswer,
          settledBy: "window_end",
          survivorsCount: script.survivorsCount,
        });

        evolveLeaderboard(leaderboard, played, eliminateMockUser);
        send(socket, { type: "leaderboard.update", entries: leaderboard.map((e) => ({ ...e })) });

        const mockEntry = leaderboard.find((e) => e.userId === MOCK_USER_ID);
        send(socket, {
          type: "player.status",
          status: mockEntry?.status === "eliminated" ? "eliminated" : "active",
          roundId: round.id,
        });

        schedule(playRound, 2_000);
      }, 2_000);
    }, LEAD_MS);
  };

  schedule(playRound, 1_000);

  return () => {
    for (const timer of timers) clearTimeout(timer);
  };
}

export function handleClientMessage(socket: WebSocket, raw: string): void {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    return;
  }
  switch (message.type) {
    case "subscribe":
      // Timeline is already started on connection in this mock (single-arena fixture).
      break;
    case "answer":
      // Mock just acks via logging; real answer flow is REST POST /rounds/:id/answer or WS.
      console.log(`[mock ws] answer received: round=${message.roundId} answer=${message.answer}`);
      break;
  }
}
