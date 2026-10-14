import type { Article, Rule, RuleField } from "./types.js";

export type RuleArticle = Pick<
  Article,
  "title" | "author" | "summary" | "feedContentHtml" | "contentHtml" | "media"
>;

export function articleMatchesRule(
  article: RuleArticle,
  rule: Pick<Rule, "conditions" | "conditionOperator">,
): boolean {
  const media = article.media ? `${article.media.provider} ${article.media.type}` : "article";
  const content = `${article.feedContentHtml ?? ""} ${article.contentHtml ?? ""}`;
  const values: Record<RuleField, string> = {
    title: article.title,
    author: article.author ?? "",
    summary: article.summary,
    content,
    media,
    any: `${article.title} ${article.author ?? ""} ${article.summary} ${content} ${media}`,
  };
  const matches = (condition: Rule["conditions"][number]) =>
    values[condition.field].toLocaleLowerCase().includes(condition.pattern.toLocaleLowerCase());
  return rule.conditionOperator === "and"
    ? rule.conditions.every(matches)
    : rule.conditions.some(matches);
}
