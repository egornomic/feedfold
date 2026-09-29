import { readResponseText } from "./http-response.js";
import { fetchPublic } from "./public-network.js";

const GITHUB_HOST = "github.com";
const GITHUB_GIST_HOST = "gist.github.com";

export function githubFeedUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const isProfile =
    parts.length === 1 &&
    (url.hostname.toLowerCase() === GITHUB_HOST || url.hostname.toLowerCase() === GITHUB_GIST_HOST);
  const isRepositoryFeed =
    url.hostname.toLowerCase() === GITHUB_HOST &&
    parts.length >= 3 &&
    (parts[2] === "commits" ||
      (parts.length === 3 && (parts[2] === "releases" || parts[2] === "tags")));
  if ((!isProfile && !isRepositoryFeed) || url.pathname.endsWith(".atom")) return null;

  url.pathname = `${url.pathname.replace(/\/+$/, "")}.atom`;
  url.hash = "";
  return url.toString();
}

export function fetchFeed(value: string, options: RequestInit): Promise<Response> {
  return fetchPublic(value, options);
}

export function readFeedResponse(response: Response): Promise<string> {
  return readResponseText(
    response,
    10 * 1024 * 1024,
    "The source is larger than the 10 MiB feed limit.",
  );
}
