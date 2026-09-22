import type { WebFeedCandidate } from "../../../shared/types.js";

export function groupWebFeedCandidates(
  candidates: WebFeedCandidate[],
  suggestedCandidateIds: string[],
): { suggested: WebFeedCandidate[]; other: WebFeedCandidate[] } {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const suggested = suggestedCandidateIds
    .map((candidateId) => candidatesById.get(candidateId))
    .filter((candidate): candidate is WebFeedCandidate => candidate !== undefined);
  const suggestedIds = new Set(suggested.map((candidate) => candidate.id));
  return {
    suggested,
    other: candidates.filter((candidate) => !suggestedIds.has(candidate.id)),
  };
}
