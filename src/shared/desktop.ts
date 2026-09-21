import type { ApiOperation, ApiOutput, ApiRequest } from "./api/operations.js";

export const DESKTOP_DATA_CHANGED_CHANNEL = "feedfold:data-changed";

export type DesktopResponse<T = ApiOutput<ApiOperation>> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        message: string;
        status: number;
        code: string | null;
      };
    };

export interface FeedfoldDesktopBridge {
  readonly platform: "desktop";
  invoke<K extends ApiOperation>(request: ApiRequest<K>): Promise<DesktopResponse<ApiOutput<K>>>;
  exportOpml(): Promise<DesktopResponse<void>>;
  onDataChanged(listener: () => void): () => void;
}
