import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  finishOnboarding,
  nextOnboardingStep,
  type OnboardingStep,
  onboardingStep,
  previousOnboardingStep,
  saveOnboardingStep,
} from "../../src/client/features/auth/onboarding-state.js";
import { exposeBrowserGlobals } from "./react-harness.js";

describe("onboarding source selection", () => {
  it("keeps setup progress separate for each account and clears it when finished", () => {
    const browser = new JSDOM("", { url: "https://feedfold.test" });
    const restore = exposeBrowserGlobals(browser.window);
    try {
      expect(onboardingStep("new-reader")).toBeNull();
      saveOnboardingStep("new-reader", "feeds");
      saveOnboardingStep("other-reader", "x");
      expect(onboardingStep("new-reader")).toBe("feeds");
      saveOnboardingStep("new-reader", "youtube");
      expect(onboardingStep("new-reader")).toBe("youtube");
      saveOnboardingStep("new-reader", "youtube-manual");
      expect(onboardingStep("new-reader")).toBe("youtube-manual");
      finishOnboarding("new-reader");
      expect(onboardingStep("new-reader")).toBeNull();
      expect(onboardingStep("other-reader")).toBe("x");
    } finally {
      restore();
      browser.window.close();
    }
  });

  it("continues through the main steps without opening manual channel selection", () => {
    const visited: OnboardingStep[] = [];
    let step: OnboardingStep | null = "feeds";
    while (step) {
      visited.push(step);
      step = nextOnboardingStep(step);
    }
    expect(visited).toEqual(["feeds", "youtube", "x"]);
    for (let index = visited.length - 1; index > 0; index--) {
      expect(previousOnboardingStep(visited[index] as OnboardingStep)).toBe(visited[index - 1]);
    }
  });

  it("lets manual channel selection continue to X or go back to the YouTube choices", () => {
    expect(nextOnboardingStep("youtube-manual")).toBe("x");
    expect(previousOnboardingStep("youtube-manual")).toBe("youtube");
  });

  it("returns to the YouTube choices after skipping YouTube", () => {
    const next = nextOnboardingStep("youtube");
    expect(next).toBe("x");
    expect(previousOnboardingStep(next as OnboardingStep)).toBe("youtube");
  });
});
