import type { Answer, PredictionResult, RoundWithPredictions } from "@arena/contracts";
import type { FeedItem } from "./arenaView.js";

export function truncate(text: string, max = 64): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export const VOID_FEED_TEXT = "Round voided — match ended first";
export const SURVIVED_TEXT = "You survived";
export const ELIMINATED_TEXT = "You were eliminated";

export function settleFeedId(roundId: string): string {
  return `settle-${roundId}`;
}

export function voidFeedId(roundId: string): string {
  return `void-${roundId}`;
}

export function formatSettleText(question: string | undefined, correctAnswer: Answer): string {
  const answer = correctAnswer.toUpperCase();
  return question ? `Round settled · ${truncate(question)} · answer ${answer}` : `Round settled · answer ${answer}`;
}

function personalResultItem(id: string, result: PredictionResult): FeedItem {
  const survived = result === "correct";
  return { id, kind: survived ? "survived" : "eliminated", text: survived ? SURVIVED_TEXT : ELIMINATED_TEXT };
}

export function prependFeedItem(feed: FeedItem[], item: FeedItem): FeedItem[] {
  return [item, ...feed.filter((f) => f.id !== item.id)].slice(0, 20);
}

export function feedFromRounds(rounds: RoundWithPredictions[], myUserId?: string): FeedItem[] {
  const items: FeedItem[] = [];

  for (const { round, predictions } of rounds) {
    if (round.status === "settled" && round.correctAnswer !== undefined) {
      items.push({
        id: settleFeedId(round.id),
        kind: "info",
        text: formatSettleText(round.question, round.correctAnswer),
      });

      const mine = myUserId !== undefined ? predictions.find((p) => p.userId === myUserId) : undefined;
      if (mine?.result !== undefined) items.push(personalResultItem(`me-${round.id}`, mine.result));
    } else if (round.status === "voided") {
      items.push({ id: voidFeedId(round.id), kind: "info", text: VOID_FEED_TEXT });
    }
  }

  return items.reverse().slice(0, 20);
}
