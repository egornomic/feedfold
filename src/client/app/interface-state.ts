import { createStore } from "zustand/vanilla";
import type { Feed, Folder } from "../../shared/types";
import type {
    FeedActionHandler,
    FolderActionHandler,
    ManagementRequest,
} from "../features/feeds/feed-management";
import type { AnimationOrigin } from "../ui/motion";

interface InterfaceState {
    navOpen: boolean;
    shortcutHelpOpen: boolean;
    shortcutHelpOrigin: AnimationOrigin | undefined;
    managementRequest: ManagementRequest | null;
    setNavOpen: (open: boolean) => void;
    setShortcutHelpOpen: (open: boolean, origin?: AnimationOrigin) => void;
    setManagementRequest: (request: ManagementRequest | null) => void;
    openFeedManagement: FeedActionHandler<Pick<Feed, "id">>;
    openFolderManagement: FolderActionHandler<Pick<Folder, "id">>;
}

export function createInterfaceStore() {
    return createStore<InterfaceState>()((set) => ({
        navOpen: false,
        shortcutHelpOpen: false,
        shortcutHelpOrigin: undefined,
        managementRequest: null,
        setNavOpen: (navOpen) => set({ navOpen }),
        setShortcutHelpOpen: (shortcutHelpOpen, shortcutHelpOrigin) =>
            set({ shortcutHelpOpen, shortcutHelpOrigin }),
        setManagementRequest: (managementRequest) => set({ managementRequest }),
        openFeedManagement: (feed, action, origin) => {
            const kinds = {
                settings: "feed-settings",
                selection: "web-feed-selection",
                rename: "rename-feed",
                move: "move-feed",
                rule: "create-feed-rule",
                unsubscribe: "unsubscribe-feed",
            } as const;
            set({
                managementRequest: {
                    kind: kinds[action],
                    feedId: feed.id,
                    origin,
                },
            });
        },
        openFolderManagement: (folder, action, origin) => {
            if (action === "add-folder") {
                set({
                    managementRequest: {
                        kind: "add-folder",
                        parentId: folder.id,
                        origin,
                    },
                });
                return;
            }
            const kinds = {
                settings: "folder-settings",
                "add-feed": "add-feed-to-folder",
                rule: "create-folder-rule",
                delete: "delete-folder",
            } as const;
            set({
                managementRequest: {
                    kind: kinds[action],
                    folderId: folder.id,
                    origin,
                },
            });
        },
    }));
}
