import type { Article, RuleField } from "../../../shared/types";
import type { AnimationOrigin } from "../../ui/motion";

export interface RuleFormDraft {
    id: number;
    name: string;
    article: Article;
    articleIndex: number;
    origin: AnimationOrigin;
    feedId: number | null;
    field: RuleField;
    pattern: string;
}

export interface RuleFormPreset {
    name?: string;
    feedId?: number | null;
    folderId?: number;
    field?: RuleField;
    pattern?: string;
}
