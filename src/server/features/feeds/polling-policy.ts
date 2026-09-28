import type Sqlite from "better-sqlite3";
import type { PublisherHints } from "../shared.js";

const HOUR_MS = 3_600_000;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NEVER = Date.parse("9999-12-31T23:59:59.999Z");

export class FeedRequestDeferred extends Error {
  constructor(readonly until: number) {
    super(`The publisher has requested no polling before ${new Date(until).toISOString()}.`);
    this.name = "FeedRequestDeferred";
  }
}

export interface FeedRequestPolicy {
  beforeRequest(url: string): void;
  afterResponse(url: string, status: number, retryAfter: string | null): void;
}

export function retryAfterDeadline(value: string | null, receivedAt: number): number | null {
  if (value === null) return null;
  const header = value.trim();
  let deadline: number;
  if (/^\d+$/.test(header)) {
    deadline = receivedAt + Number(header) * 1_000;
  } else {
    // Accept the three HTTP-date forms, without Date.parse's permissive numeric dates.
    const day = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)";
    const month = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
    const time = "[0-2]\\d:[0-5]\\d:[0-5]\\d";
    const httpDate = new RegExp(
      `^(?:${day}, \\d{2} ${month} \\d{4} ${time} GMT|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \\d{2}-${month}-\\d{2} ${time} GMT|${day} ${month} [ \\d]\\d ${time} \\d{4})$`,
    );
    if (!httpDate.test(header)) return null;
    deadline = Date.parse(header);
  }
  return Number.isFinite(deadline) && deadline <= NEVER ? Math.max(receivedAt, deadline) : null;
}

export function allowedPollingTime(earliest: number, hints: PublisherHints): number {
  let candidate = earliest;
  // RSS has a weekly repeating schedule. No allowed hour in a week means no polling window.
  for (let hour = 0; hour <= 7 * 24; hour += 1) {
    const date = new Date(candidate);
    if (
      !hints.skipHours?.includes(date.getUTCHours()) &&
      !hints.skipDays?.includes(DAYS[date.getUTCDay()] as string)
    )
      return candidate;
    candidate = (Math.floor(candidate / HOUR_MS) + 1) * HOUR_MS;
  }
  return NEVER;
}

export class FeedPollingPolicy {
  constructor(private readonly sqlite: Sqlite.Database) {}

  nextPollAt(sourceId: number, earliest: number, origin?: string | null): number {
    const source = this.sqlite
      .prepare(`SELECT publisher_hints AS hints,
      publisher_not_before AS notBefore, request_origin AS origin
      FROM feed_sources WHERE id = ?`)
      .get(sourceId) as {
      hints: string;
      notBefore: string | null;
      origin: string | null;
    };
    const requestedOrigin = origin === undefined ? source.origin : origin;
    const cooldown = requestedOrigin
      ? (this.sqlite
          .prepare(`SELECT MAX(retry_after_at) FROM (
            SELECT retry_after_at FROM feed_origin_cooldowns WHERE origin = ?
            UNION ALL
            SELECT retry_after_at FROM feed_source_cooldowns WHERE origin = ? AND source_id = ?
          )`)
          .pluck()
          .get(requestedOrigin, requestedOrigin, sourceId) as string | null)
      : undefined;
    return allowedPollingTime(
      Math.max(
        earliest,
        source.notBefore ? Date.parse(source.notBefore) : 0,
        cooldown ? Date.parse(cooldown) : 0,
      ),
      JSON.parse(source.hints) as PublisherHints,
    );
  }

  assertAllowed(sourceId: number, url?: string): void {
    const now = Date.now();
    const next = this.nextPollAt(sourceId, now, url ? new URL(url).origin : null);
    if (next > now) throw new FeedRequestDeferred(next);
  }

  forSource(sourceId: number): FeedRequestPolicy {
    return {
      beforeRequest: (url) => {
        this.assertAllowed(sourceId, url);
        this.sqlite
          .prepare("UPDATE feed_sources SET request_origin = ?, last_attempt_at = ? WHERE id = ?")
          .run(new URL(url).origin, new Date().toISOString(), sourceId);
      },
      afterResponse: (url, status, retryAfter) => {
        if (status !== 429 && status !== 503) return;
        const deadline = retryAfterDeadline(retryAfter, Date.now());
        if (deadline === null) return;
        const until = new Date(deadline).toISOString();
        if (status === 429) {
          // Conservative Feedfold policy: 429 pauses the actual origin across all accounts.
          this.sqlite
            .prepare(`INSERT INTO feed_origin_cooldowns (origin, retry_after_at) VALUES (?, ?)
            ON CONFLICT(origin) DO UPDATE SET retry_after_at = MAX(retry_after_at, excluded.retry_after_at)`)
            .run(new URL(url).origin, until);
        } else {
          this.sqlite
            .prepare(`INSERT INTO feed_source_cooldowns (source_id, origin, retry_after_at)
            SELECT id, ?, ? FROM feed_sources WHERE id = ?
            ON CONFLICT(source_id, origin) DO UPDATE SET retry_after_at = MAX(retry_after_at, excluded.retry_after_at)`)
            .run(new URL(url).origin, until, sourceId);
        }
      },
    };
  }

  finishAttempt(sourceId: number, completed: number): void {
    const hints = JSON.parse(
      this.sqlite
        .prepare("SELECT publisher_hints FROM feed_sources WHERE id = ?")
        .pluck()
        .get(sourceId) as string,
    ) as PublisherHints;
    const deadline = hints.ttl && hints.ttl > 0 ? completed + hints.ttl * 60_000 : null;
    const notBefore =
      deadline !== null && Number.isFinite(deadline) && deadline <= NEVER
        ? new Date(deadline).toISOString()
        : null;
    this.sqlite
      .prepare("UPDATE feed_sources SET publisher_not_before = ? WHERE id = ?")
      .run(notBefore, sourceId);
  }

  defer(sourceId: number, until: number): void {
    const next = this.nextPollAt(sourceId, until);
    this.sqlite
      .prepare(`UPDATE feed_sources SET refreshing = 0,
      next_poll_at = MAX(COALESCE(next_poll_at, ''), ?) WHERE id = ?`)
      .run(new Date(next).toISOString(), sourceId);
  }
}
