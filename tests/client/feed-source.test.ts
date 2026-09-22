import { describe, expect, it } from "vitest";
import { feedSourceUrl } from "../../src/client/features/feeds/feed-source.js";

describe("add feed source input", () => {
  it("turns YouTube channel handles into discoverable channel URLs", () => {
    expect(feedSourceUrl("youtube", " @kurzgesagt ")).toBe("https://www.youtube.com/@kurzgesagt");
    expect(feedSourceUrl("youtube", "kurzgesagt")).toBe("https://www.youtube.com/@kurzgesagt");
  });

  it("keeps direct feed and website URLs unchanged", () => {
    expect(feedSourceUrl("rss", " https://example.com/feed.xml ")).toBe(
      "https://example.com/feed.xml",
    );
    expect(feedSourceUrl("rss", "https://example.com/articles")).toBe(
      "https://example.com/articles",
    );
    expect(feedSourceUrl("rss", "http://example.com/feed.xml")).toBe("http://example.com/feed.xml");
  });

  it.each([
    ["gwern.net/blog", "https://gwern.net/blog"],
    [" gwern.net ", "https://gwern.net"],
    ["example.com/feed.xml?format=rss#latest", "https://example.com/feed.xml?format=rss#latest"],
    ["example.com:8443/feed", "https://example.com:8443/feed"],
  ])("uses HTTPS for a website address without a protocol: %s", (input, expected) => {
    expect(feedSourceUrl("rss", input)).toBe(expected);
  });

  it("turns Telegram and X handles into discoverable source URLs", () => {
    expect(feedSourceUrl("telegram", "Example_Channel")).toBe("https://t.me/Example_Channel");
    expect(feedSourceUrl("telegram", "@Example_Channel")).toBe("https://t.me/Example_Channel");
    expect(feedSourceUrl("x", "banteg")).toBe("https://x.com/banteg");
    expect(feedSourceUrl("x", "@banteg")).toBe("https://x.com/banteg");
  });

  it("rejects profile URLs where the form requires a handle", () => {
    expect(() => feedSourceUrl("youtube", "https://www.youtube.com/@kurzgesagt")).toThrow(
      "Enter a YouTube channel handle",
    );
    expect(() => feedSourceUrl("telegram", "https://t.me/example")).toThrow(
      "Enter a Telegram handle",
    );
    expect(() => feedSourceUrl("x", "https://x.com/banteg")).toThrow("Enter an X handle");
  });
});
