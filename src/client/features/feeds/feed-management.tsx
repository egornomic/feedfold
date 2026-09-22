import {
  Edit3,
  Folder,
  FolderPlus,
  ListFilter,
  MousePointer2,
  Rss,
  Settings,
  Trash2,
} from "lucide-react";
import type { Feed, FeedSourceKind } from "../../../shared/types";

export type FeedManagementAction =
  | "settings"
  | "selection"
  | "rename"
  | "move"
  | "rule"
  | "unsubscribe";

export type FolderManagementAction = "settings" | "add-feed" | "add-folder" | "rule" | "delete";

export type ManagementRequest =
  | { kind: "feed-settings"; feedId: number }
  | { kind: "web-feed-selection"; feedId: number }
  | { kind: "rename-feed"; feedId: number }
  | { kind: "move-feed"; feedId: number }
  | { kind: "create-feed-rule"; feedId: number }
  | { kind: "unsubscribe-feed"; feedId: number }
  | { kind: "create-folder" }
  | { kind: "folder-settings"; folderId: number }
  | { kind: "delete-folder"; folderId: number }
  | { kind: "add-feed-to-folder"; folderId: number }
  | { kind: "add-folder"; parentId: number }
  | { kind: "create-folder-rule"; folderId: number };

export function FeedActionMenuItems({
  feed,
  sourceKind,
  onAction,
}: {
  feed?: Feed;
  sourceKind?: FeedSourceKind;
  onAction: (action: FeedManagementAction) => void;
}) {
  return (
    <>
      <button type="button" role="menuitem" onClick={() => onAction("settings")}>
        <Settings aria-hidden="true" size={15} />
        Feed settings
      </button>
      {(feed?.sourceKind ?? sourceKind) === "web" ? (
        <button type="button" role="menuitem" onClick={() => onAction("selection")}>
          <MousePointer2 aria-hidden="true" size={15} />
          Edit page selection
        </button>
      ) : null}
      <button type="button" role="menuitem" onClick={() => onAction("rename")}>
        <Edit3 aria-hidden="true" size={15} />
        Rename feed
      </button>
      <button type="button" role="menuitem" onClick={() => onAction("move")}>
        <Folder aria-hidden="true" size={15} />
        Move to folder
      </button>
      <button type="button" role="menuitem" onClick={() => onAction("rule")}>
        <ListFilter aria-hidden="true" size={15} />
        Create rule
      </button>
      <hr className="context-menu-separator" />
      <button
        className="danger-menu-item"
        type="button"
        role="menuitem"
        onClick={() => onAction("unsubscribe")}
      >
        <Trash2 aria-hidden="true" size={15} />
        Unsubscribe from feed
      </button>
    </>
  );
}

export function FolderActionMenuItems({
  onAction,
}: {
  onAction: (action: FolderManagementAction) => void;
}) {
  return (
    <>
      <button type="button" role="menuitem" onClick={() => onAction("settings")}>
        <Settings aria-hidden="true" size={15} />
        Folder settings
      </button>
      <button type="button" role="menuitem" onClick={() => onAction("add-feed")}>
        <Rss aria-hidden="true" size={15} />
        Add feed to folder
      </button>
      <button type="button" role="menuitem" onClick={() => onAction("add-folder")}>
        <FolderPlus aria-hidden="true" size={15} />
        Add subfolder
      </button>
      <button type="button" role="menuitem" onClick={() => onAction("rule")}>
        <ListFilter aria-hidden="true" size={15} />
        Create rule
      </button>
      <hr className="context-menu-separator" />
      <button
        className="danger-menu-item"
        type="button"
        role="menuitem"
        onClick={() => onAction("delete")}
      >
        <Trash2 aria-hidden="true" size={15} />
        Delete folder
      </button>
    </>
  );
}
