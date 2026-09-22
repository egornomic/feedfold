import { AlertTriangle, FileText, LoaderCircle, RefreshCw } from "lucide-react";
import { telegramPostIdentity } from "../../../../shared/telegram";
import type { Article, ArticleAiTranslation } from "../../../../shared/types";
import { withXVideoPlaceholder, xVideoPlaceholderId, xVideoPostIds } from "../../../../shared/x";
import type { ArticleTranslationViewState } from "./article-ai-state";
import { articleContentView, shouldShowArticleDescription } from "./article-content";
import { ArticleHtml } from "./article-html";
import { ArticleMediaPlayer, TelegramPostMedia, XPostVideo } from "./article-media";

import { LinkifiedText } from "./linkified-text";

export function ArticleBody({
  article,
  fullContentVisible,
  translationState,
  showYouTubeDescriptions,
  onToggleFullContent,
}: {
  article: Article;
  fullContentVisible: boolean;
  translationState: ArticleTranslationViewState;
  showYouTubeDescriptions: boolean;
  onToggleFullContent: (article: Article) => void;
}) {
  const videoPostIds = xVideoPostIds(article.url, article.feedContentHtml);
  const translation = shouldShowArticleDescription(article, showYouTubeDescriptions)
    ? translationState.translation
    : null;
  const translationVisible = Boolean(translationState.visible && translation);
  const contentView = articleContentView(article, fullContentVisible);
  const inlineXVideos = contentView !== "full" && !translationVisible;

  return (
    <>
      {article.media ? <ArticleMediaPlayer article={article} /> : null}
      <div
        className="article-content-stage"
        data-translation-ready={translation !== null}
        data-translation-visible={translationVisible}
      >
        <div
          className="article-content-layer is-original"
          data-state={translationVisible ? "inactive" : "active"}
          aria-hidden={translationVisible}
          inert={translationVisible}
        >
          <ArticleText
            article={article}
            fullContentVisible={fullContentVisible}
            showYouTubeDescriptions={showYouTubeDescriptions}
            onToggleFullContent={onToggleFullContent}
          />
        </div>
        {translation ? (
          <div
            className="article-content-layer is-translation"
            data-state={translationVisible ? "active" : "inactive"}
            aria-hidden={!translationVisible}
            inert={!translationVisible}
          >
            <ArticleTranslationText translation={translation} />
          </div>
        ) : null}
      </div>
      {telegramPostIdentity(article.url) ? <TelegramPostMedia article={article} /> : null}
      {videoPostIds.map((postId) => (
        <XPostVideo
          key={postId}
          article={article}
          postId={postId}
          targetId={inlineXVideos ? xVideoPlaceholderId(article.id, postId) : null}
        />
      ))}
    </>
  );
}

function ArticleTranslationText({ translation }: { translation: ArticleAiTranslation }) {
  return (
    <ArticleHtml className="article-content article-translation" sanitizedHtml={translation.html} />
  );
}

function ArticleText({
  article,
  fullContentVisible,
  showYouTubeDescriptions,
  onToggleFullContent,
}: {
  article: Article;
  fullContentVisible: boolean;
  showYouTubeDescriptions: boolean;
  onToggleFullContent: (article: Article) => void;
}) {
  const contentView = articleContentView(article, fullContentVisible);
  if (contentView === "feed" || contentView === "summary" || contentView === "empty") {
    return <FeedArticleText article={article} showYouTubeDescriptions={showYouTubeDescriptions} />;
  }

  if (contentView === "loading") {
    return (
      <>
        <div className="article-extraction-state extraction-loading" role="status">
          <LoaderCircle className="spin" aria-hidden="true" size={18} />
          <div>
            <strong>Loading the full article</strong>
            <p>You can keep reading the feed text while feedfold loads the source page.</p>
          </div>
        </div>
        <FeedArticleText article={article} showYouTubeDescriptions={showYouTubeDescriptions} />
      </>
    );
  }
  if (contentView === "full" && article.contentHtml) {
    return <ArticleHtml sanitizedHtml={article.contentHtml} />;
  }
  if (contentView === "failed") {
    return (
      <>
        <div className="article-extraction-state extraction-failed" role="note">
          <AlertTriangle aria-hidden="true" size={18} />
          <div>
            <strong>Could not load the full article</strong>
            <p>
              {article.extractionError ?? "The source page did not contain readable article text."}
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => onToggleFullContent(article)}
            >
              <RefreshCw aria-hidden="true" size={15} />
              Try again
            </button>
          </div>
        </div>
        <FeedArticleText article={article} showYouTubeDescriptions={showYouTubeDescriptions} />
      </>
    );
  }

  return <FeedArticleText article={article} showYouTubeDescriptions={showYouTubeDescriptions} />;
}

function FeedArticleText({
  article,
  showYouTubeDescriptions,
}: {
  article: Article;
  showYouTubeDescriptions: boolean;
}) {
  if (!shouldShowArticleDescription(article, showYouTubeDescriptions)) return null;
  if (article.feedContentHtml) {
    const html = xVideoPostIds(article.url, article.feedContentHtml).reduce(
      (html, postId) => withXVideoPlaceholder(html, postId, article.id),
      article.feedContentHtml,
    );
    return <ArticleHtml sanitizedHtml={html} />;
  }
  return article.summary ? (
    <div className="article-content">
      <p>
        <LinkifiedText text={article.summary} />
      </p>
    </div>
  ) : (
    <div className="article-extraction-state">
      <FileText aria-hidden="true" size={18} />
      <p>This feed did not provide article text. Open the source to read it.</p>
    </div>
  );
}
