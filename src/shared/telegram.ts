const TELEGRAM_HOST = "t.me";
const CHANNEL_NAME = /^[a-zA-Z0-9_]{5,32}$/;
const POST_ID = /^\d+$/;

export interface TelegramPostIdentity {
  channel: string;
  postId: string;
}

export function telegramUrlPath(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname !== TELEGRAM_HOST) return null;
    return url.pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
}

export function telegramPostIdentity(value: string | null): TelegramPostIdentity | null {
  const path = telegramUrlPath(value);
  const channel = path?.[0];
  const postId = path?.[1];
  if (
    path?.length !== 2 ||
    !channel ||
    !postId ||
    !CHANNEL_NAME.test(channel) ||
    !POST_ID.test(postId)
  ) {
    return null;
  }
  return { channel, postId };
}
