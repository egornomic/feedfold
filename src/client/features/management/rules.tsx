import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Edit3,
  EyeOff,
  ListFilter,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type {
  Article,
  BootstrapData,
  Rule,
  RuleAction,
  RuleCondition,
  RuleConditionOperator,
  RuleField,
} from "../../../shared/types";
import { errorMessage, type RuleInput } from "../../api";
import type { ReaderDataMutations } from "../../data-resource";
import { DropdownSelect } from "../../dropdown";
import { useDelayedPending } from "../../loading";
import { type MotionState, motionExitDuration, useMotionPresence } from "../../motion";
import { PageHeader } from "./shared";
import "./rules.css";

const RULE_FIELD_LABELS: Record<RuleField, string> = {
  title: "Title",
  author: "Author",
  summary: "Summary",
  content: "Full content",
  media: "Media type",
  any: "Any text",
};

const RULE_ACTION_COPY: Record<
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

interface EditableRuleCondition extends RuleCondition {
  id: number;
  animatePresence?: boolean;
}

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

function RuleActionIcon({ action, size }: { action: RuleAction; size: number }) {
  if (action === "hide") return <EyeOff aria-hidden="true" size={size} />;
  if (action === "keep") return <ListFilter aria-hidden="true" size={size} />;
  return <CheckCircle2 aria-hidden="true" size={size} />;
}

