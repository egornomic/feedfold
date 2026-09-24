import { ApiError, AUTH_REQUIRED_EVENT, appUrl } from "./api-contract.js";

export async function httpRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(appUrl(path), { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    let message = `The request failed with HTTP ${response.status}. Try again.`;
    let code: string | null = null;
    let operationId: string | null = null;
    try {
      const body = (await response.json()) as {
        error?: string;
        message?: string;
        code?: string;
        operationId?: string;
      };
      message = body.error ?? body.message ?? message;
      code = body.code ?? null;
      operationId = body.operationId ?? null;
    } catch {
      // The status code still gives the user a useful error when no JSON body exists.
    }
    if (
      response.status === 401 &&
      !path.startsWith("/api/auth/") &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    throw new ApiError(message, response.status, code, operationId);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
