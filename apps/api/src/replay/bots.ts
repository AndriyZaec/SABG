import type { Answer, PredictionRound, Uuid } from "@arena/contracts";

export interface BotPlayer {
  userId: Uuid;
  username: string;
  joinedAt: string;
  answerFor(round: PredictionRound): Answer;
}

function botUserId(index: number): Uuid {
  return `00000000-0000-0000-0000-0000b0700${String(index).padStart(2, "0")}` as Uuid;
}

function seededBit(seedA: number, seedB: number): boolean {
  const x = Math.sin(seedA * 928_371 + seedB * 57) * 10_000;
  return x - Math.floor(x) >= 0.5;
}

export function createBots(count: number): BotPlayer[] {
  const bots: BotPlayer[] = [];
  for (let i = 0; i < count; i++) {
    const userId = botUserId(i);
    const username = `bot-${i}`;
    const joinedAt = new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString();

    let answerFor: (round: PredictionRound) => Answer;
    if (i === 0) answerFor = () => "yes";
    else if (i === 1) answerFor = () => "no";
    else answerFor = (round) => (seededBit(i, round.windowStartMinute ?? 0) ? "yes" : "no");

    bots.push({ userId, username, joinedAt, answerFor });
  }
  return bots;
}
