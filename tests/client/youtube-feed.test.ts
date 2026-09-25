import { describe, expect, it } from "vitest";
import { isYouTubeChannelFeed } from "../../src/shared/youtube.js";

describe("YouTube sync suggestion eligibility", () => {
  it.each(["www.youtube.com", "youtube.com"])(
    "recognizes a channel feed on %s regardless of how it was added",
    (host) => {
      expect(
        isYouTubeChannelFeed(
          `https://${host}/feeds/videos.xml?channel_id=UCsXVk37bltHxD1rDPwtNM8Q`,
        ),
      ).toBe(true);
    },
  );

  it.each([
    "https://example.com/feed.xml",
    "https://example.com/feeds/videos.xml?channel_id=UCsXVk37bltHxD1rDPwtNM8Q",
    "https://www.youtube.com/feeds/videos.xml?playlist_id=PL123",
    "https://www.youtube.com/feeds/videos.xml?channel_id=",
    "https://www.youtube.com/@kurzgesagt",
  ])("does not suggest channel sync for other sources: %s", (url) => {
    expect(isYouTubeChannelFeed(url)).toBe(false);
  });
});
