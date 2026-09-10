import { describe, expect, it } from "vitest";
import { type AiDevice, decryptAiKey, encryptAiKey } from "../../src/client/ai-vault.js";

async function device(): Promise<AiDevice> {
  return {
    id: crypto.randomUUID(),
    key: await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]),
  };
}

describe("AI key encryption", () => {
  it("uses fresh ciphertext for each save and binds it to the account, browser, and provider", async () => {
    const first = await device();
    const encrypted = await encryptAiKey(first, "reader", "openai", "secret-provider-key");
    expect(encrypted).not.toContain("secret-provider-key");
    expect(await encryptAiKey(first, "reader", "openai", "secret-provider-key")).not.toBe(
      encrypted,
    );
    expect(await decryptAiKey(first, "reader", "openai", encrypted)).toBe("secret-provider-key");
    await expect(decryptAiKey(first, "another-reader", "openai", encrypted)).rejects.toThrow(
      "cannot unlock",
    );
    await expect(decryptAiKey(first, "reader", "gemini", encrypted)).rejects.toThrow(
      "cannot unlock",
    );
    await expect(
      decryptAiKey({ ...first, id: crypto.randomUUID() }, "reader", "openai", encrypted),
    ).rejects.toThrow("cannot unlock");
    await expect(decryptAiKey(await device(), "reader", "openai", encrypted)).rejects.toThrow(
      "cannot unlock",
    );
  });

  it("rejects altered or unreadable encrypted keys", async () => {
    const first = await device();
    const encrypted = await encryptAiKey(first, "reader", "openai", "secret-provider-key");
    const [version, iv, ciphertext] = encrypted.split(".");
    const changed = `${version}.${iv}.${ciphertext?.startsWith("A") ? "B" : "A"}${ciphertext?.slice(1)}`;
    for (const value of [
      changed,
      "invalid",
      `${encrypted}.extra`,
      `${version}.invalid.${ciphertext}`,
    ]) {
      await expect(decryptAiKey(first, "reader", "openai", value)).rejects.toThrow("cannot unlock");
    }
  });
});
