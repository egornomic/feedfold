import {
  ArrowLeft,
  ArrowRight,
  Check,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Rss,
  Upload,
} from "lucide-react";
import { type ChangeEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Feed, ImportResult, Rule, SessionUser } from "../../../shared/types";
import { xFeedUrl } from "../../../shared/x";
import type { YouTubeStatus } from "../../../shared/youtube";
import { api, appUrl, errorMessage } from "../../api/api";
import { httpRequest } from "../../api/http-request";
import { BrandIdentity } from "../../ui/brand";
import { feedSourceUrl } from "../feeds/feed-source";
import {
  HIDE_SHORTS_RULE,
  nextOnboardingStep,
  type OnboardingStep,
  onboardingStep,
  previousOnboardingStep,
  saveOnboardingStep,
} from "./onboarding-state";
import "./onboarding.css";

const suggestions = {
  feeds: [
    {
      title: "Hacker News",
      description: "Technology, ideas, and independent projects",
      url: "https://hnrss.org/frontpage",
      mark: "Y",
    },
    {
      title: "Ars Technica",
      description: "A closer look at science and technology",
      url: "https://feeds.arstechnica.com/arstechnica/index",
      mark: "ars",
    },
    {
      title: "NASA",
      description: "Discoveries from Earth to deep space",
      url: "https://www.nasa.gov/feed/",
      mark: "N",
    },
  ],
  youtube: [
    {
      title: "Veritasium",
      description: "Science, experiments, and surprising discoveries",
      url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA",
      mark: "V",
    },
    {
      title: "Kurzgesagt",
      description: "Animated explanations of science and the universe",
      url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCsXVk37bltHxD1rDPwtNM8Q",
      mark: "K",
    },
    {
      title: "NASA",
      description: "Space missions and discoveries, straight from NASA",
      url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCLA_DiR1FfKNvjuUpBHmylQ",
      mark: "N",
    },
  ],
  x: [
    {
      title: "NASA",
      description: "@NASA · Space, exploration, and discovery",
      url: "https://x.com/NASA",
      mark: "N",
    },
    {
      title: "The Verge",
      description: "@verge · Technology and culture",
      url: "https://x.com/verge",
      mark: "V",
    },
    {
      title: "GitHub",
      description: "@github · Open source and developer news",
      url: "https://x.com/github",
      mark: "GH",
    },
  ],
};

const headings = {
  feeds: [
    "What would you like to read?",
    "Bring your subscriptions, add a favorite, or try something new.",
  ],
  youtube: ["Sync YouTube subscriptions", "Bring the channels you follow into your reading queue."],
  "youtube-manual": [
    "Add YouTube channels",
    "Choose channels to follow. No YouTube connection needed.",
  ],
  x: ["Follow accounts on X", "Keep up with public posts in the same quiet queue."],
};

const isShortsRule = (rule: Rule) =>
  rule.action === "hide" &&
  rule.feedId === null &&
  rule.folderId === null &&
  rule.conditions.length === 1 &&
  rule.conditions[0]?.field === "media" &&
  rule.conditions[0].pattern === "youtube short";

