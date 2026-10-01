// The magazine crop is 154 × 120 CSS pixels; preserve detail at 2× density.
export function thumbnailWidth(width = 0, height = 0): number {
  return width > 0 && height > 0 ? Math.ceil(Math.max(308, (240 * width) / height)) : 480;
}

export function thumbnailUrl(value: string): string {
  if (!URL.canParse(value)) return value;
  const url = new URL(value);

  if (url.hostname === "substackcdn.com" && url.pathname.startsWith("/image/fetch/")) {
    const dimensions = url.pathname.match(/_(\d+)x(\d+)\.[a-z]+$/i);
    const width = thumbnailWidth(Number(dimensions?.[1]), Number(dimensions?.[2]));
    return value.replace(/\bw_(\d+)/, (match, current: string) =>
      Number(current) > width ? `w_${width}` : match,
    );
  }

  if (
    ["miro.medium.com", "cdn-images-1.medium.com"].includes(url.hostname) &&
    url.pathname.startsWith("/max/")
  ) {
    return value.replace(/\/max\/(\d+)\//, (match, current: string) =>
      Number(current) > 480 ? "/max/480/" : match,
    );
  }

  if (url.hostname === "ourworldindata.org" && url.pathname.includes("/imagedelivery/")) {
    return value.replace(/\/w=(\d+)$/, (match, current: string) =>
      Number(current) > 480 ? "/w=480" : match,
    );
  }

  return value;
}
