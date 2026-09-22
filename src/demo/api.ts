import { createApiClient } from "../client/api/api-client.js";
import type { ApiInput, ApiOperation, ApiOutput } from "../shared/api/operations.js";
import { DemoStore } from "./store.js";

export type {
  FeedInput,
  FeedUpdateInput,
  FolderInput,
  RuleInput,
} from "../client/api/api-contract.js";
export { ApiError, AUTH_REQUIRED_EVENT, appUrl, errorMessage } from "../client/api/api-contract.js";

const demoStore = new DemoStore();

export async function demoRequest<K extends ApiOperation>(
  operation: K,
  payload: ApiInput<NoInfer<K>>,
): Promise<ApiOutput<K>> {
  return demoStore.invoke(operation, payload) as ApiOutput<K>;
}

function request<K extends ApiOperation>(
  operation: K,
  payload: ApiInput<NoInfer<K>>,
  _path: string,
  init?: RequestInit,
): Promise<ApiOutput<K>> {
  if (init?.signal?.aborted) {
    return Promise.reject(new DOMException("The request was aborted.", "AbortError"));
  }
  const result = Promise.resolve().then(() => demoStore.invoke(operation, payload) as ApiOutput<K>);
  if (!init?.signal) return result;
  return new Promise<ApiOutput<K>>((resolve, reject) => {
    const abort = () => reject(new DOMException("The request was aborted.", "AbortError"));
    init.signal?.addEventListener("abort", abort, { once: true });
    void result
      .then(resolve, reject)
      .finally(() => init.signal?.removeEventListener("abort", abort));
  });
}

function subscribeReaderDataInvalidations(): () => void {
  return () => {};
}

async function exportOpml(): Promise<void> {
  const opml = await demoRequest("exportOpml", undefined);
  const url = URL.createObjectURL(new Blob([opml], { type: "application/xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "feedfold-demo.opml";
  link.click();
  URL.revokeObjectURL(url);
}

export const api = createApiClient({
  request,
  subscribeReaderDataInvalidations,
  exportOpml,
});
