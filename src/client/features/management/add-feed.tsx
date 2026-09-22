import { ArrowLeft } from "lucide-react";
import type { BootstrapData } from "../../../shared/types";
import { AddFeedForm } from "../feeds/add-feed-form";
import type { AddFeedSourceType } from "../feeds/feed-source";
import type { ReaderDataMutations } from "../reader/data-resource";
import { PageHeader } from "./shared";
import "./add-feed.css";

export default function AddFeedPage({
  bootstrap,
  initialSourceUrl,
  initialSourceType,
  mutations,
  onMenu,
  onBack,
  showToast,
}: {
  bootstrap: BootstrapData;
  initialSourceUrl: string;
  initialSourceType?: AddFeedSourceType;
  mutations: ReaderDataMutations;
  onMenu: () => void;
  onBack: () => void;
  showToast: (message: string) => void;
}) {
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
      <AddFeedForm
        key={`${initialSourceType ?? "choose"}:${initialSourceUrl}`}
        initialSourceType={initialSourceType}
        feeds={bootstrap.feeds}
        folders={bootstrap.folders}
        initialSourceUrl={initialSourceUrl}
        mutations={mutations}
        onCancel={onBack}
        onSaved={(feed) => {
          showToast(`Subscribed to ${feed.title}`);
          onBack();
        }}
      />
    </div>
  );
}
