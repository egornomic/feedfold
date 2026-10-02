import { api as liveApi } from "../client/api/api.js";
import { createApiClient } from "../client/api/api-client.js";
import type { ApiOutput } from "../shared/api/operations.js";
import { DemoStore } from "./store.js";
import { createStressAccount } from "./stress-account.js";
import { createStressData, DATA_MODES, type DataMode } from "./worst-case.js";

export type { FeedInput, FeedUpdateInput, FolderInput, RuleInput } from "../client/api/api.js";
export { ApiError, AUTH_REQUIRED_EVENT, appUrl, errorMessage } from "../client/api/api.js";

export function selectedDataMode(): DataMode | null {
  const value = new URLSearchParams(window.location.search).get("data");
  return DATA_MODES.find((mode) => mode === value) ?? null;
}

function fixtureApi(mode: DataMode) {
  const store = new DemoStore(new Date(), createStressData(mode));
  const account = createStressAccount(mode);
  return createApiClient({
    request: async (operation, payload, _path, init) => {
      if (init?.signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");
      if (operation in account) {
        return structuredClone(account[operation as keyof typeof account]) as ApiOutput<
          typeof operation
        >;
      }
      return store.invoke(operation, payload);
    },
    subscribeReaderDataInvalidations: () => () => {},
    exportOpml: async () => {
      const url = URL.createObjectURL(new Blob([store.exportOpml()], { type: "application/xml" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "feedfold-stress.opml";
      link.click();
      URL.revokeObjectURL(url);
    },
  });
}

const initialMode = selectedDataMode();
export let api = initialMode ? fixtureApi(initialMode) : liveApi;

export function selectDataMode(mode: DataMode | null): void {
  api = mode ? fixtureApi(mode) : liveApi;
  const url = new URL(window.location.href);
  if (mode) url.searchParams.set("data", mode);
  else url.searchParams.delete("data");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}
