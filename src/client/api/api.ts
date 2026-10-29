import type { ApiInput, ApiOperation, ApiOutput } from "../../shared/api/operations.js";
import { invokeDesktop, isDesktopApp } from "../platform/desktop.js";
import {
  type ApiRequestOptions,
  createApiClient,
  type ReaderDataInvalidation,
} from "./api-client.js";
import { ApiError, appUrl } from "./api-contract.js";
import { createBrowserRequest, readerTabId } from "./browser-api.js";
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
  options?: ApiRequestOptions,
): Promise<ApiOutput<K>> {
  if (!isDesktopApp()) return browserRequest<K>(operation, payload, options);
  try {
    return await abortable(invokeDesktop<K>(operation, payload), options?.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    const desktopError = error as Error & { status?: number; code?: string | null };
    throw new ApiError(desktopError.message, desktopError.status ?? 500, desktopError.code ?? null);
  }
}

const STREAM_RECONNECT_DELAY_MS = 5_000;

function subscribeReaderDataInvalidations(
  listener: (reason: ReaderDataInvalidation) => void,
): () => void {
  let active = true;
  const invalidate = () => {
    if (active) listener("change");
  };
  const bridge = window.feedfoldDesktop;
  const unsubscribe = bridge
    ? (() => {
        const unsubscribe = bridge.onDataChanged(invalidate);
        queueMicrotask(invalidate);
        return unsubscribe;
      })()
    : (() => {
        let connected = false;
        let reconnect: ReturnType<typeof setTimeout> | undefined;
        let events: EventSource;
        const connect = () => {
          events = new EventSource(appUrl(`/api/refresh/events?reader=${readerTabId}`), {
            withCredentials: true,
          });
          events.addEventListener("connected", () => {
            if (active) listener(connected ? "change" : "connected");
            connected = true;
          });
          events.addEventListener("message", invalidate);
          events.addEventListener("error", () => {
            invalidate();
            // Browsers stop retrying after an error response, such as a proxy's during a restart.
            if (events.readyState === EventSource.CLOSED)
              reconnect = setTimeout(connect, STREAM_RECONNECT_DELAY_MS);
          });
        };
        connect();
        return () => {
          clearTimeout(reconnect);
          events.close();
        };
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
