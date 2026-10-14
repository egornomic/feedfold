import type { Folder } from "./types.js";

type FolderNode = Pick<Folder, "id" | "parentId">;

export function folderBranchIds(rootId: number, folders: readonly FolderNode[]): Set<number> {
  const ids = new Set([rootId]);
  let found = true;
  while (found) {
    found = false;
    for (const folder of folders) {
      if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        found = true;
      }
    }
  }
  return ids;
}

export function validFolderParent(
  id: number,
  parentId: number | null,
  folders: readonly FolderNode[],
): boolean {
  return parentId === null || !folderBranchIds(id, folders).has(parentId);
}
