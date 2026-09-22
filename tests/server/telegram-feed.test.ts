import { describe, expect, it } from "vitest";
import {
  parseAndNormalizeTelegramFeed,
  parseTelegramPostMedia,
  telegramChannelUrls,
} from "../../src/server/telegram-feed.js";
import { telegramPostIdentity } from "../../src/shared/telegram.js";

describe("Telegram feed normalization", () => {
  it("recognizes public channel and post URLs without treating other paths as feeds", () => {
    const urls = {
      channelUrl: "https://t.me/Example_Channel",
      previewUrl: "https://t.me/s/Example_Channel",
    };

    expect(telegramChannelUrls("http://t.me/Example_Channel/?ref=feed")).toEqual(urls);
    expect(telegramChannelUrls("https://t.me/s/Example_Channel")).toEqual(urls);
    expect(telegramChannelUrls("https://t.me/Example_Channel/42")).toBeNull();
    expect(telegramChannelUrls("https://t.me/share/url")).toBeNull();
    expect(telegramChannelUrls("https://example.com/Example_Channel")).toBeNull();
    expect(telegramPostIdentity("https://t.me/Example_Channel/42?single")).toEqual({
      channel: "Example_Channel",
      postId: "42",
    });
    expect(telegramPostIdentity("https://t.me/Example_Channel")).toBeNull();
    expect(telegramPostIdentity("https://t.me/s/Example_Channel")).toBeNull();
  });

  it("normalizes text, links, timestamps, and media-only posts", () => {
    const feed = parseAndNormalizeTelegramFeed(
      `<!doctype html><html><body>
        <div class="tgme_channel_info_header_title">Example &amp; Channel</div>
        <div class="tgme_widget_message js-widget_message" data-post="Example_Channel/42">
          <div class="tgme_widget_message_text js-message_text">
            <b>First update</b><br>Second line with <a href="https://example.test/story">a link</a>.
          </div>
          <a class="tgme_widget_message_photo_wrap"
            style="background-image: url('/images/first.jpg')"></a>
          <a class="tgme_widget_message_date" href="https://t.me/Example_Channel/42">
            <time datetime="2026-07-17T10:30:00+00:00">10:30</time>
          </a>
        </div>
        <div class="tgme_widget_message js-widget_message" data-post="Example_Channel/43">
          <a class="tgme_widget_message_photo_wrap"
            style='background-image: url("https://cdn.example.test/second.jpg")'></a>
          <time datetime="2026-07-17T11:45:00+00:00">11:45</time>
        </div>
        <div class="tgme_widget_message js-widget_message" data-post="Other_Channel/99">
          <div class="js-message_text">Forwarded post</div>
        </div>
      </body></html>`,
      "https://t.me/Example_Channel",
    );

    expect(feed).toMatchObject({
      title: "Example & Channel",
      siteUrl: "https://t.me/Example_Channel",
      articles: [
        {
          externalId: "Example_Channel/43",
          title: "",
          url: "https://t.me/Example_Channel/43",
          publishedAt: "2026-07-17T11:45:00.000Z",
          summary: "",
          imageUrl: "https://cdn.example.test/second.jpg",
        },
        {
          externalId: "Example_Channel/42",
          title: "",
          url: "https://t.me/Example_Channel/42",
          author: "Example & Channel",
          publishedAt: "2026-07-17T10:30:00.000Z",
          summary: "First update Second line with a link.",
          imageUrl: "https://t.me/images/first.jpg",
        },
      ],
    });
    expect(feed.articles).toHaveLength(2);
    expect(feed.articles[0]?.feedContentHtml).toContain("View this post on Telegram");
    expect(feed.articles[1]?.feedContentHtml).toContain("<b>First update</b><br>");
    expect(feed.articles[1]?.feedContentHtml).toContain('href="https://example.test/story"');
    expect(feed.articles[0]?.feedContentHtml).not.toContain("<img");
    expect(feed.articles[1]?.feedContentHtml).not.toContain("<img");
  });

  it("extracts current image and video sources from a Telegram post embed", () => {
    const media = parseTelegramPostMedia(
      `<!doctype html><html><body>
        <div class="tgme_widget_message" data-post="Example_Channel/42">
          <a class="tgme_widget_message_photo_wrap"
            style="background-image:url('/images/photo.jpg')"></a>
          <a class="tgme_widget_message_video_player" data-ratio="0.5625">
            <i class="tgme_widget_message_video_thumb"
              style="background-image:url('https://cdn.example.test/poster.jpg')"></i>
            <video src="https://cdn.example.test/video.mp4?token=current"></video>
          </a>
        </div>
      </body></html>`,
      "https://t.me/Example_Channel/42",
    );

    expect(media).toEqual([
      {
        kind: "image",
        url: "https://t.me/images/photo.jpg",
        posterUrl: null,
        aspectRatio: null,
      },
      {
        kind: "video",
        url: "https://cdn.example.test/video.mp4?token=current",
        posterUrl: "https://cdn.example.test/poster.jpg",
        aspectRatio: 0.5625,
      },
    ]);
  });
});
