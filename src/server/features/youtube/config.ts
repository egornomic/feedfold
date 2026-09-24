import { readFileSync } from "node:fs";
import { normalizeBasePath } from "../../../shared/base-path.js";

export interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
  encryptionKey: Buffer;
  redirectUri: string;
}

export function youtubeConfiguration(
  environment: NodeJS.ProcessEnv,
  publicOrigin: string | undefined,
): YouTubeConfig | undefined {
  const file = environment.FEEDFOLD_YOUTUBE_SECRETS_FILE;
  let values: Record<string, unknown>;
  if (file) {
    try {
      values = JSON.parse(readFileSync(file, "utf8"));
      if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error();
    } catch {
      throw new Error("YouTube secrets file must contain a readable JSON object.");
    }
  } else {
    values = {
      clientId: environment.FEEDFOLD_YOUTUBE_CLIENT_ID,
      clientSecret: environment.FEEDFOLD_YOUTUBE_CLIENT_SECRET,
      tokenKey: environment.FEEDFOLD_YOUTUBE_TOKEN_KEY,
    };
    if (Object.values(values).every((value) => !value)) return undefined;
  }
  const [clientId = "", clientSecret = "", key = ""] = [
    values.clientId,
    values.clientSecret,
    values.tokenKey,
  ].map((value) => (typeof value === "string" ? value.trim() : ""));
  if (!publicOrigin) throw new Error("YouTube requires FEEDFOLD_PUBLIC_ORIGIN.");
  const encryptionKey = Buffer.from(key, "base64");
  if (!clientId || !clientSecret || encryptionKey.length !== 32) {
    throw new Error(
      "YouTube credentials must be nonempty and the token key must be 32 bytes in base64.",
    );
  }
  return {
    clientId,
    clientSecret,
    encryptionKey,
    redirectUri: new URL(
      `${normalizeBasePath(environment.FEEDFOLD_BASE_PATH)}/api/youtube/callback`,
      publicOrigin,
    ).href,
  };
}
