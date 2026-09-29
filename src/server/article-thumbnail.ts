import sharp from "sharp";
import { z } from "zod";
import { ARTICLE_THUMBNAIL_SIZES } from "../shared/article-thumbnail.js";
import { ApplicationApiError } from "./errors.js";
import { fetchFeed } from "./feed-http.js";
import type { QuotaService } from "./quota.js";

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_ENTRIES = 256;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

export const thumbnailParams = z.object({
  size: z.enum(["small", "medium", "large"]),
  density: z.coerce.number().int().min(1).max(3),
});

export class ArticleThumbnailService {
  private readonly cache = new Map<string, { expiresAt: number; image: Promise<Buffer> }>();

  constructor(
    private readonly quotas: QuotaService,
    private readonly fetcher: typeof fetchFeed = fetchFeed,
  ) {}

  image(url: string, options: z.infer<typeof thumbnailParams>): Promise<Buffer> {
    const { size, density } = thumbnailParams.parse(options);
    const key = JSON.stringify([url, size, density]);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.image;
    this.cache.delete(key);
    const image = this.quotas.runOutbound(async () => {
      const response = await this.fetcher(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: "image/webp,image/*;q=0.9", "User-Agent": "feedfold/1.0" },
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new ApplicationApiError(502, "The article image is unavailable.");
      }
      const chunks: Uint8Array[] = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.byteLength;
        if (length > MAX_IMAGE_BYTES)
          throw new ApplicationApiError(502, "The article image is too large to resize.");
        chunks.push(chunk);
      }
      const { width, height } = ARTICLE_THUMBNAIL_SIZES[size];
      return sharp(Buffer.concat(chunks), { limitInputPixels: 40_000_000 })
        .autoOrient()
        .resize(width * density, height * density, { fit: "cover", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    });
    this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, image });
    if (this.cache.size > CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    void image.catch(() => {
      if (this.cache.get(key)?.image === image) this.cache.delete(key);
    });
    return image;
  }
}
