import { thumbnailUrl } from "../../../../shared/thumbnail";
import { appUrl } from "../../../api/api";

export function articleImageUrl(value: string): string {
  return value.startsWith("/api/") ? appUrl(value) : value;
}

export function articleThumbnailUrl(value: string): string {
  return articleImageUrl(thumbnailUrl(value));
}
