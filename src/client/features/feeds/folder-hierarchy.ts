import { folderBranchIds, folderPath } from "../../../shared/folder-tree.js";
import type { Feed, Folder } from "../../../shared/types.js";

export interface FolderHierarchyEntry {
  folder: Folder;
  depth: number;
  path: string;
}

export function folderPathLabel(folderId: number | null, folders: Folder[]): string {
  if (folderId === null) return "Top level";
  return folderPath(folderId, folders)
    .map((folder) => folder.name)
    .join(" / ");
}

export function folderHierarchy(folders: Folder[]): FolderHierarchyEntry[] {
  const childrenByParent = new Map<number | null, Folder[]>();
  for (const folder of folders) {
    const siblings = childrenByParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    childrenByParent.set(folder.parentId, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((left, right) => left.name.localeCompare(right.name));
  }

  const entries: FolderHierarchyEntry[] = [];
  const appendChildren = (parentId: number | null, depth: number, parentPath: string) => {
    for (const folder of childrenByParent.get(parentId) ?? []) {
      const path = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
      entries.push({ folder, depth, path });
      appendChildren(folder.id, depth + 1, path);
    }
  };
  appendChildren(null, 0, "");
  return entries;
}

export function folderBranchFeedCount(folderId: number, folders: Folder[], feeds: Feed[]): number {
  const branchIds = folderBranchIds(folderId, folders);
  return feeds.filter((feed) => feed.folderId !== null && branchIds.has(feed.folderId)).length;
}
