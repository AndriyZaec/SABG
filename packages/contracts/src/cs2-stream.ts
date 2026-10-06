export const CS2_STREAM_PROVIDERS = ["twitch", "kick", "youtube"] as const;
export type Cs2StreamProvider = (typeof CS2_STREAM_PROVIDERS)[number];

export interface Cs2StreamLink {
  provider: Cs2StreamProvider;
  url: string;
}

const TWITCH_CHANNEL = /^[A-Za-z0-9][A-Za-z0-9_]{3,24}$/u;
const KICK_CHANNEL = /^[A-Za-z0-9_-]{1,50}$/u;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;
const TWITCH_URL = /^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^/?#]+)\/?(?:[?#].*)?$/iu;
const KICK_URL = /^(?:https?:\/\/)?(?:www\.|m\.)?kick\.com\/([^/?#]+)\/?(?:[?#].*)?$/iu;
const YOUTUBE_SHORT_URL = /^(?:https?:\/\/)?youtu\.be\/([^/?#]+)\/?(?:[?#].*)?$/iu;
const YOUTUBE_LIVE_URL = /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/live\/([^/?#]+)\/?(?:[?#].*)?$/iu;
const YOUTUBE_WATCH_URL = /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/watch\?([^#]+)(?:#.*)?$/iu;

export function normalizeCs2StreamUrl(input: string): Cs2StreamLink {
  const value = input.trim();
  const twitch = TWITCH_URL.exec(value);
  if (twitch !== null) {
    const channel = twitch[1]!;
    if (!TWITCH_CHANNEL.test(channel)) {
      throw new Error("Twitch channel must be 4-25 letters, digits, or underscores and start with a letter or digit");
    }
    return { provider: "twitch", url: `https://twitch.tv/${channel.toLowerCase()}` };
  }

  const kick = KICK_URL.exec(value);
  if (kick !== null) {
    const channel = kick[1]!;
    if (!KICK_CHANNEL.test(channel)) {
      throw new Error("Kick channel must be 1-50 letters, digits, underscores, or hyphens");
    }
    return { provider: "kick", url: `https://kick.com/${channel.replaceAll("_", "-")}` };
  }

  const watch = YOUTUBE_WATCH_URL.exec(value);
  const watchVideoId = watch?.[1]?.split("&").find((part) => part.startsWith("v="))?.slice(2);
  const youtubeVideoId = YOUTUBE_SHORT_URL.exec(value)?.[1]
    ?? YOUTUBE_LIVE_URL.exec(value)?.[1]
    ?? watchVideoId;

  if (youtubeVideoId !== undefined && YOUTUBE_VIDEO_ID.test(youtubeVideoId)) {
    return { provider: "youtube", url: `https://www.youtube.com/watch?v=${youtubeVideoId}` };
  }

  throw new Error("Stream URL must be a Twitch or Kick channel, or a specific YouTube video/live link");
}
