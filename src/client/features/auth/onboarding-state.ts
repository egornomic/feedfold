import type { RuleInput } from "../../api/api-contract.js";

export type OnboardingStep = "feeds" | "youtube" | "youtube-manual" | "x";

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  if (step === "feeds") return "youtube";
  return step === "x" ? null : "x";
}

export function previousOnboardingStep(step: OnboardingStep): OnboardingStep {
  if (step === "youtube-manual" || step === "x") return "youtube";
  return "feeds";
}

const storageKey = (userId: string) => `feedfold:onboarding:${userId}`;

export function onboardingStep(userId: string): OnboardingStep | null {
  const step = window.sessionStorage.getItem(storageKey(userId));
  return step === "feeds" || step === "youtube" || step === "youtube-manual" || step === "x"
    ? step
    : null;
}

export function saveOnboardingStep(userId: string, step: OnboardingStep): void {
  window.sessionStorage.setItem(storageKey(userId), step);
}

export function finishOnboarding(userId: string): void {
  window.sessionStorage.removeItem(storageKey(userId));
}

export const HIDE_SHORTS_RULE = {
  name: "Hide YouTube Shorts",
  conditions: [{ field: "media", pattern: "youtube short" }],
  conditionOperator: "and",
  action: "hide",
  enabled: true,
} satisfies RuleInput;