export function RuleForm({
  bootstrap,
  initial,
  preset,
  motionState,
  mutations,
  onCancel,
  onSaved,
  showToast,
}: {
  bootstrap: BootstrapData;
  initial?: Rule;
  preset?: RuleFormPreset;
  motionState: MotionState;
  mutations: ReaderDataMutations;
  onCancel: () => void;
  onSaved: (rule: Rule) => Promise<void> | void;
  showToast: (message: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? preset?.name ?? "");
  const [scope, setScope] = useState(
    initial?.feedId
      ? `feed:${initial.feedId}`
      : initial?.folderId
        ? `folder:${initial.folderId}`
        : preset?.feedId
          ? `feed:${preset.feedId}`
          : preset?.folderId
            ? `folder:${preset.folderId}`
            : "all",
  );
  const nextConditionId = useRef(initial?.conditions.length ?? 1);
  const conditionInputRefs = useRef(new Map<number, HTMLInputElement>());
  const conditionRemovalTimers = useRef(new Map<number, number>());
  const addConditionButtonRef = useRef<HTMLButtonElement>(null);
  const [conditions, setConditions] = useState<EditableRuleCondition[]>(() => {
    const values = initial?.conditions ?? [
      { field: preset?.field ?? "title", pattern: preset?.pattern ?? "" },
    ];
    return values.map((condition, id) => ({ ...condition, id }));
  });
  const [conditionOperator, setConditionOperator] = useState<RuleConditionOperator>(
    initial?.conditionOperator ?? "or",
  );
  const [removingConditionIds, setRemovingConditionIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [action, setAction] = useState<RuleAction>(initial?.action ?? "hide");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [saving, setSaving] = useState(false);

  useEffect(
    () => () => {
      for (const timer of conditionRemovalTimers.current.values()) window.clearTimeout(timer);
    },
    [],
  );

  const addCondition = () => {
    const id = nextConditionId.current;
    nextConditionId.current += 1;
    setConditions((current) => [
      ...current,
      {
        id,
        field: current[current.length - 1]?.field ?? "title",
        pattern: "",
        animatePresence: true,
      },
    ]);
    window.requestAnimationFrame(() => conditionInputRefs.current.get(id)?.focus());
  };

  const removeCondition = (id: number) => {
    if (conditionRemovalTimers.current.has(id)) return;
    const activeConditions = conditions.filter(
      (condition) => !removingConditionIds.has(condition.id),
    );
    if (activeConditions.length <= 1) return;
    const index = activeConditions.findIndex((condition) => condition.id === id);
    const focusId = activeConditions[index - 1]?.id ?? activeConditions[index + 1]?.id;
    const finishRemoval = () => {
      conditionRemovalTimers.current.delete(id);
      setConditions((current) => current.filter((condition) => condition.id !== id));
      setRemovingConditionIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      conditionInputRefs.current.delete(id);
    };
    const duration = motionExitDuration();
    if (duration === 0) finishRemoval();
    else {
      setRemovingConditionIds((current) => new Set(current).add(id));
      conditionRemovalTimers.current.set(id, window.setTimeout(finishRemoval, duration));
    }
    window.requestAnimationFrame(() => {
      if (focusId === undefined) addConditionButtonRef.current?.focus();
      else conditionInputRefs.current.get(focusId)?.focus();
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const [scopeType, rawId] = scope.split(":");
    const input: RuleInput = {
      name: name.trim(),
      feedId: scopeType === "feed" ? Number(rawId) : null,
      folderId: scopeType === "folder" ? Number(rawId) : null,
      conditions: conditions
        .filter((condition) => !removingConditionIds.has(condition.id))
        .map(({ field, pattern }) => ({ field, pattern: pattern.trim() })),
      conditionOperator,
      action,
      enabled,
    };
    setSaving(true);
    try {
      const rule = initial
        ? await mutations.updateRule(initial.id, input)
        : await mutations.createRule(input);
      await onSaved(rule);
    } catch (error) {
      showToast(`Could not save the rule: ${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="inline-editor rule-form"
      data-motion-state={motionState}
      inert={motionState === "closed"}
      onSubmit={(event) => void submit(event)}
    >
      <div className="inline-editor-heading">
        <div>
          <h2>{initial ? "Edit rule" : preset?.pattern ? "Filter selected text" : "Add rule"}</h2>
          <p>
            The rule checks saved articles when you save it, then checks new articles at refresh.
          </p>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={onCancel}
          aria-label={preset?.pattern ? "Back to article" : "Close rule form"}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>
      <div className="rule-form-sections">
        <section className="rule-form-section" aria-labelledby="rule-basics-heading">
          <div className="rule-form-section-heading">
            <h3 id="rule-basics-heading">Name and scope</h3>
          </div>
          <div className="form-grid rule-basics-grid">
            <label className="field">
              <span>Rule name</span>
              <input
                data-dialog-initial-focus
                required
                value={name}
                placeholder="Skip weekly sponsor posts"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="field">
              <span>Apply to</span>
              <DropdownSelect
                ariaLabel="Apply to"
                value={scope}
                options={[
                  { value: "all", label: "All feeds" },
                  ...bootstrap.folders.map((folder) => ({
                    value: `folder:${folder.id}`,
                    label: folder.name,
                    group: "Folders",
                  })),
                  ...bootstrap.feeds.map((feed) => ({
                    value: `feed:${feed.id}`,
                    label: feed.title,
                    group: "Feeds",
                  })),
                ]}
                onChange={setScope}
              />
            </div>
          </div>
        </section>

        <section className="rule-form-section" aria-labelledby="rule-conditions-heading">
          <div className="rule-form-section-heading">
            <h3 id="rule-conditions-heading">Conditions</h3>
            <p id="rule-conditions-description">
              Text matching ignores case. Choose whether every condition or any condition must
              match.
            </p>
          </div>
          <fieldset className="rule-condition-group" aria-describedby="rule-conditions-description">
            <legend className="sr-only">Article matching conditions</legend>
            <div className="rule-condition-columns" aria-hidden="true">
              <span>Combine</span>
              <span>Field</span>
              <span>Test</span>
              <span>Text</span>
              <span />
            </div>
            <ol className="rule-condition-list">
              {conditions.map((condition, index) => {
                const fieldId = `rule-condition-field-${condition.id}`;
                const valueId = `rule-condition-value-${condition.id}`;
                const connector = conditionOperator === "and" ? "And" : "Or";
                return (
                  <li
                    className="rule-condition-row"
                    key={condition.id}
                    data-motion-state={
                      removingConditionIds.has(condition.id)
                        ? "closed"
                        : condition.animatePresence
                          ? "open"
                          : undefined
                    }
                    inert={removingConditionIds.has(condition.id) ? true : undefined}
                  >
                    {index === 0 ? (
                      <span className="rule-condition-connector">If</span>
                    ) : index === 1 ? (
                      <div className="rule-condition-operator">
                        <span className="sr-only">Join all conditions with</span>
                        <DropdownSelect
                          ariaLabel="Join all conditions with"
                          value={conditionOperator}
                          options={[
                            { value: "and", label: "And" },
                            { value: "or", label: "Or" },
                          ]}
                          onChange={(value) => setConditionOperator(value as RuleConditionOperator)}
                        />
                      </div>
                    ) : (
                      <span className="rule-condition-connector">{connector}</span>
                    )}

                    <div className="rule-condition-control rule-condition-field-control">
                      <label className="sr-only" htmlFor={fieldId}>
                        Look in for condition {index + 1}
                      </label>
                      <DropdownSelect
                        id={fieldId}
                        value={condition.field}
                        options={Object.entries(RULE_FIELD_LABELS).map(([value, label]) => ({
                          value,
                          label,
                        }))}
                        onChange={(value) =>
                          setConditions((current) =>
                            current.map((item) =>
                              item.id === condition.id
                                ? { ...item, field: value as RuleField }
                                : item,
                            ),
                          )
                        }
                      />
                    </div>

                    <span className="rule-condition-comparator">contains</span>

                    <div className="rule-condition-control rule-condition-value-control">
                      <label className="sr-only" htmlFor={valueId}>
                        {condition.field === "media" ? "Media value" : "Text to match"} for
                        condition {index + 1}
                      </label>
                      <input
                        id={valueId}
                        ref={(element) => {
                          if (element) conditionInputRefs.current.set(condition.id, element);
                          else conditionInputRefs.current.delete(condition.id);
                        }}
                        required
                        value={condition.pattern}
                        placeholder={condition.field === "media" ? "short" : "sponsored"}
                        onChange={(event) =>
                          setConditions((current) =>
                            current.map((item) =>
                              item.id === condition.id
                                ? { ...item, pattern: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </div>

                    {conditions.length - removingConditionIds.size > 1 &&
                    !removingConditionIds.has(condition.id) ? (
                      <button
                        className="icon-button rule-condition-remove"
                        type="button"
                        onClick={() => removeCondition(condition.id)}
                        aria-label={`Remove condition ${index + 1}${
                          condition.pattern ? `: ${condition.pattern}` : ""
                        }`}
                      >
                        <X aria-hidden="true" size={16} />
                      </button>
                    ) : (
                      <span className="rule-condition-remove-spacer" aria-hidden="true" />
                    )}
                  </li>
                );
              })}
            </ol>
          </fieldset>
          <div className="rule-condition-actions">
            <button
              ref={addConditionButtonRef}
              className="quiet-button"
              type="button"
              onClick={addCondition}
            >
              <Plus aria-hidden="true" size={15} />
              Add condition
            </button>
            {conditions.some((condition) => condition.field === "media") ? (
              <small>
                For media type, use <code>short</code>, <code>video</code>, <code>article</code>, or{" "}
                <code>youtube</code>.
              </small>
            ) : null}
          </div>
        </section>

        <section className="rule-form-section" aria-labelledby="rule-action-heading">
          <div className="rule-form-section-heading">
            <h3 id="rule-action-heading">Action</h3>
            <p>Choose what feedfold does when an article matches.</p>
          </div>
          <fieldset className="rule-action-options">
            <legend className="sr-only">Rule action</legend>
            {(["hide", "keep", "mark_read"] as const).map((value) => (
              <label
                className={`rule-action-option${action === value ? " is-selected" : ""}`}
                key={value}
              >
                <input
                  type="radio"
                  name="rule-action"
                  value={value}
                  checked={action === value}
                  onChange={() => setAction(value)}
                />
                <span className="rule-action-icon">
                  <RuleActionIcon action={value} size={17} />
                </span>
                <span>
                  <strong>{RULE_ACTION_COPY[value].label}</strong>
                  <small>{RULE_ACTION_COPY[value].description}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="checkbox-field rule-enabled-field">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              <strong>Enable rule</strong>
              <small>Turn this off to save the rule without applying it.</small>
            </span>
          </label>
        </section>
      </div>
      <div className="form-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>
          {preset?.pattern ? "Back to article" : "Cancel"}
        </button>
        <button
          className="primary-button"
          type="submit"
          disabled={
            saving || !name.trim() || conditions.some((condition) => !condition.pattern.trim())
          }
        >
          {saving ? (
            <LoaderCircle className="spin" aria-hidden="true" size={16} />
          ) : (
            <Check aria-hidden="true" size={16} />
          )}
          {saving ? "Saving rule" : preset?.pattern ? "Save and return" : "Save rule"}
        </button>
      </div>
    </form>
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
