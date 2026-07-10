// B8 — scripted bot players for the headless replay demo. No real client exists to answer
// rounds, so a small deterministic roster stands in: a mix of always-yes / always-no / seeded
// pseudo-random strategies so bots get eliminated across different rounds rather than all
// surviving or all dying together, letting the demo reach a genuine winner (spec §7).

import type { Answer, PredictionRound, Uuid } from "@arena/contracts";

export interface BotPlayer {
  userId: Uuid;
  username: string;
  joinedAt: string;
  /** Deterministic per-round answer strategy — pure function of the bot and the round. */
  answerFor(round: PredictionRound): Answer;
}

function botUserId(index: number): Uuid {
  return `00000000-0000-0000-0000-0000b0700${String(index).padStart(2, "0")}` as Uuid;
}

/** Small deterministic hash of (botIndex, windowStartMinute) — no crypto needed, just spread. */
function seededBit(seedA: number, seedB: number): boolean {
  const x = Math.sin(seedA * 928_371 + seedB * 57) * 10_000;
  return x - Math.floor(x) >= 0.5;
}

/**
 * Builds `count` bots: the first two are fixed always-yes / always-no strategies (useful as a
 * sanity anchor), the rest answer via a seeded pseudo-random pattern keyed off their own index
 * and the round's window — deterministic across runs, but varied bot-to-bot.
 */
export function createBots(count: number): BotPlayer[] {
  const bots: BotPlayer[] = [];
  for (let i = 0; i < count; i++) {
    const userId = botUserId(i);
    const username = `bot-${i}`;
    const joinedAt = new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString();

    let answerFor: (round: PredictionRound) => Answer;
    if (i === 0) answerFor = () => "yes";
    else if (i === 1) answerFor = () => "no";
    else answerFor = (round) => (seededBit(i, round.windowStartMinute) ? "yes" : "no");

    bots.push({ userId, username, joinedAt, answerFor });
  }
  return bots;
}
