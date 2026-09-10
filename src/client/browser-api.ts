import type { DesktopOperation } from "../shared/desktop.js";
import type { AiProvider, AiSettings, BootstrapData, SessionUser } from "../shared/types.js";
import { aiDevice, decryptAiKey, encryptAiKey, forgetAiDevice } from "./ai-vault.js";
import type { ApiRuntime } from "./api-client.js";

type HttpRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export function createBrowserRequest(httpRequest: HttpRequest): ApiRuntime["request"] {
  let accountId: string | null = null;

  return async <T>(
    operation: DesktopOperation,
    payload: unknown,
    path: string,
    init?: RequestInit,
    aiProvider?: AiProvider | null,
  ): Promise<T> => {
    const account = accountId;
    const device = account ? await aiDevice(account).catch(() => null) : null;
    const headers = new Headers(init?.headers);
    if (account) headers.set("X-Feedfold-Account", account);
    if (device) headers.set("X-Feedfold-Device", device.id);
    let options = { ...init, headers };

    if (operation === "saveAiProviderKey") {
      if (!device || !account)
        throw new Error(
          "Secure key storage is unavailable in this browser. Use HTTPS and allow site storage.",
        );
      const { provider, apiKey } = payload as { provider: AiProvider; apiKey: string };
      const encryptedApiKey = await encryptAiKey(device, account, provider, apiKey.trim());
      options = { ...options, body: JSON.stringify({ encryptedApiKey }) };
    }

    if (
      (operation === "summarizeArticle" || operation === "translateArticle") &&
      aiProvider &&
      device &&
      account
    ) {
      const { encryptedApiKey } = await httpRequest<{ encryptedApiKey: string | null }>(
        `/api/ai/providers/${aiProvider}/key`,
        { headers },
      );
      if (encryptedApiKey) {
        const apiKey = await decryptAiKey(device, account, aiProvider, encryptedApiKey);
        options = {
          ...options,
          body: JSON.stringify({
            ...JSON.parse(String(init?.body)),
            credential: { provider: aiProvider, apiKey },
          }),
        };
      }
    }

    try {
      const result = await httpRequest<T>(path, options);
      if (
        ["session", "login", "register", "completePasskeySignup", "passkeyLogin"].includes(
          operation,
        )
      ) {
        accountId = (result as { user: SessionUser }).user.id;
      }
      if (!device && operation === "bootstrap") {
        (result as BootstrapData).aiSettings.credentialStorageAvailable = false;
      } else if (
        !device &&
        ["aiSettings", "updateAiFeature", "deleteAiProviderKey"].includes(operation)
      ) {
        (result as AiSettings).credentialStorageAvailable = false;
      }
      return result;
    } finally {
      if ((operation === "logout" || operation === "deleteAccount") && account) {
        accountId = null;
        if (device) await forgetAiDevice(account);
      }
    }
  };
}
