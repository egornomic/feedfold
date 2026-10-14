import {
  AlertTriangle,
  Edit3,
  Eye,
  EyeOff,
  LoaderCircle,
  MessageSquareText,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import {
  AI_PROMPT_MAX_LENGTH,
  DEFAULT_ARTICLE_SUMMARY_PROMPT,
  DEFAULT_ARTICLE_TRANSLATION_PROMPT,
} from "../../../shared/ai-prompts";
import type { AiCustomPrompt, AiProvider, AiSettings, AppSettings } from "../../../shared/types";
import { api, errorMessage } from "../../api/api";
import { useRequestMutation } from "../../api/use-request-mutation";
import { isDesktopApp } from "../../platform/desktop";
import { Modal, useDialog } from "../../ui/dialog";
import { DropdownSelect } from "../../ui/dropdown";
import type { SensitiveAction } from "./settings-security";

export function AiSettingsSection({
  settings,
  aiSettings,
  onSettings,
  onAiSettings,
  showToast,
  runSensitive,
}: {
  settings: AppSettings;
  aiSettings: AiSettings;
  onSettings: (settings: AppSettings) => void;
  onAiSettings: (settings: AiSettings) => void;
  showToast: (message: string) => void;
  runSensitive: SensitiveAction;
}) {
  const { run: mutateRequest } = useRequestMutation();
  const activeFeature = aiSettings.features.articleSummary;
  const savedProvider = activeFeature?.provider ?? "gemini";
  const savedModel =
    activeFeature?.model ??
    aiSettings.providers.find((provider) => provider.id === savedProvider)?.defaultModel ??
    "";
  const [providerId, setProviderId] = useState<AiProvider>(savedProvider);
  const [modelId, setModelId] = useState(savedModel);
  const [previousFeature, setPreviousFeature] = useState({
    provider: savedProvider,
    model: savedModel,
  });
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savingFeature, setSavingFeature] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [removingKey, setRemovingKey] = useState(false);
  const [savingPrompts, setSavingPrompts] = useState(false);
  const [savingCustomPrompt, setSavingCustomPrompt] = useState(false);
  const [summaryPrompt, setSummaryPrompt] = useState(settings.summaryPrompt);
  const [translationPrompt, setTranslationPrompt] = useState(settings.translationPrompt);
  const [editingCustomPrompt, setEditingCustomPrompt] = useState<AiCustomPrompt | null>(null);
  const [customPromptName, setCustomPromptName] = useState("");
  const [customPromptText, setCustomPromptText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [customPromptError, setCustomPromptError] = useState<string | null>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const summaryPromptRef = useRef<HTMLTextAreaElement>(null);
  const customPromptNameRef = useRef<HTMLInputElement>(null);

  const promptDialog = useDialog(() => setPromptError(null), { autoOpen: false });
  const customPromptDialog = useDialog(() => setCustomPromptError(null), {
    autoOpen: false,
  });

  if (previousFeature.provider !== savedProvider || previousFeature.model !== savedModel) {
    // A pending key also pins the provider, even when the model itself is untouched.
    const dirty =
      providerId !== previousFeature.provider ||
      modelId.trim() !== previousFeature.model ||
      apiKey.length > 0;
    const matchesSaved = providerId === savedProvider && modelId.trim() === savedModel;
    if (!dirty || matchesSaved) {
      setPreviousFeature({ provider: savedProvider, model: savedModel });
      if (!dirty) {
        setProviderId(savedProvider);
        setModelId(savedModel);
      }
    }
  }

  const provider = aiSettings.providers.find((option) => option.id === providerId);
  if (!provider) return null;
  const modelChanged =
    activeFeature?.provider !== providerId || activeFeature?.model !== modelId.trim();
  const promptsChanged =
    summaryPrompt.trim() !== settings.summaryPrompt ||
    translationPrompt.trim() !== settings.translationPrompt;
  const defaultPromptsSelected =
    summaryPrompt.trim() === DEFAULT_ARTICLE_SUMMARY_PROMPT &&
    translationPrompt.trim() === DEFAULT_ARTICLE_TRANSLATION_PROMPT;
  const busy = savingFeature || savingKey || removingKey || savingPrompts || savingCustomPrompt;

  const updateFeature = async (nextProvider: AiProvider, nextModel: string) => {
    setSavingFeature(true);
    setError(null);
    try {
      onAiSettings(
        await mutateRequest(() =>
          api.updateAiFeature("article_summary", {
            provider: nextProvider,
            model: nextModel.trim(),
          }),
        ),
      );
      showToast("AI provider and model saved");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingFeature(false);
    }
  };

  const selectProvider = (nextProviderId: AiProvider) => {
    const nextProvider = aiSettings.providers.find((option) => option.id === nextProviderId);
    if (!nextProvider) return;
    setProviderId(nextProviderId);
    setModelId(
      activeFeature?.provider === nextProviderId ? activeFeature.model : nextProvider.defaultModel,
    );
    setApiKey("");
    setShowKey(false);
    setError(null);
    window.requestAnimationFrame(() => modelInputRef.current?.focus());
  };

  const saveModel = async (event: FormEvent) => {
    event.preventDefault();
    if (!modelId.trim()) return;
    await updateFeature(providerId, modelId);
  };

  const saveKey = async (event: FormEvent) => {
    event.preventDefault();
    const nextKey = apiKey.trim();
    const nextModel = modelId.trim();
    if (!nextKey || !nextModel) return;
    setSavingKey(true);
    setError(null);
    try {
      const keySettings = await runSensitive(() =>
        mutateRequest(() => api.saveAiProviderKey(providerId, nextKey)),
      );
      try {
        const updated = await mutateRequest(() =>
          api.updateAiFeature("article_summary", {
            provider: providerId,
            model: nextModel,
          }),
        );
        onAiSettings(updated);
        setApiKey("");
        setShowKey(false);
        showToast(`${provider.label} API key saved for summaries and translations`);
      } catch (caught) {
        onAiSettings(keySettings);
        throw caught;
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingKey(false);
    }
  };

  const removeKey = async () => {
    if (
      !window.confirm(
        `Remove the ${provider.label} API key from this device? Summaries and translations on this device will stop until you save another key.`,
      )
    ) {
      return;
    }
    setRemovingKey(true);
    setError(null);
    try {
      onAiSettings(
        await runSensitive(() => mutateRequest(() => api.deleteAiProviderKey(providerId))),
      );
      setApiKey("");
      setShowKey(false);
      showToast(`${provider.label} API key removed`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRemovingKey(false);
    }
  };

  const openPromptDialog = () => {
    setSummaryPrompt(settings.summaryPrompt);
    setTranslationPrompt(settings.translationPrompt);
    setPromptError(null);
    promptDialog.open();
  };

  const closePromptDialog = () => {
    if (!savingPrompts) promptDialog.close();
  };

  const savePrompts = async (event: FormEvent) => {
    event.preventDefault();
    const nextSummaryPrompt = summaryPrompt.trim();
    const nextTranslationPrompt = translationPrompt.trim();
    if (!nextSummaryPrompt || !nextTranslationPrompt || !promptsChanged) return;
    setSavingPrompts(true);
    setError(null);
    setPromptError(null);
    try {
      onSettings(
        await mutateRequest(() =>
          api.updateSettings({
            summaryPrompt: nextSummaryPrompt,
            translationPrompt: nextTranslationPrompt,
          }),
        ),
      );
      showToast("Default AI prompts saved");
      promptDialog.close();
    } catch (caught) {
      setPromptError(errorMessage(caught));
    } finally {
      setSavingPrompts(false);
    }
  };

  const openCustomPromptDialog = (prompt?: AiCustomPrompt) => {
    setEditingCustomPrompt(prompt ?? null);
    setCustomPromptName(prompt?.name ?? "");
    setCustomPromptText(prompt?.prompt ?? "");
    setCustomPromptError(null);
    customPromptDialog.open();
  };

  const closeCustomPromptDialog = () => {
    if (!savingCustomPrompt) customPromptDialog.close();
  };

  const saveCustomPrompt = async (event: FormEvent) => {
    event.preventDefault();
    const name = customPromptName.trim();
    const prompt = customPromptText.trim();
    if (!name || !prompt) return;
    const nextPrompt: AiCustomPrompt = {
      id: editingCustomPrompt?.id ?? crypto.randomUUID(),
      name,
      prompt,
    };
    const customPrompts = editingCustomPrompt
      ? settings.customPrompts.map((item) =>
          item.id === editingCustomPrompt.id ? nextPrompt : item,
        )
      : [...settings.customPrompts, nextPrompt];
    setSavingCustomPrompt(true);
    setCustomPromptError(null);
    try {
      onSettings(await mutateRequest(() => api.updateSettings({ customPrompts })));
      showToast(editingCustomPrompt ? "Custom prompt updated" : "Custom prompt added");
      customPromptDialog.close();
    } catch (caught) {
      setCustomPromptError(errorMessage(caught));
    } finally {
      setSavingCustomPrompt(false);
    }
  };

  const deleteCustomPrompt = async (prompt: AiCustomPrompt) => {
    if (!window.confirm(`Delete the custom prompt “${prompt.name}”?`)) return;
    setSavingCustomPrompt(true);
    setError(null);
    try {
      onSettings(
        await mutateRequest(() =>
          api.updateSettings({
            customPrompts: settings.customPrompts.filter((item) => item.id !== prompt.id),
          }),
        ),
      );
      showToast("Custom prompt deleted");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingCustomPrompt(false);
    }
  };

  return (
    <section
      id="ai-settings"
      className="settings-section ai-settings-section"
      aria-labelledby="ai-heading"
    >
      <div className="settings-heading">
        <div>
          <h2 id="ai-heading">AI</h2>
          <p>Choose the provider and model used for summaries, translations, and custom prompts.</p>
        </div>
        {busy ? (
          <span className="saving-label" role="status">
            <LoaderCircle className="spin" aria-hidden="true" size={15} />
            Saving
          </span>
        ) : null}
      </div>

      {!aiSettings.credentialStorageAvailable ? (
        <div className="ai-settings-warning" role="alert">
          <AlertTriangle aria-hidden="true" size={17} />
          <span>
            {isDesktopApp()
              ? "Secure API-key storage is unavailable on this Mac."
              : "Secure key storage is unavailable in this browser. Use HTTPS and allow site storage."}
          </span>
        </div>
      ) : null}

      <div className="setting-row">
        <label htmlFor="ai-summary-provider">
          <strong>Provider</strong>
          <p>The active provider runs every AI action.</p>
        </label>
        <div className="ai-provider-control">
          <DropdownSelect
            id="ai-summary-provider"
            value={providerId}
            disabled={busy || !aiSettings.credentialStorageAvailable}
            options={aiSettings.providers.map((option) => ({
              value: option.id,
              label: `${option.label}${option.configured ? " (key saved)" : ""}`,
            }))}
            onChange={(value) => selectProvider(value as AiProvider)}
          />
        </div>
      </div>

      <div className="setting-row">
        <label htmlFor="ai-summary-model">
          <strong>Model</strong>
          <p id="ai-summary-model-help">
            Enter the exact {provider.label} model ID. Default: <code>{provider.defaultModel}</code>
            .
          </p>
        </label>
        <form className="ai-model-form" onSubmit={(event) => void saveModel(event)}>
          <input
            ref={modelInputRef}
            id="ai-summary-model"
            type="text"
            value={modelId}
            placeholder={provider.defaultModel}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={200}
            required
            aria-describedby="ai-summary-model-help"
            disabled={busy || !aiSettings.credentialStorageAvailable}
            onChange={(event) => {
              setModelId(event.target.value);
              setError(null);
            }}
          />
          <button
            className="secondary-button"
            type="submit"
            disabled={
              !modelId.trim() || !modelChanged || busy || !aiSettings.credentialStorageAvailable
            }
          >
            {savingFeature ? <LoaderCircle className="spin" aria-hidden="true" size={15} /> : null}
            Save model
          </button>
        </form>
      </div>

      <div className="setting-row ai-key-row">
        <div>
          <strong>{provider.label} API key</strong>
          <p id="ai-api-key-help">
            {provider.configured
              ? "A key is saved on this device. Enter a new key only if you want to replace it."
              : isDesktopApp()
                ? "Your key is protected by this Mac’s Keychain."
                : "Your browser encrypts this key before saving it. AI works automatically here; enter the key again on another browser or after signing out."}
          </p>
        </div>
        <form className="ai-key-form" onSubmit={(event) => void saveKey(event)}>
          <div className="ai-key-input">
            <label className="sr-only" htmlFor="ai-api-key">
              {provider.label} API key
            </label>
            <input
              ref={keyInputRef}
              id="ai-api-key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              placeholder={provider.configured ? "Paste a replacement key" : "Paste API key"}
              autoComplete="new-password"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="ai-api-key-help"
              disabled={busy || !aiSettings.credentialStorageAvailable}
              onChange={(event) => {
                setApiKey(event.target.value);
                setError(null);
              }}
            />
            <button
              className="icon-button"
              type="button"
              disabled={!apiKey || busy}
              aria-label={showKey ? "Hide API key" : "Show API key"}
              aria-pressed={showKey}
              onClick={() => setShowKey((current) => !current)}
            >
              {showKey ? (
                <EyeOff aria-hidden="true" size={16} />
              ) : (
                <Eye aria-hidden="true" size={16} />
              )}
            </button>
          </div>
          <button
            className="primary-button"
            type="submit"
            disabled={
              !apiKey.trim() || !modelId.trim() || busy || !aiSettings.credentialStorageAvailable
            }
          >
            {savingKey ? <LoaderCircle className="spin" aria-hidden="true" size={15} /> : null}
            {provider.configured ? "Replace key" : "Save key"}
          </button>
          {provider.configured ? (
            <button
              className="secondary-button ai-key-remove"
              type="button"
              disabled={busy || !aiSettings.credentialStorageAvailable}
              onClick={() => void removeKey()}
            >
              Remove key
            </button>
          ) : null}
        </form>
      </div>

      {error ? (
        <div className="ai-settings-error" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="setting-row">
        <div>
          <strong>Default prompts</strong>
          <p>Set the instructions used by the Summarize and Translate actions.</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={openPromptDialog}
        >
          <Edit3 aria-hidden="true" size={15} />
          Edit defaults
        </button>
      </div>

      <div className="custom-prompts-setting">
        <div className="custom-prompts-heading">
          <div>
            <strong>Custom prompts</strong>
            <p>Add named instructions that you can run from an article's AI menu.</p>
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => openCustomPromptDialog()}
          >
            <Plus aria-hidden="true" size={15} />
            Add prompt
          </button>
        </div>
        {settings.customPrompts.length > 0 ? (
          <ul className="custom-prompt-list">
            {settings.customPrompts.map((prompt) => (
              <li className="custom-prompt-list-item" key={prompt.id}>
                <div>
                  <strong>{prompt.name}</strong>
                  <p>{prompt.prompt}</p>
                </div>
                <div className="custom-prompt-actions">
                  <button
                    className="icon-button"
                    type="button"
                    disabled={busy}
                    aria-label={`Edit ${prompt.name}`}
                    onClick={() => openCustomPromptDialog(prompt)}
                  >
                    <Edit3 aria-hidden="true" size={15} />
                  </button>
                  <button
                    className="icon-button danger-action"
                    type="button"
                    disabled={busy}
                    aria-label={`Delete ${prompt.name}`}
                    onClick={() => void deleteCustomPrompt(prompt)}
                  >
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="custom-prompts-empty">
            No custom prompts. Add one to create another article action.
          </p>
        )}
      </div>

      <Modal
        dialog={promptDialog}
        initialFocus={summaryPromptRef}
        className="management-dialog is-wide ai-prompt-dialog"
        aria-labelledby="ai-prompt-dialog-title"
        dismissible={!savingPrompts}
      >
        <form className="ai-prompt-dialog-form" onSubmit={(event) => void savePrompts(event)}>
          <header className="management-dialog-heading">
            <span className="dialog-icon" aria-hidden="true">
              <Edit3 size={16} />
            </span>
            <div>
              <h2 id="ai-prompt-dialog-title">Edit default prompts</h2>
              <p>Edit the instructions behind the Summarize and Translate actions.</p>
            </div>
            <button
              className="icon-button"
              type="button"
              disabled={savingPrompts}
              onClick={closePromptDialog}
              aria-label="Close prompt editor"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </header>

          <div className="management-dialog-body ai-prompt-dialog-body">
            <label className="ai-prompt-field" htmlFor="ai-summary-prompt">
              <span>Summary prompt</span>
              <p id="ai-summary-prompt-help">
                Controls the structure, detail, and tone of summaries.
              </p>
              <textarea
                ref={summaryPromptRef}
                id="ai-summary-prompt"
                value={summaryPrompt}
                rows={12}
                maxLength={AI_PROMPT_MAX_LENGTH}
                required
                disabled={savingPrompts}
                aria-describedby="ai-summary-prompt-help"
                onChange={(event) => {
                  setSummaryPrompt(event.target.value);
                  setPromptError(null);
                }}
              />
            </label>
            <label className="ai-prompt-field" htmlFor="ai-translation-prompt">
              <span>Translation prompt</span>
              <p id="ai-translation-prompt-help">
                Keep the JSON and data-translation-id requirements so translated articles can be
                rebuilt.
              </p>
              <textarea
                id="ai-translation-prompt"
                value={translationPrompt}
                rows={12}
                maxLength={AI_PROMPT_MAX_LENGTH}
                required
                disabled={savingPrompts}
                aria-describedby="ai-translation-prompt-help"
                onChange={(event) => {
                  setTranslationPrompt(event.target.value);
                  setPromptError(null);
                }}
              />
            </label>

            {promptError ? (
              <div className="management-dialog-error" role="alert">
                <AlertTriangle aria-hidden="true" size={16} />
                <span>{promptError}</span>
              </div>
            ) : null}
          </div>

          <footer className="management-dialog-footer">
            <button
              className="secondary-button"
              type="button"
              disabled={savingPrompts || defaultPromptsSelected}
              onClick={() => {
                setSummaryPrompt(DEFAULT_ARTICLE_SUMMARY_PROMPT);
                setTranslationPrompt(DEFAULT_ARTICLE_TRANSLATION_PROMPT);
                setPromptError(null);
              }}
            >
              Restore defaults
            </button>
            <div>
              <button
                className="secondary-button"
                type="button"
                disabled={savingPrompts}
                onClick={closePromptDialog}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={
                  savingPrompts ||
                  !summaryPrompt.trim() ||
                  !translationPrompt.trim() ||
                  !promptsChanged
                }
              >
                {savingPrompts ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={15} />
                ) : null}
                Save prompts
              </button>
            </div>
          </footer>
        </form>
      </Modal>

      <Modal
        dialog={customPromptDialog}
        initialFocus={customPromptNameRef}
        className="management-dialog custom-prompt-dialog"
        aria-labelledby="custom-prompt-dialog-title"
        dismissible={!savingCustomPrompt}
      >
        <form className="custom-prompt-form" onSubmit={(event) => void saveCustomPrompt(event)}>
          <header className="management-dialog-heading">
            <span className="dialog-icon" aria-hidden="true">
              <MessageSquareText size={16} />
            </span>
            <div>
              <h2 id="custom-prompt-dialog-title">
                {editingCustomPrompt ? "Edit custom prompt" : "Add custom prompt"}
              </h2>
              <p>Write the task only. feedfold adds the article title and text.</p>
            </div>
            <button
              className="icon-button"
              type="button"
              disabled={savingCustomPrompt}
              onClick={closeCustomPromptDialog}
              aria-label="Close custom prompt editor"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </header>

          <div className="management-dialog-body custom-prompt-dialog-body">
            <label htmlFor="custom-prompt-name">
              <span>Name</span>
              <p id="custom-prompt-name-help">This name appears in the article's AI menu.</p>
              <input
                ref={customPromptNameRef}
                id="custom-prompt-name"
                type="text"
                value={customPromptName}
                maxLength={80}
                required
                disabled={savingCustomPrompt}
                aria-describedby="custom-prompt-name-help"
                onChange={(event) => {
                  setCustomPromptName(event.target.value);
                  setCustomPromptError(null);
                }}
              />
            </label>
            <label htmlFor="custom-prompt-text">
              <span>Prompt</span>
              <p id="custom-prompt-text-help">
                Tell the AI how to analyze or transform the article.
              </p>
              <textarea
                id="custom-prompt-text"
                value={customPromptText}
                rows={10}
                maxLength={AI_PROMPT_MAX_LENGTH}
                required
                disabled={savingCustomPrompt}
                aria-describedby="custom-prompt-text-help"
                onChange={(event) => {
                  setCustomPromptText(event.target.value);
                  setCustomPromptError(null);
                }}
              />
            </label>
            {customPromptError ? (
              <div className="management-dialog-error" role="alert">
                <AlertTriangle aria-hidden="true" size={16} />
                <span>{customPromptError}</span>
              </div>
            ) : null}
          </div>

          <footer className="management-dialog-footer">
            <span />
            <div>
              <button
                className="secondary-button"
                type="button"
                disabled={savingCustomPrompt}
                onClick={closeCustomPromptDialog}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={
                  savingCustomPrompt || !customPromptName.trim() || !customPromptText.trim()
                }
              >
                {savingCustomPrompt ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={15} />
                ) : null}
                {editingCustomPrompt ? "Save prompt" : "Add prompt"}
              </button>
            </div>
          </footer>
        </form>
      </Modal>
    </section>
  );
}
