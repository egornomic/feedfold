export const WEB_FEED_SELECT_MESSAGE = "feedfold:web-feed-select";
export const WEB_FEED_HIGHLIGHT_MESSAGE = "feedfold:web-feed-highlight";

export type WebFeedSelectionAction = { kind: "select"; candidateId: string | null };

export interface WebFeedHighlightMessage {
  type: typeof WEB_FEED_HIGHLIGHT_MESSAGE;
  messageToken: string;
  candidateId: string | null;
}

export function parseWebFeedSelectionMessage(
  value: unknown,
  messageToken: string,
  candidateIds: ReadonlySet<string>,
): WebFeedSelectionAction | null {
  if (!value || typeof value !== "object") return null;

  const message = value as Record<string, unknown>;
  if (message.type !== WEB_FEED_SELECT_MESSAGE || message.messageToken !== messageToken) {
    return null;
  }

  if (message.candidateId === null) return { kind: "select", candidateId: null };
  if (typeof message.candidateId !== "string" || !candidateIds.has(message.candidateId)) {
    return null;
  }

  return { kind: "select", candidateId: message.candidateId };
}

export function webFeedHighlightMessage(
  messageToken: string,
  candidateId: string | null,
): WebFeedHighlightMessage {
  return {
    type: WEB_FEED_HIGHLIGHT_MESSAGE,
    messageToken,
    candidateId,
  };
}
