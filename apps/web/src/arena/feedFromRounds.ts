import type { Answer, PredictionResult, RoundWithPredictions } from "@arena/contracts";
import type { FeedItem } from "./arenaView.js";

// Reconstructs the match feed from GET /arenas/:id/rounds's persisted history (rest.ts) —
// `feed` itself is purely client-side, built by reduce() off live WS messages, and never
// survives a reload. Reused as-is for CS2 (see cs2View.ts's re-export). The id/text builders
// below are shared with both live reducers (arena/live/useArenaSocket.ts,
// cs2/live/useCs2ArenaSocket.ts) so a live message that arrives after this seed produces a
// byte-identical `FeedItem` and dedupes against it (via `prependFeedItem`) instead of doubling up.

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

/** Prepends a live message, dropping any existing entry with the same `id` first — a live
 *  message can duplicate an entry already reconstructed from round history (same id scheme). */
export function prependFeedItem(feed: FeedItem[], item: FeedItem): FeedItem[] {
  return [item, ...feed.filter((f) => f.id !== item.id)].slice(0, 20);
}

/** `rounds` must be in creation order (oldest first, as `listByArenaId` returns them) — the
 *  result is newest-first, capped at 20, matching live `prependFeedItem`'s ordering/limit. */
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
