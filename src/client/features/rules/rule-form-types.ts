import type { Article, RuleField } from "../../../shared/types";

export interface RuleFormDraft {
  id: number;
  name: string;
  article: Article;
  articleIndex: number;
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
