import type { Article, RuleField } from "../../../shared/types";

export interface RuleFormDraft {
  id: number;
  name: string;
  article: Article;
  articleIndex: number;
  feedId: number;
  field: RuleField;
  pattern: string;
}

export interface RuleFormPreset {
  name?: string;
  feedId?: number;
  folderId?: number;
  field?: RuleField;
  pattern?: string;
}
