import type { FeedErrorKind } from "../../../../shared/types.js";

export class WebFeedError extends Error {
  constructor(
    message: string,
    readonly kind: FeedErrorKind,
    readonly httpStatus: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WebFeedError";
  }
}
