import { safeStorage } from "electron";
import type { CredentialCipherLike } from "../server/features/ai/credential-cipher.js";
import { AiError } from "../server/features/ai/errors.js";
import type { AiProvider } from "../shared/types.js";

const ENVELOPE_VERSION = "desktop-v1";

interface StoredCredential {
  userId: number;
  provider: AiProvider;
  apiKey: string;
}

export class DesktopCredentialCipher implements CredentialCipherLike {
  encrypt(userId: number, provider: AiProvider, plaintext: string): string {
    const stored: StoredCredential = { userId, provider, apiKey: plaintext };
    const encrypted = safeStorage.encryptString(JSON.stringify(stored));
    return `${ENVELOPE_VERSION}.${encrypted.toString("base64url")}`;
  }

  decrypt(userId: number, provider: AiProvider, envelope: string): string {
    try {
      const [version, ciphertext, extra] = envelope.split(".");
      if (version !== ENVELOPE_VERSION || !ciphertext || extra !== undefined) {
        throw new Error("Invalid desktop credential envelope");
      }
      const stored = JSON.parse(
        safeStorage.decryptString(Buffer.from(ciphertext, "base64url")),
      ) as Partial<StoredCredential>;
      if (
        stored.userId !== userId ||
        stored.provider !== provider ||
        typeof stored.apiKey !== "string"
      ) {
        throw new Error("Desktop credential ownership does not match");
      }
      return stored.apiKey;
    } catch {
      throw new AiError(
        "AI_CREDENTIAL_UNREADABLE",
        409,
        "feedfold could not read the saved API key from this Mac. Enter it again in Settings.",
      );
    }
  }
}
