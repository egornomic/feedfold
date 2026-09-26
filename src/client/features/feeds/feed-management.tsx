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
import { MenuItem } from "../../ui/menu";

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
      <MenuItem onClick={() => onAction("settings")}>
        <Settings aria-hidden="true" size={15} />
        Feed settings
      </MenuItem>
      {(feed?.sourceKind ?? sourceKind) === "web" ? (
        <MenuItem onClick={() => onAction("selection")}>
          <MousePointer2 aria-hidden="true" size={15} />
          Edit page selection
        </MenuItem>
      ) : null}
      <MenuItem onClick={() => onAction("rename")}>
        <Edit3 aria-hidden="true" size={15} />
        Rename feed
      </MenuItem>
      <MenuItem onClick={() => onAction("move")}>
        <Folder aria-hidden="true" size={15} />
        Move to folder
      </MenuItem>
      <MenuItem onClick={() => onAction("rule")}>
        <ListFilter aria-hidden="true" size={15} />
        Create rule
      </MenuItem>
      <hr className="context-menu-separator" />
      <MenuItem className="danger-menu-item" onClick={() => onAction("unsubscribe")}>
        <Trash2 aria-hidden="true" size={15} />
        Unsubscribe from feed
      </MenuItem>
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
      <MenuItem onClick={() => onAction("settings")}>
        <Settings aria-hidden="true" size={15} />
        Folder settings
      </MenuItem>
      <MenuItem onClick={() => onAction("add-feed")}>
        <Rss aria-hidden="true" size={15} />
        Add feed to folder
      </MenuItem>
      <MenuItem onClick={() => onAction("add-folder")}>
        <FolderPlus aria-hidden="true" size={15} />
        Add subfolder
      </MenuItem>
      <MenuItem onClick={() => onAction("rule")}>
        <ListFilter aria-hidden="true" size={15} />
        Create rule
      </MenuItem>
      <hr className="context-menu-separator" />
      <MenuItem className="danger-menu-item" onClick={() => onAction("delete")}>
        <Trash2 aria-hidden="true" size={15} />
        Delete folder
      </MenuItem>
    </>
  );
}
