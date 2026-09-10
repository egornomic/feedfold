import type { AiProvider } from "../../shared/types.js";

export interface CredentialCipherLike {
  encrypt(userId: number, provider: AiProvider, plaintext: string): string;
  decrypt(userId: number, provider: AiProvider, envelope: string): string;
}
