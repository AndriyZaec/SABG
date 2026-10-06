import { normalizeCs2StreamUrl } from "@arena/contracts";
import { describe, expect, it } from "vitest";

describe("normalizeCs2StreamUrl", () => {
  it.each([
    ["HTTPS://WWW.TWITCH.TV/ESLCS", { provider: "twitch", url: "https://twitch.tv/eslcs" }],
    ["kick.com/user_name", { provider: "kick", url: "https://kick.com/user-name" }],
    ["https://youtu.be/dQw4w9WgXcQ?t=10", { provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }],
    ["https://youtube.com/live/dQw4w9WgXcQ", { provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }],
    ["https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ", { provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeCs2StreamUrl(input)).toEqual(expected);
  });

  it.each([
    "https://example.com/eslcs",
    "https://twitch.tv/a",
    "https://kick.com/user/channel",
    "https://youtube.com/@eslcs",
    "https://youtube.com/playlist?list=PL123",
    "https://youtube.com/watch?v=too-short",
  ])("rejects unsupported input %s", (input) => {
    expect(() => normalizeCs2StreamUrl(input)).toThrow();
  });
});
