import {
  ARTICLE_THUMBNAIL_SIZES,
  type ArticleThumbnailSize,
} from "../../../../shared/article-thumbnail.js";
import { appUrl } from "../../../api/api-contract.js";

export function articleImageUrl(value: string): string {
  return value.startsWith("/api/") ? appUrl(value) : value;
}

export function articleThumbnailUrl(
  articleId: number,
  imageUrl: string,
  size: ArticleThumbnailSize,
  density: number,
): string {
  const url = URL.parse(imageUrl);
  if (url?.hostname === "images.unsplash.com") {
    const dimensions = ARTICLE_THUMBNAIL_SIZES[size];
    url.searchParams.set("w", String(dimensions.width * density));
    url.searchParams.set("h", String(dimensions.height * density));
    url.searchParams.set("fit", "crop");
    return url.toString();
  }
  return appUrl(`/api/articles/${articleId}/thumbnail/${size}/${density}`);
}
