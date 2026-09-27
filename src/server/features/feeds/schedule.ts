import type Sqlite from "better-sqlite3";
import type { FeedPollIntervalMinutes } from "../../../shared/types.js";

const MINUTE_MS = 60_000;
const POSTING_GAP_LIMIT = 10;

function intervalForPostingGap(gapMinutes: number): FeedPollIntervalMinutes {
  if (gapMinutes < 30) return 5;
  if (gapMinutes < 120) return 10;
  if (gapMinutes < 1_440) return 30;
  if (gapMinutes < 4_320) return 180;
  if (gapMinutes < 10_080) return 360;
  return 720;
}

export function pollIntervalForPosts(
  postedAt: readonly string[],
  currentInterval: FeedPollIntervalMinutes,
  completedAt: string,
): FeedPollIntervalMinutes {
  const completed = Date.parse(completedAt);
  const times = [...new Set(postedAt.map((timestamp) => Date.parse(timestamp)))]
    .filter((timestamp) => timestamp <= completed)
    .sort((left, right) => right - left)
    .slice(0, POSTING_GAP_LIMIT + 1);
  const latest = times[0];
  if (latest === undefined) return currentInterval;

  const silenceMinutes = (completed - latest) / MINUTE_MS;
  if (times.length === 1) {
    return Math.max(
      currentInterval,
      intervalForPostingGap(silenceMinutes / 2),
    ) as FeedPollIntervalMinutes;
  }

  const oldest = times.at(-1) ?? latest;
  const averageGapMinutes = (latest - oldest) / (times.length - 1) / MINUTE_MS;
  // Empty checks only slow a feed after silence exceeds twice its usual posting gap.
  return intervalForPostingGap(Math.max(averageGapMinutes, silenceMinutes / 2));
}

export function sourcePollInterval(
  database: Sqlite.Database,
  sourceId: number,
  currentInterval: FeedPollIntervalMinutes,
  completedAt: string,
): FeedPollIntervalMinutes {
  const postedAt = database
    .prepare(
      `SELECT DISTINCT schedule_posted_at FROM articles
       WHERE source_id = ? AND schedule_posted_at <= ?
       ORDER BY schedule_posted_at DESC LIMIT ?`,
    )
    .pluck()
    .all(sourceId, completedAt, POSTING_GAP_LIMIT + 1) as string[];
  return pollIntervalForPosts(postedAt, currentInterval, completedAt);
}
