export function feedHost(value: string): string {
  return new URL(value).hostname.replace(/^www\./, "");
}
