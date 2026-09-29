export const ARTICLE_THUMBNAIL_SIZES = {
  small: { width: 76, height: 76 },
  medium: { width: 118, height: 88 },
  large: { width: 154, height: 120 },
} as const;

export type ArticleThumbnailSize = keyof typeof ARTICLE_THUMBNAIL_SIZES;
