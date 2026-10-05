// The player URL for a series' stream. Only the normalized channel URL the operator stores is accepted, so nothing
// else can reach an iframe.

const STREAM_URL = /^https:\/\/(twitch\.tv|kick\.com)\/([A-Za-z0-9_-]+)$/u;

export interface StreamEmbed {
  label: "Twitch" | "Kick";
  src: string;
}

/** `hostname` is the page's own: Twitch only plays inside the domains its `parent` parameter names. */
export function streamEmbed(streamUrl: string, hostname: string): StreamEmbed | undefined {
  const match = STREAM_URL.exec(streamUrl);
  if (match === null) return undefined;
  const channel = match[2]!;
  if (match[1] === "twitch.tv") {
    const params = new URLSearchParams({ channel, parent: hostname, muted: "true", autoplay: "true" });
    return { label: "Twitch", src: `https://player.twitch.tv/?${params.toString()}` };
  }
  return { label: "Kick", src: `https://player.kick.com/${channel}?muted=true&autoplay=true` };
}
