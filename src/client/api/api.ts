import type { ApiInput, ApiOperation, ApiOutput } from "../../shared/api/operations.js";
import type { AiProvider } from "../../shared/types.js";
import { invokeDesktop, isDesktopApp } from "../platform/desktop.js";
import { createApiClient } from "./api-client.js";
import { ApiError, appUrl } from "./api-contract.js";
import { createBrowserRequest } from "./browser-api.js";
import { httpRequest } from "./http-request.js";

export type {
  FeedInput,
  FeedUpdateInput,
  FolderInput,
  RuleInput,
} from "./api-contract.js";
export { ApiError, AUTH_REQUIRED_EVENT, appUrl, errorMessage } from "./api-contract.js";

function abortable<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted)
    return Promise.reject(new DOMException("The request was aborted.", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("The request was aborted.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

const browserRequest = createBrowserRequest(httpRequest);

async function request<K extends ApiOperation>(
  operation: K,
  payload: ApiInput<NoInfer<K>>,
  path: string,
  init?: RequestInit,
  aiProvider?: AiProvider | null,
): Promise<ApiOutput<K>> {
  if (!isDesktopApp()) return browserRequest<K>(operation, payload, path, init, aiProvider);
  try {
    return await abortable(invokeDesktop<K>(operation, payload), init?.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    const desktopError = error as Error & { status?: number; code?: string | null };
    throw new ApiError(desktopError.message, desktopError.status ?? 500, desktopError.code ?? null);
  }
}

function subscribeReaderDataInvalidations(listener: () => void): () => void {
  let active = true;
  const invalidate = () => {
    if (active) listener();
  };
  const bridge = window.feedfoldDesktop;
  const unsubscribe = bridge
    ? (() => {
        const unsubscribe = bridge.onDataChanged(invalidate);
        queueMicrotask(invalidate);
        return unsubscribe;
      })()
    : (() => {
        const events = new EventSource(appUrl("/api/refresh/events"), { withCredentials: true });
        events.addEventListener("message", invalidate);
        events.addEventListener("error", invalidate);
        return () => events.close();
      })();

  const reconcileVisible = () => {
    if (document.visibilityState === "visible") invalidate();
  };
  window.addEventListener("online", invalidate);
  document.addEventListener("visibilitychange", reconcileVisible);

  return () => {
    if (!active) return;
    active = false;
    unsubscribe();
    window.removeEventListener("online", invalidate);
    document.removeEventListener("visibilitychange", reconcileVisible);
  };
}

async function exportOpml(): Promise<void> {
  const bridge = window.feedfoldDesktop;
  if (!bridge) {
    window.location.assign(appUrl("/api/opml/export"));
    return;
  }
  const response = await bridge.exportOpml();
  if (!response.ok) {
    throw new ApiError(response.error.message, response.error.status, response.error.code);
  }
}

export const api = createApiClient({
  request,
  subscribeReaderDataInvalidations,
  exportOpml,
});
