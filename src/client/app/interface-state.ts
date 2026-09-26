import { createStore } from "zustand/vanilla";
import type { Feed, Folder } from "../../shared/types";
import type {
  FeedManagementAction,
  FolderManagementAction,
  ManagementRequest,
} from "../features/feeds/feed-management";

interface InterfaceState {
  navOpen: boolean;
  shortcutHelpOpen: boolean;
  managementRequest: ManagementRequest | null;
  setNavOpen: (open: boolean) => void;
  toggleNav: () => void;
  setShortcutHelpOpen: (open: boolean) => void;
  setManagementRequest: (request: ManagementRequest | null) => void;
  openFeedManagement: (feed: Pick<Feed, "id">, action: FeedManagementAction) => void;
  openFolderManagement: (folder: Pick<Folder, "id">, action: FolderManagementAction) => void;
}

export function createInterfaceStore() {
  return createStore<InterfaceState>()((set) => ({
    navOpen: false,
    shortcutHelpOpen: false,
    managementRequest: null,
    setNavOpen: (navOpen) => set({ navOpen }),
    toggleNav: () => set((state) => ({ navOpen: !state.navOpen })),
    setShortcutHelpOpen: (shortcutHelpOpen) => set({ shortcutHelpOpen }),
    setManagementRequest: (managementRequest) => set({ managementRequest }),
    openFeedManagement: (feed, action) => {
      const kinds = {
        settings: "feed-settings",
        selection: "web-feed-selection",
        rename: "rename-feed",
        move: "move-feed",
        rule: "create-feed-rule",
        unsubscribe: "unsubscribe-feed",
      } as const;
      set({ managementRequest: { kind: kinds[action], feedId: feed.id } });
    },
    openFolderManagement: (folder, action) => {
      if (action === "add-folder") {
        set({ managementRequest: { kind: "add-folder", parentId: folder.id } });
        return;
      }
      const kinds = {
        settings: "folder-settings",
        "add-feed": "add-feed-to-folder",
        rule: "create-folder-rule",
        delete: "delete-folder",
      } as const;
      set({ managementRequest: { kind: kinds[action], folderId: folder.id } });
    },
  }));
}
