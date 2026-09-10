import {
  FEED_POLL_INTERVAL_MINUTES,
  type FeedPollIntervalMinutes,
  normalizeFeedPollInterval,
} from "../../../shared/types.js";

const ACTIVITY_RATE_ALPHA = 0.5;
const MINUTES_PER_HOUR = 60;

export interface FeedScheduleState {
  pollIntervalMinutes: FeedPollIntervalMinutes;
  activityRatePerHour: number | null;
  lastScheduledObservationAt: string | null;
}

export function observeScheduledRefresh(
  state: FeedScheduleState,
  observation: { completedAt: string; insertedArticleCount: number },
): FeedScheduleState {
  if (state.lastScheduledObservationAt === null) {
    return { ...state, lastScheduledObservationAt: observation.completedAt };
  }

  const elapsedHours =
    (Date.parse(observation.completedAt) - Date.parse(state.lastScheduledObservationAt)) /
    3_600_000;
  if (elapsedHours <= 0) {
    return { ...state, lastScheduledObservationAt: observation.completedAt };
  }

  const sampleRate = observation.insertedArticleCount / elapsedHours;
  const activityRatePerHour =
    state.activityRatePerHour === null
      ? sampleRate
      : sampleRate > state.activityRatePerHour
        ? sampleRate
        : ACTIVITY_RATE_ALPHA * sampleRate + (1 - ACTIVITY_RATE_ALPHA) * state.activityRatePerHour;
  const desiredInterval = activityRatePerHour <= 0 ? 60 : MINUTES_PER_HOUR / activityRatePerHour;
  const targetInterval = normalizeFeedPollInterval(desiredInterval);
  const pollIntervalMinutes =
    targetInterval > state.pollIntervalMinutes
      ? (FEED_POLL_INTERVAL_MINUTES.find((interval) => interval > state.pollIntervalMinutes) ??
        targetInterval)
      : targetInterval;

  return {
    pollIntervalMinutes,
    activityRatePerHour,
    lastScheduledObservationAt: observation.completedAt,
  };
}
