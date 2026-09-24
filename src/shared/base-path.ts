export function normalizeBasePath(value = "/"): string {
  if (!value.startsWith("/")) throw new Error("FEEDFOLD_BASE_PATH must start with /");
  return value.replace(/\/+$/, "");
}
