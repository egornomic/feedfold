import { useState } from "react";
import type { ArticleThumbnailSize } from "../../../../shared/article-thumbnail";
import { articleImageUrl, articleThumbnailUrl } from "./article-image-url";

export function ArticleThumbnail({ articleId, imageUrl }: { articleId: number; imageUrl: string }) {
  const [failed, setFailed] = useState(false);
  const sourceSet = (size: ArticleThumbnailSize) =>
    [1, 2, 3]
      .map((density) => `${articleThumbnailUrl(articleId, imageUrl, size, density)} ${density}x`)
      .join(", ");
  return (
    <picture>
      {!failed && <source media="(max-width: 620px)" srcSet={sourceSet("small")} />}
      {!failed && <source media="(max-width: 900px)" srcSet={sourceSet("medium")} />}
      <img
        className="article-card-image"
        src={
          failed ? articleImageUrl(imageUrl) : articleThumbnailUrl(articleId, imageUrl, "large", 1)
        }
        srcSet={failed ? undefined : sourceSet("large")}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </picture>
  );
}
