import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const digest = (value: string): string =>
  createHash("sha256").update(value).digest("base64url");

export class YouTubeTokenCipher {
  constructor(private readonly key: Buffer) {}

  encrypt(userId: number, plaintext: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(`youtube:${userId}`));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64");
  }

  decrypt(userId: number, envelope: string): string {
    const bytes = Buffer.from(envelope, "base64");
    const cipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(`youtube:${userId}`));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
  }
}
