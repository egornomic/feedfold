import { AlertTriangle, Edit3, ListFilter, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { BootstrapData, Rule, RuleCondition } from "../../../shared/types";
import { errorMessage } from "../../api/api";
import { useDelayedPending } from "../../ui/loading";
import { useMotionPresence } from "../../ui/motion";
import type { ReaderDataMutations } from "../reader/reader-data";
import { RuleForm } from "../rules/rule-form";
import type { RuleFormDraft } from "../rules/rule-form-types";
import { RULE_ACTION_COPY, RULE_FIELD_LABELS, RuleActionIcon } from "../rules/rule-presentation";
import { PageHeader } from "./shared";
import "./rules.css";

function RulesPage({
  bootstrap,
  rules,
  loading,
  error,
  draft,
  mutations,
  onMenu,
  onClearDraft,
  onReturnToArticle,
  onRetry,
  showToast,
}: {
  bootstrap: BootstrapData;
  rules: Rule[] | null;
  loading: boolean;
  error: string | null;
  draft: RuleFormDraft | null;
  mutations: ReaderDataMutations;
  onMenu: () => void;
  onClearDraft: () => void;
  onReturnToArticle: (draft: RuleFormDraft) => void;
  onRetry: () => Promise<void> | void;
  showToast: (message: string) => void;
}) {
  const [formOpen, setFormOpen] = useState(draft !== null);
  const showLoading = useDelayedPending(rules === null && !error, "rules");
  const [formSession, setFormSession] = useState(0);
  const [editing, setEditing] = useState<Rule | null>(null);
  const formPresence = useMotionPresence(formOpen);
  const pageRef = useRef<HTMLDivElement>(null);
  const addRuleTriggerRef = useRef<HTMLButtonElement>(null);
  const ruleFormOpenerRef = useRef<HTMLButtonElement | null>(null);
  const retainedRuleForm = useRef<{ editing: Rule | null; draft: RuleFormDraft | null }>({
    editing,
    draft,
  });
  if (formOpen) retainedRuleForm.current = { editing, draft };
  const displayedEditing = formOpen ? editing : retainedRuleForm.current.editing;
  const displayedDraft = formOpen ? draft : retainedRuleForm.current.draft;

  return (
    <div className="management-page" ref={pageRef}>
      <PageHeader
        title="Rules"
        description="Filter articles by their text or media type, then choose what happens to matches."
        onMenu={onMenu}
        actions={
          <button
            ref={addRuleTriggerRef}
            className="primary-button"
            type="button"
            onClick={(event) => {
              ruleFormOpenerRef.current = event.currentTarget;
              onClearDraft();
              setEditing(null);
              setFormSession((current) => current + 1);
              setFormOpen(true);
              pageRef.current?.scrollTo({ top: 0 });
            }}
          >
            <Plus aria-hidden="true" size={16} />
            Add rule
          </button>
        }
      />

      {formPresence.present ? (
        <RuleForm
          key={`${
            displayedEditing
              ? `rule-${displayedEditing.id}`
              : displayedDraft
                ? `draft-${displayedDraft.id}`
                : "new-rule"
          }-${formSession}`}
          bootstrap={bootstrap}
          initial={displayedEditing ?? undefined}
          preset={displayedEditing ? undefined : (displayedDraft ?? undefined)}
          motionState={formPresence.state}
          mutations={mutations}
          onCancel={() => {
            const returnDraft = editing ? null : draft;
            onClearDraft();
            setFormOpen(false);
            if (returnDraft) {
              setEditing(null);
              onReturnToArticle(returnDraft);
              return;
            }
            ruleFormOpenerRef.current?.focus();
          }}
          onSaved={(rule) => {
            const returnDraft = editing ? null : draft;
            showToast(editing ? `Saved ${rule.name}` : `Added ${rule.name}`);
            onClearDraft();
            setFormOpen(false);
            if (returnDraft) {
              setEditing(null);
              onReturnToArticle(returnDraft);
            } else {
              addRuleTriggerRef.current?.focus();
            }
          }}
          showToast={showToast}
        />
      ) : null}

      <section
        className="management-section rules-section"
        aria-labelledby="active-rules-heading"
        aria-busy={loading}
      >
        <div className="section-title-row">
          <div>
            <h2 id="active-rules-heading">Saved rules</h2>
            <p>Enabled rules check saved articles now and new articles during each refresh.</p>
          </div>
          {rules !== null ? (
            <span className="rules-count">
              {rules.filter((rule) => rule.enabled).length} active
            </span>
          ) : null}
        </div>

        {error ? (
          <div className="section-error" role="alert">
            <AlertTriangle aria-hidden="true" size={18} />
            <span>{error}</span>
            <button className="secondary-button" type="button" onClick={() => void onRetry()}>
              Try again
            </button>
          </div>
        ) : null}
        {rules === null ? (
          error ? null : (
            <div className="rule-loading" aria-busy="true">
              {showLoading
                ? [0, 1, 2].map((key) => <div className="skeleton-line" key={key} />)
                : null}
            </div>
          )
        ) : rules.length === 0 ? (
          <div className="section-empty">
            <ListFilter aria-hidden="true" size={22} />
            <h3>No rules yet</h3>
            <p>Create a rule to keep wanted articles, hide noise, or mark matches as read.</p>
            <button
              className="secondary-button"
              type="button"
              onClick={(event) => {
                ruleFormOpenerRef.current = event.currentTarget;
                onClearDraft();
                setEditing(null);
                setFormSession((current) => current + 1);
                setFormOpen(true);
                pageRef.current?.scrollTo({ top: 0 });
              }}
            >
              Create your first rule
            </button>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table rules-table">
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">Scope</th>
                  <th scope="col">Conditions</th>
                  <th scope="col">Action</th>
                  <th scope="col">Matched</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    bootstrap={bootstrap}
                    mutations={mutations}
                    onEdit={(trigger) => {
                      ruleFormOpenerRef.current = trigger;
                      onClearDraft();
                      setEditing(rule);
                      setFormSession((current) => current + 1);
                      setFormOpen(true);
                      pageRef.current?.scrollTo({ top: 0 });
                    }}
                    showToast={showToast}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function RuleRow({
  rule,
  bootstrap,
  mutations,
  onEdit,
  showToast,
}: {
  rule: Rule;
  bootstrap: BootstrapData;
  mutations: ReaderDataMutations;
  onEdit: (trigger: HTMLButtonElement) => void;
  showToast: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const scope = rule.feedId
    ? (bootstrap.feeds.find((feed) => feed.id === rule.feedId)?.title ?? "Deleted feed")
    : rule.folderId
      ? (bootstrap.folders.find((folder) => folder.id === rule.folderId)?.name ?? "Deleted folder")
      : "All feeds";
  const [firstCondition] = rule.conditions as [RuleCondition, ...RuleCondition[]];
  const conditionJoin = rule.conditionOperator === "and" ? " AND " : " OR ";
  const conditionDescription = rule.conditions
    .map((condition) => `${RULE_FIELD_LABELS[condition.field]} contains “${condition.pattern}”`)
    .join(conditionJoin);

  const toggle = async () => {
    setBusy(true);
    try {
      await mutations.updateRule(rule.id, { enabled: !rule.enabled });
      showToast(rule.enabled ? `Disabled ${rule.name}` : `Enabled ${rule.name}`);
    } catch (error) {
      showToast(`Could not update ${rule.name}: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete rule “${rule.name}”? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await mutations.deleteRule(rule.id);
      showToast(`Deleted ${rule.name}`);
    } catch (error) {
      showToast(`Could not delete ${rule.name}: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className={rule.enabled ? "" : "is-disabled"}>
      <td data-label="Rule">
        <div className="rule-name-cell">
          <button
            className={`switch ${rule.enabled ? "is-on" : ""}`}
            type="button"
            role="switch"
            aria-label={`Enable ${rule.name}`}
            aria-checked={rule.enabled}
            disabled={busy}
            onClick={() => void toggle()}
          >
            <span />
          </button>
          <strong>{rule.name}</strong>
        </div>
      </td>
      <td data-label="Scope">{scope}</td>
      <td data-label="Conditions">
        <span className="rule-condition" title={conditionDescription}>
          <span className="sr-only">{conditionDescription}</span>
          <small aria-hidden="true">
            {rule.conditionOperator === "and" ? "Match all" : "Match any"}
          </small>
          <span className="rule-condition-summary" aria-hidden="true">
            <code>
              {RULE_FIELD_LABELS[firstCondition.field]}: {firstCondition.pattern}
            </code>
            {rule.conditions.length > 1 ? (
              <span className="rule-condition-count">+{rule.conditions.length - 1}</span>
            ) : null}
          </span>
        </span>
      </td>
      <td data-label="Action">
        <span className={`action-badge ${rule.action}`}>
          <RuleActionIcon action={rule.action} size={13} />
          {RULE_ACTION_COPY[rule.action].shortLabel}
        </span>
      </td>
      <td data-label="Matched">
        <span className="numeric-cell">{rule.matchedCount}</span>
      </td>
      <td className="row-actions">
        <button
          type="button"
          onClick={(event) => onEdit(event.currentTarget)}
          aria-label={`Edit ${rule.name}`}
        >
          <Edit3 aria-hidden="true" size={15} />
        </button>
        <button
          className="danger-action"
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          aria-label={`Delete ${rule.name}`}
        >
          <Trash2 aria-hidden="true" size={15} />
        </button>
      </td>
    </tr>
  );
}

export default RulesPage;