export function Onboarding({ user, onFinish }: { user: SessionUser; onFinish: () => void }) {
  const [step, setStep] = useState<OnboardingStep>(() => onboardingStep(user.id) ?? "feeds");
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [youtube, setYoutube] = useState<YouTubeStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [savingShorts, setSavingShorts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [addresses, setAddresses] = useState({ feeds: "", "youtube-manual": "", x: "" });
  const defaultShortsRule = useRef<Promise<Rule> | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const headers = { "X-Feedfold-Account": user.id };

  const load = useCallback(async () => {
    setError(null);
    try {
      const [data, savedRules, status] = await Promise.all([
        api.bootstrap(),
        api.rules(),
        httpRequest<YouTubeStatus>("/api/youtube", { headers: { "X-Feedfold-Account": user.id } }),
      ]);
      setFeeds(data.feeds);
      if (!savedRules.some(isShortsRule)) {
        defaultShortsRule.current ??= api.createRule(HIDE_SHORTS_RULE).catch((caught) => {
          defaultShortsRule.current = null;
          throw caught;
        });
        savedRules.push(await defaultShortsRule.current);
      }
      setRules(savedRules);
      setYoutube(status);
      setLoaded(true);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [user.id]);

  useEffect(() => {
    void load();
    const result = new URLSearchParams(window.location.search).get("youtube");
    if (result) {
      setNotice(
        result === "connected"
          ? "YouTube connected. Your subscriptions are synced."
          : result === "cancelled"
            ? "Connection cancelled. You can try again or skip this step."
            : "YouTube could not connect. Try again or skip this step.",
      );
      window.history.replaceState(null, "", appUrl("/"));
    }
  }, [load]);

  useLayoutEffect(() => {
    void step;
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const steps: OnboardingStep[] = ["feeds", "youtube", "x"];
  const progressStep = step === "youtube-manual" ? "youtube" : step;
  const position = steps.indexOf(progressStep);
  const isYouTubeStep = progressStep === "youtube";
  const shortsRule = rules.find(isShortsRule);
  const added = (url: string) =>
    feeds.find(
      (feed) =>
        feed.feedUrl === url ||
        (xFeedUrl(url) !== null &&
          xFeedUrl(feed.feedUrl)?.toLowerCase() === xFeedUrl(url)?.toLowerCase()),
    );

  const go = (next: OnboardingStep, direction: "forward" | "backward" = "forward") => {
    saveOnboardingStep(user.id, next);
    setDirection(direction);
    setStep(next);
    setNotice("");
    setError(null);
  };

  const add = async (address: string) => {
    setBusy(address);
    setError(null);
    setNotice("");
    try {
      const sourceType =
        step === "x" && !address.includes("://")
          ? "x"
          : step === "youtube-manual" && !address.includes("/")
            ? "youtube"
            : "rss";
      const url = feedSourceUrl(sourceType, address);
      if (step === "x" && !xFeedUrl(url))
        throw new Error("Enter a public X profile URL or an @handle.");
      const result = await api.discoverFeed(url);
      if (result.kind !== "published")
        throw new Error(
          "No published feed found. Try another website or a direct RSS link. You can set up feeds without RSS in the reader later.",
        );
      if (added(result.preview.feedUrl)) {
        setNotice(`${result.preview.title} is already added.`);
        return;
      }
      const feed = await api.createFeed({
        sourceKind: "published",
        title: result.preview.title,
        feedUrl: result.preview.feedUrl,
        siteUrl: result.preview.siteUrl,
      });
      setFeeds((current) => [...current, feed]);
      setNotice(`${feed.title} added.`);
      if (step !== "youtube") setAddresses((current) => ({ ...current, [step]: "" }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("import");
    setError(null);
    setNotice("");
    try {
      const result = await api.importOpml(file);
      setImportResult(result);
      setNotice(
        `${result.imported} imported · ${result.duplicates} already added${result.failed.length ? ` · ${result.failed.length} failed` : ""}`,
      );
      setFeeds((await api.bootstrap()).feeds);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const toggleSuggestion = async (url: string) => {
    const feed = added(url);
    if (!feed) return add(url);
    setBusy(url);
    setError(null);
    setNotice("");
    try {
      await api.deleteFeed(feed.id);
      setFeeds((current) => current.filter((item) => item.id !== feed.id));
      setNotice(`${feed.title} removed.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const toggleShorts = async () => {
    setSavingShorts(true);
    setError(null);
    try {
      const rule = shortsRule
        ? await api.updateRule(shortsRule.id, { enabled: !shortsRule.enabled })
        : await api.createRule(HIDE_SHORTS_RULE);
      setRules((current) => [...current.filter((item) => item.id !== rule.id), rule]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingShorts(false);
    }
  };

  const connect = async () => {
    setBusy("youtube");
    setError(null);
    try {
      const { url } = await httpRequest<{ url: string }>("/api/youtube/connect", {
        method: "POST",
        headers,
      });
      window.location.assign(url);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(null);
    }
  };

  return (
    <div className="onboarding">
      <div className="login-topbar">
        <BrandIdentity className="login-brand" />
        <span className="onboarding-progress">
          <span className="sr-only">Setup step </span>
          {position + 1} of 3
        </span>
      </div>
      <div className="onboarding-content">
        <div className="onboarding-stage" data-direction={direction} key={step}>
          <header className="login-heading">
            <h2 id="auth-heading" ref={headingRef} tabIndex={-1}>
              {headings[step][0]}
            </h2>
            <p>{headings[step][1]}</p>
          </header>
          {step === "youtube" ? (
            <>
              {youtube?.available ? (
                <div className="onboarding-connection">
                  <RefreshCw size={32} strokeWidth={1.5} aria-hidden="true" />
                  <div>
                    <strong>
                      {youtube?.connected
                        ? (youtube.channelTitle ?? "YouTube connected")
                        : "Sync all your subscriptions"}
                    </strong>
                    <p>
                      {youtube?.connected
                        ? `${youtube.feedCount} channels synced`
                        : "Updates daily with read-only access."}
                    </p>
                  </div>
                </div>
              ) : loaded ? (
                <p className="onboarding-note">
                  YouTube sync is unavailable here. You can still add channels manually.
                </p>
              ) : null}
              {youtube?.available && !youtube.connected ? (
                <button
                  className="primary-button onboarding-connect"
                  type="button"
                  disabled={!!busy || !loaded}
                  onClick={() => void connect()}
                >
                  {busy === "youtube" ? (
                    <LoaderCircle className="spin" size={16} aria-hidden="true" />
                  ) : (
                    <Link2 size={16} aria-hidden="true" />
                  )}
                  Connect YouTube
                </button>
              ) : null}
              <button
                className="secondary-button onboarding-connect"
                type="button"
                disabled={!!busy || !loaded}
                onClick={() => go("youtube-manual")}
              >
                <Plus size={16} aria-hidden="true" />
                Add channels manually
              </button>
              {youtube?.error ? (
                <p className="login-error" role="alert">
                  {youtube.error}
                </p>
              ) : null}
            </>
          ) : (
            <>
              {step === "feeds" ? (
                <div className="onboarding-import">
                  <div>
                    <strong>Already use a feed reader?</strong>
                    <p>Import an OPML file. Your folders come with it.</p>
                  </div>
                  <input
                    ref={fileRef}
                    hidden
                    type="file"
                    accept=".opml,.xml,text/xml,application/xml"
                    onChange={(event) => void importFile(event)}
                  />
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!!busy || !loaded}
                    onClick={() => fileRef.current?.click()}
                  >
                    {busy === "import" ? (
                      <LoaderCircle className="spin" size={16} aria-hidden="true" />
                    ) : (
                      <Upload size={16} aria-hidden="true" />
                    )}
                    Import OPML
                  </button>
                </div>
              ) : null}
              <form
                className="onboarding-address"
                onSubmit={(event) => {
                  event.preventDefault();
                  void add(addresses[step]);
                }}
              >
                <label className="login-field">
                  <span>
                    {step === "feeds"
                      ? "Website or feed URL"
                      : step === "youtube-manual"
                        ? "YouTube channel URL or handle"
                        : "X profile URL or handle"}
                  </span>
                  <input
                    type="text"
                    inputMode={step === "feeds" ? "url" : "text"}
                    enterKeyHint="go"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={
                      step === "feeds"
                        ? "example.com"
                        : step === "youtube-manual"
                          ? "@channel"
                          : "@username"
                    }
                    value={addresses[step]}
                    onChange={(event) =>
                      setAddresses((current) => ({ ...current, [step]: event.target.value }))
                    }
                  />
                </label>
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={!!busy || !loaded || !addresses[step].trim()}
                >
                  {busy === addresses[step] ? (
                    <LoaderCircle className="spin" size={16} aria-hidden="true" />
                  ) : (
                    <Plus size={16} aria-hidden="true" />
                  )}
                  Add
                </button>
              </form>
            </>
          )}
          {isYouTubeStep ? (
            <label className="onboarding-shorts" htmlFor="onboarding-hide-shorts">
              <span>
                <strong>Hide Shorts</strong>
                <small>Keep short videos out of your queue. Change this later in Rules.</small>
              </span>
              <button
                id="onboarding-hide-shorts"
                className={`switch ${shortsRule?.enabled ? "is-on" : ""}`}
                type="button"
                role="switch"
                aria-label="Hide Shorts"
                aria-checked={shortsRule?.enabled ?? false}
                aria-busy={savingShorts}
                disabled={!!busy || savingShorts || !loaded}
                onClick={() => void toggleShorts()}
              >
                <span />
              </button>
            </label>
          ) : null}
          {step !== "youtube" ? (
            <>
              <h3 className="onboarding-suggestion-heading">A few to get you started</h3>
              <ul className="onboarding-suggestions">
                {suggestions[progressStep].map((item) => (
                  <li key={item.url}>
                    <span className="onboarding-source-mark" aria-hidden="true">
                      {item.mark}
                    </span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      aria-label={`${added(item.url) ? "Remove" : "Add"} ${item.title}`}
                      aria-pressed={!!added(item.url)}
                      title={added(item.url) ? `Remove ${item.title}` : undefined}
                      disabled={!!busy || !loaded}
                      onClick={() => void toggleSuggestion(item.url)}
                    >
                      {busy === item.url ? (
                        <LoaderCircle className="spin" size={15} aria-hidden="true" />
                      ) : added(item.url) ? (
                        <Check size={15} aria-hidden="true" />
                      ) : (
                        <Plus size={15} aria-hidden="true" />
                      )}
                      <span className="onboarding-suggestion-label" aria-hidden="true">
                        <span className="onboarding-suggestion-status">
                          {added(item.url) ? "Added" : "Add"}
                        </span>
                        <span className="onboarding-suggestion-remove">Remove</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {step === "x" ? (
            <p className="onboarding-note">Public accounts only. No X sign-in needed.</p>
          ) : null}
        </div>
        {step === "feeds" && importResult?.failed.length ? (
          <details className="onboarding-failures">
            <summary>
              {importResult.failed.length} {importResult.failed.length === 1 ? "feed" : "feeds"}{" "}
              could not be imported
            </summary>
            <ul>
              {importResult.failed.map((failure) => (
                <li key={failure.url}>
                  <strong>{failure.title || failure.url}</strong>
                  <p>{failure.error}</p>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {error ? (
          <div className="login-error" role="alert">
            {error}
            {!loaded ? (
              <button className="quiet-button" type="button" onClick={() => void load()}>
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="onboarding-feedback" aria-live="polite">
        {!loaded && !error ? (
          <p>
            <LoaderCircle className="spin" size={14} aria-hidden="true" />
            Loading setup…
          </p>
        ) : notice ? (
          <p>
            <Check size={14} aria-hidden="true" />
            {notice}
          </p>
        ) : feeds.length ? (
          <p>
            <Rss size={14} aria-hidden="true" />
            {feeds.length} {feeds.length === 1 ? "feed" : "feeds"} in your queue.
          </p>
        ) : null}
      </div>
      <footer className="onboarding-footer">
        {position > 0 ? (
          <button
            className="quiet-button"
            type="button"
            disabled={!!busy}
            aria-label="Back"
            onClick={() => go(previousOnboardingStep(step), "backward")}
          >
            <ArrowLeft size={15} aria-hidden="true" />
            <span>Back</span>
          </button>
        ) : (
          <span />
        )}
        <div>
          {step !== "x" ? (
            <button className="quiet-button" type="button" onClick={onFinish}>
              Start reading
            </button>
          ) : null}
          <button
            className="primary-button"
            type="button"
            disabled={!!busy || !loaded}
            onClick={() => {
              const next = nextOnboardingStep(step);
              if (next) go(next);
              else onFinish();
            }}
          >
            {step === "x"
              ? "Start reading"
              : step === "youtube" && !youtube?.connected
                ? "Skip YouTube"
                : "Continue"}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </footer>
    </div>
  );
}
