import { CheckCircle2, EyeOff, ListFilter } from "lucide-react";
import type { RuleAction, RuleField } from "../../../shared/types";

export const RULE_FIELD_LABELS: Record<RuleField, string> = {
  title: "Title",
  author: "Author",
  summary: "Summary",
  content: "Full content",
  media: "Media type",
  any: "Any text",
};

export const RULE_ACTION_COPY: Record<
  RuleAction,
  { label: string; shortLabel: string; description: string }
> = {
  hide: {
    label: "Hide matching articles",
    shortLabel: "Hide matches",
    description: "Hide matching articles from every article list in this scope.",
  },
  keep: {
    label: "Keep only matching articles",
    shortLabel: "Keep only",
    description: "Show only articles that match this or another enabled keep rule in this scope.",
  },
  mark_read: {
    label: "Mark matching articles as read",
    shortLabel: "Mark as read",
    description: "Keep matching articles available, but remove them from unread views.",
  },
};

export function RuleActionIcon({ action, size }: { action: RuleAction; size: number }) {
  if (action === "hide") return <EyeOff aria-hidden="true" size={size} />;
  if (action === "keep") return <ListFilter aria-hidden="true" size={size} />;
  return <CheckCircle2 aria-hidden="true" size={size} />;
}
