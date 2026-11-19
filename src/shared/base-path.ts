import { assert } from "./assert.js";

export function normalizeBasePath(value = "/"): string {
  assert(value.startsWith("/"), "FEEDFOLD_BASE_PATH must start with /");
  return value.replace(/\/+$/, "");
}
