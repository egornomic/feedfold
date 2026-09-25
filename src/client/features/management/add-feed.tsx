import { ArrowLeft, SquarePlay } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BootstrapData, Feed } from "../../../shared/types";
import { isYouTubeChannelFeed, type YouTubeStatus } from "../../../shared/youtube";
import { httpRequest } from "../../api/http-request";
import { AddFeedForm } from "../feeds/add-feed-form";
import type { AddFeedSourceType } from "../feeds/feed-source";
import type { ReaderDataMutations } from "../reader/data-resource";
import { PageHeader } from "./shared";
import "./add-feed.css";

export default function AddFeedPage({
  userId,
  bootstrap,
  initialSourceUrl,
  initialSourceType,
  mutations,
  onMenu,
  onBack,
  onYouTubeSettings,
  showToast,
}: {
  userId: string;
  bootstrap: BootstrapData;
  initialSourceUrl: string;
  initialSourceType?: AddFeedSourceType | undefined;
  mutations: ReaderDataMutations;
  onMenu: () => void;
  onBack: () => void;
  onYouTubeSettings: () => void;
  showToast: (message: string) => void;
}) {
  const [savedFeed, setSavedFeed] = useState<Feed | null>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (savedFeed) successHeading.current?.focus();
  }, [savedFeed]);

  return (
    <div className="management-page add-feed-page">
      <PageHeader
        title="Add feed"
        description="Choose a source, preview what Feedfold finds, then subscribe."
        onMenu={onMenu}
        actions={
          <button
            className="secondary-button"
            type="button"
            aria-label="All feeds"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" size={16} />
            <span className="add-feed-back-label">All feeds</span>
          </button>
        }
      />
      {savedFeed ? (
        <section className="add-feed-flow" aria-labelledby="youtube-sync-suggestion-heading">
          <div className="add-feed-stage">
            <header className="add-feed-stage-heading">
              <h2 ref={successHeading} tabIndex={-1}>
                Feed added
              </h2>
              <p>You’re now following {savedFeed.title}.</p>
            </header>
            <div className="add-feed-fallback">
              <span className="add-feed-source-mark" aria-hidden="true">
                <SquarePlay size={20} />
              </span>
              <div>
                <strong id="youtube-sync-suggestion-heading">
                  Sync your other YouTube subscriptions
                </strong>
                <p>Connect YouTube to add your subscribed channels and keep them in sync daily.</p>
              </div>
              <div className="add-feed-fallback-actions">
                <button className="secondary-button" type="button" onClick={onBack}>
                  Not now
                </button>
                <button className="primary-button" type="button" onClick={onYouTubeSettings}>
                  Set up YouTube sync
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <AddFeedForm
          key={`${initialSourceType ?? "choose"}:${initialSourceUrl}`}
          initialSourceType={initialSourceType}
          feeds={bootstrap.feeds}
          folders={bootstrap.folders}
          initialSourceUrl={initialSourceUrl}
          mutations={mutations}
          onCancel={onBack}
          onSaved={async (feed) => {
            if (isYouTubeChannelFeed(feed.feedUrl)) {
              const status = await httpRequest<YouTubeStatus>("/api/youtube", {
                headers: { "X-Feedfold-Account": userId },
              }).catch(() => null);
              if (status?.available && !status.connected) {
                setSavedFeed(feed);
                return;
              }
            }
            showToast(`Subscribed to ${feed.title}`);
            onBack();
          }}
        />
      )}
    </div>
  );
}
