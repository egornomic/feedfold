import { SqliteError } from "better-sqlite3";
import { ZodError } from "zod";
import { AiError } from "./ai/errors.js";
import { ApplicationApiError, InvalidRequestError, OperationForbiddenError } from "./errors.js";
import { FeedDiscoveryError } from "./feed-discovery.js";
import { QuotaExceededError } from "./quota.js";
import { WebFeedError } from "./web-feed-error.js";

export interface ApplicationErrorResponse {
  status: number;
  message: string;
  code: string | null;
}

/** Returns only errors that are safe to present to the reader. */
export function applicationError(error: unknown): ApplicationErrorResponse | null {
  if (error instanceof ApplicationApiError) {
    return { status: error.status, message: error.message, code: error.code };
  }
  if (error instanceof AiError || error instanceof QuotaExceededError) {
    return { status: error.statusCode, message: error.message, code: error.code };
  }
  if (error instanceof WebFeedError || error instanceof FeedDiscoveryError) {
    return { status: 422, message: error.message, code: error.kind };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      message: error.issues[0]?.message ?? "The request is invalid.",
      code: null,
    };
  }
  if (error instanceof InvalidRequestError || error instanceof OperationForbiddenError) {
    return {
      status: error instanceof OperationForbiddenError ? error.statusCode : 400,
      message: error.message,
      code: null,
    };
  }
  if (error instanceof SqliteError) {
    if (error.code === "SQLITE_FULL") {
      return {
        status: 507,
        message: "This feedfold server has reached its storage limit.",
        code: "quota_exceeded",
      };
    }
    if (
      error.code === "SQLITE_CONSTRAINT_UNIQUE" ||
      error.code === "SQLITE_CONSTRAINT_PRIMARYKEY"
    ) {
      return { status: 409, message: "This item already exists.", code: null };
    }
    if (error.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      return {
        status: 400,
        message: "That feed or folder no longer exists. Reload and try again.",
        code: null,
      };
    }
  }
  return null;
}
