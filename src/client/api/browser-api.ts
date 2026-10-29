import type { ApiInput, ApiOperation, ApiOutput } from "../../shared/api/operations.js";
import type { AiProvider, AiSettings, BootstrapData, SessionUser } from "../../shared/types.js";
import { aiDevice, decryptAiKey, encryptAiKey, forgetAiDevice } from "./ai-vault.js";
import type { ApiRequestOptions, ApiRuntime } from "./api-client.js";
import { browserRequests } from "./browser-requests.js";

type HttpRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Identifies this tab so the server does not echo its own changes back to it. */
export const READER_TAB_HEADER = "X-Feedfold-Reader";
export const readerTabId = Math.random().toString(36).slice(2);

export function createBrowserRequest(httpRequest: HttpRequest): ApiRuntime["request"] {
  let accountId: string | null = null;

  return async <K extends ApiOperation>(
    operation: K,
    payload: ApiInput<NoInfer<K>>,
    options?: ApiRequestOptions,
  ): Promise<ApiOutput<K>> => {
    const { path, method, body: requestBody } = browserRequests[operation](payload);
    let body = requestBody;
    const aiProvider = options?.aiProvider;
    const account = accountId;
    const device = account ? await aiDevice(account).catch(() => null) : null;
    const headers = new Headers({ [READER_TAB_HEADER]: readerTabId });
    if (account) headers.set("X-Feedfold-Account", account);
    if (device) headers.set("X-Feedfold-Device", device.id);

    if (operation === "saveAiProviderKey") {
      if (!device || !account)
        throw new Error(
          "Secure key storage is unavailable in this browser. Use HTTPS and allow site storage.",
        );
      const { provider, apiKey } = payload as { provider: AiProvider; apiKey: string };
      const encryptedApiKey = await encryptAiKey(device, account, provider, apiKey.trim());
      body = { encryptedApiKey };
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
        body = { ...body, credential: { provider: aiProvider, apiKey } };
      }
    }

    try {
      const result = await httpRequest<ApiOutput<K>>(path, {
        method,
        headers,
        signal: options?.signal ?? null,
        body: body === undefined ? null : JSON.stringify(body),
      });
      if (
        ["session", "login", "register", "completePasskeySignup", "passkeyLogin"].includes(
          operation,
        )
      ) {
        accountId = (result as { user: SessionUser }).user.id;
      }
      if (!device && operation === "bootstrap") {
        (result as BootstrapData).aiSettings.credentialStorageAvailable = false;
      } else if (!device && ["updateAiFeature", "deleteAiProviderKey"].includes(operation)) {
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
