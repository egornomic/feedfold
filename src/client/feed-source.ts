export type AddFeedSourceType = "rss" | "youtube" | "telegram" | "x";

export const TELEGRAM_HANDLE_PATTERN = "@?[A-Za-z0-9_]{5,32}";
export const X_HANDLE_PATTERN = "@?[A-Za-z0-9_]{1,15}";
export const YOUTUBE_HANDLE_PATTERN = "@?[^\\s\\/@?#]+";

const telegramHandle = new RegExp(`^${TELEGRAM_HANDLE_PATTERN}$`);
const xHandle = new RegExp(`^${X_HANDLE_PATTERN}$`);
const youtubeHandle = new RegExp(`^${YOUTUBE_HANDLE_PATTERN}$`);

export function feedSourceUrl(sourceType: AddFeedSourceType, input: string): string {
  const value = input.trim();
  const handle = value.replace(/^@/, "");

  if (sourceType === "youtube") {
    if (!youtubeHandle.test(value)) {
      throw new Error("Enter a YouTube channel handle, such as @kurzgesagt, rather than a link.");
    }
    return `https://www.youtube.com/@${encodeURIComponent(handle)}`;
  }

  if (sourceType === "telegram") {
    if (!telegramHandle.test(value)) {
      throw new Error("Enter a Telegram handle with 5–32 letters, numbers, or underscores.");
    }
    return `https://t.me/${handle}`;
  }

  if (sourceType === "x") {
    if (!xHandle.test(value)) {
      throw new Error("Enter an X handle with 1–15 letters, numbers, or underscores.");
    }
    return `https://x.com/${handle}`;
  }

  return /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}
