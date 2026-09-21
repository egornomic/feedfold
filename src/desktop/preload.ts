import { contextBridge, ipcRenderer } from "electron";
import type { ApiOperation, ApiOutput, ApiRequest } from "../shared/api/operations.js";
import {
  DESKTOP_DATA_CHANGED_CHANNEL,
  type DesktopResponse,
  type FeedfoldDesktopBridge,
} from "../shared/desktop.js";

const bridge: FeedfoldDesktopBridge = Object.freeze({
  platform: "desktop" as const,
  invoke: <K extends ApiOperation>(request: ApiRequest<K>) =>
    ipcRenderer.invoke("feedfold:invoke", request) as Promise<DesktopResponse<ApiOutput<K>>>,
  exportOpml: () => ipcRenderer.invoke("feedfold:export-opml") as Promise<DesktopResponse<void>>,
  onDataChanged: (listener: () => void) => {
    const handleDataChanged = () => listener();
    ipcRenderer.on(DESKTOP_DATA_CHANGED_CHANNEL, handleDataChanged);
    return () => ipcRenderer.removeListener(DESKTOP_DATA_CHANGED_CHANNEL, handleDataChanged);
  },
});

contextBridge.exposeInMainWorld("feedfoldDesktop", bridge);
