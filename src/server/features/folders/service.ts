import type Sqlite from "better-sqlite3";
import type {
    Feed,
    Folder,
    FolderSortDirection,
} from "../../../shared/types.js";
import type { RuleRepository } from "../rules/repository.js";
import type { FolderRepository } from "./repository.js";

export class FolderService {
    constructor(
        private readonly sqlite: Sqlite.Database,
        private readonly repository: FolderRepository,
        private readonly rules: RuleRepository,
    ) {}

    listFolders(
        userId: number,
        feeds: readonly Pick<Feed, "folderId" | "unreadCount">[],
    ): Folder[] {
        return this.repository.listFolders(userId, feeds);
    }

    getFolder(userId: number, id: number): Folder | null {
        return this.repository.getFolder(userId, id);
    }

    findRootFolderId(userId: number, name: string): number | undefined {
        return this.repository.findRootFolderId(userId, name);
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
        return this.repository.createFolder(userId, input);
    }

    updateFolder(
        userId: number,
        id: number,
        input: {
            name?: string;
            parentId?: number | null;
            position?: number;
            sortDirection?: FolderSortDirection;
        },
    ): Folder | null {
        return this.sqlite.transaction(() => {
            const existing = this.repository.getFolderDetails(userId, id);
            if (!existing) {
                return null;
            }
            this.repository.updateFolder(userId, existing, input);
            if (
                input.parentId !== undefined &&
                input.parentId !== existing.parentId
            ) {
                this.rules.recomputeRulesForAllArticles(userId);
            }
            return this.repository.getFolder(userId, id);
        })();
    }

    deleteFolder(userId: number, id: number): boolean {
        return this.sqlite.transaction(() => {
            const deleted = this.repository.deleteFolder(userId, id);
            if (deleted) {
                this.rules.recomputeRulesForAllArticles(userId);
            }
            return deleted;
        })();
    }

    listOpmlFolders(
        userId: number,
    ): Array<{ id: number; name: string; parentId: number | null }> {
        return this.repository.listOpmlFolders(userId);
    }
}
