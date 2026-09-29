import { ApplicationApiError } from "./errors.js";

export async function readResponseText(
  response: Response,
  maxBytes: number,
  limitMessage: string,
): Promise<string> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new ApplicationApiError(422, limitMessage, "unsupported_content");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new ApplicationApiError(422, limitMessage, "unsupported_content");
      }
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks, totalBytes));
  } finally {
    reader.releaseLock();
  }
}
