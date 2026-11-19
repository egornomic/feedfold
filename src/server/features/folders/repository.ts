import assert from "node:assert/strict";
import type Sqlite from "better-sqlite3";
import { validFolderParent } from "../../../shared/folder-tree.js";
import type {
    Feed,
    Folder,
    FolderSortDirection,
} from "../../../shared/types.js";
import { InvalidRequestError } from "../../errors.js";
import { now, visibleClause } from "../shared.js";

type FolderDetails = Omit<Folder, "unreadCount">;
const folderColumns =
    "id, parent_id AS parentId, name, position, sort_direction AS sortDirection";

export class FolderRepository {
    constructor(private readonly sqlite: Sqlite.Database) {}

    listFolders(
        userId: number,
        feeds: readonly Pick<Feed, "folderId" | "unreadCount">[],
    ): Folder[] {
        const folders = this.sqlite
            .prepare(
                `SELECT ${folderColumns}, 0 AS unreadCount FROM folders WHERE user_id = ?`,
            )
            .all(userId) as Folder[];
        const byId = new Map(folders.map((folder) => [folder.id, folder]));
        for (const feed of feeds) {
            let folderId = feed.folderId;
            while (folderId !== null) {
                const folder = byId.get(folderId);
                if (!folder) {
                    break;
                }
                folder.unreadCount += feed.unreadCount;
                folderId = folder.parentId;
            }
        }
        return folders.sort(
            (left, right) =>
                left.name.localeCompare(right.name, undefined, {
                    numeric: true,
                    sensitivity: "base",
                }) || left.position - right.position,
        );
    }

    getFolder(userId: number, id: number): Folder | null {
        const folder = this.sqlite
            .prepare(
                `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM folders WHERE user_id = @userId AND id = @id
           UNION ALL
           SELECT folders.id
           FROM folders JOIN descendants ON folders.parent_id = descendants.id
           WHERE folders.user_id = @userId
         )
         SELECT ${folderColumns},
                (
                  SELECT COUNT(*)
                  FROM descendants
                  JOIN feeds ON feeds.folder_id = descendants.id
                  JOIN feed_articles ON feed_articles.feed_id = feeds.id
                  JOIN articles ON articles.id = feed_articles.article_id
                  WHERE feed_articles.is_read = 0
                    AND ${visibleClause}
                ) AS unreadCount
         FROM folders
         WHERE user_id = @userId AND id = @id`,
            )
            .get({ userId, id }) as Folder | undefined;
        return folder ?? null;
    }

    getFolderDetails(userId: number, id: number): FolderDetails | undefined {
        return this.sqlite
            .prepare(
                `SELECT ${folderColumns} FROM folders WHERE user_id = ? AND id = ?`,
            )
            .get(userId, id) as FolderDetails | undefined;
    }

    findRootFolderId(userId: number, name: string): number | undefined {
        return this.sqlite
            .prepare(
                `SELECT id FROM folders WHERE user_id = ? AND name = ? AND parent_id IS NULL
         ORDER BY position, id LIMIT 1`,
            )
            .pluck()
            .get(userId, name) as number | undefined;
    }

    assertFolderExists(
        userId: number,
        folderId: number | null | undefined,
    ): void {
        if (
            folderId !== null &&
            folderId !== undefined &&
            !this.getFolderDetails(userId, folderId)
        ) {
            throw new InvalidRequestError(
                "That feed or folder no longer exists. Reload and try again.",
            );
        }
    }

    createFolder(
        userId: number,
        input: {
            name: string;
            parentId?: number | null;
            position?: number;
            sortDirection?: FolderSortDirection;
        },
    ): Folder {
        this.assertFolderExists(userId, input.parentId);
        const timestamp = now();
        const result = this.sqlite
            .prepare(
                `INSERT INTO folders (
           user_id, name, parent_id, position, sort_direction, created_at, updated_at
         ) VALUES (
           ?, ?, ?, COALESCE(?, (
             SELECT COALESCE(MAX(position), -1) + 1 FROM folders WHERE user_id = ?
           )), ?, ?, ?
         )`,
            )
            .run(
                userId,
                input.name,
                input.parentId ?? null,
                input.position ?? null,
                userId,
                input.sortDirection ?? "newest",
                timestamp,
                timestamp,
            );
        const folder = this.getFolder(userId, Number(result.lastInsertRowid));
        assert(folder, "The new folder is missing");
        return folder;
    }

    updateFolder(
        userId: number,
        existing: FolderDetails,
        input: {
            name?: string;
            parentId?: number | null;
            position?: number;
            sortDirection?: FolderSortDirection;
        },
    ): void {
        const { id } = existing;
        this.assertFolderExists(userId, input.parentId);
        if (
            input.parentId !== undefined &&
            !validFolderParent(id, input.parentId, this.listOpmlFolders(userId))
        ) {
            throw new InvalidRequestError(
                "Choose a parent outside this folder.",
            );
        }
        this.sqlite
            .prepare(
                `UPDATE folders
         SET name = ?, parent_id = ?, position = ?, sort_direction = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
            )
            .run(
                input.name ?? existing.name,
                input.parentId === undefined
                    ? existing.parentId
                    : input.parentId,
                input.position ?? existing.position,
                input.sortDirection ?? existing.sortDirection,
                now(),
                id,
                userId,
            );
    }

    deleteFolder(userId: number, id: number): boolean {
        return (
            this.sqlite
                .prepare("DELETE FROM folders WHERE id = ? AND user_id = ?")
                .run(id, userId).changes > 0
        );
    }

    listOpmlFolders(
        userId: number,
    ): Array<{ id: number; name: string; parentId: number | null }> {
        return this.sqlite
            .prepare(
                `SELECT id, name, parent_id AS parentId
         FROM folders WHERE user_id = ? ORDER BY position, name COLLATE NOCASE`,
            )
            .all(userId) as Array<{
            id: number;
            name: string;
            parentId: number | null;
        }>;
    }
}
