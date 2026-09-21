import { appUrl } from "../../api";

export function articleImageUrl(value: string): string {
  return value.startsWith("/api/") ? appUrl(value) : value;
}
