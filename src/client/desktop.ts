import type { ApiInput, ApiOperation, ApiOutput, ApiRequest } from "../shared/api/operations.js";
import type { FeedfoldDesktopBridge } from "../shared/desktop.js";

declare global {
  interface Window {
    feedfoldDesktop?: FeedfoldDesktopBridge;
  }
}

export function isDesktopApp(): boolean {
  return window.feedfoldDesktop?.platform === "desktop";
}

export async function invokeDesktop<K extends ApiOperation>(
  operation: K,
  payload: ApiInput<NoInfer<K>>,
): Promise<ApiOutput<K>> {
  const bridge = window.feedfoldDesktop;
  if (!bridge) throw new Error("The desktop bridge is unavailable.");
  const response = await bridge.invoke<K>({ operation, payload } as ApiRequest<K>);
  if (!response.ok) {
    const error = new Error(response.error.message) as Error & {
      status: number;
      code: string | null;
    };
    error.status = response.error.status;
    error.code = response.error.code;
    throw error;
  }
  return response.value;
}
