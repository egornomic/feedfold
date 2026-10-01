import { describe, expect, it } from "vitest";
import { thumbnailUrl } from "../../src/shared/thumbnail.js";

describe("thumbnail downloads", () => {
  it("requests enough Substack image detail for a Retina crop", () => {
    const original =
      "https://substackcdn.com/image/fetch/$s_!0djL!,w_1456,c_limit,f_auto,q_auto:good/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fphoto_2300x1380.png";
    expect(thumbnailUrl(original)).toBe(original.replace("w_1456", "w_400"));
    const wide = original.replace("2300x1380", "1200x400");
    expect(thumbnailUrl(wide)).toBe(wide.replace("w_1456", "w_720"));
    const short = original.replace("2300x1380", "941x32");
    expect(thumbnailUrl(short)).toBe(short);
    const alreadySmall = original.replace("w_1456", "w_300");
    expect(thumbnailUrl(alreadySmall)).toBe(alreadySmall);
  });

  it.each([
    ["https://miro.medium.com/max/2500/photo.png", "https://miro.medium.com/max/480/photo.png"],
    [
      "https://cdn-images-1.medium.com/max/975/photo.png",
      "https://cdn-images-1.medium.com/max/480/photo.png",
    ],
    [
      "https://ourworldindata.org/cdn-cgi/imagedelivery/account/photo/w=1024",
      "https://ourworldindata.org/cdn-cgi/imagedelivery/account/photo/w=480",
    ],
  ])("uses the existing image host's smaller version of %s", (original, expected) => {
    expect(thumbnailUrl(original)).toBe(expected);
  });

  it("leaves ordinary images, application resources, and already small images intact", () => {
    for (const original of [
      "https://example.com/max/2000/photo.jpg",
      "/api/articles/1/telegram-media-preview",
      "https://miro.medium.com/max/320/photo.png",
      "https://ourworldindata.org/cdn-cgi/imagedelivery/account/photo/w=320",
      "https://i1.ytimg.com/vi/pi0YVKWkqOM/hqdefault.jpg",
    ]) {
      expect(thumbnailUrl(original)).toBe(original);
    }
  });
});
