import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, KeyRound, LoaderCircle, Pencil, Trash2, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../api/api";
import { useRequestMutation } from "../../api/use-request-mutation";
import { Modal, useDialog } from "../../ui/dialog";
import { clearReaderPreferences } from "../reader/reader-preferences";
import type { SensitiveAction } from "./settings-security";

export function AccountSettingsSection({
  userId,
  onAccountDeleted,
  showToast,
  runSensitive,
}: {
  userId: string;
  onAccountDeleted: () => void;
  showToast: (message: string) => void;
  runSensitive: SensitiveAction;
}) {
  const { run: mutateRequest } = useRequestMutation();
  const client = useQueryClient();
  const credentials = useQuery({ queryKey: ["passkeys"], queryFn: api.passkeys });
  const config = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const passkeys = credentials.data?.passkeys ?? [];
  const hasPassword = credentials.data?.hasPassword ?? false;
  const passkeysAvailable = !!config.data?.passkeysAvailable && browserSupportsWebAuthn();
  const loadingPasskeys = credentials.isPending || config.isPending;
  const setPasskeys = (update: (current: typeof passkeys) => typeof passkeys) =>
    client.setQueryData(
      ["passkeys"],
      (current: Awaited<ReturnType<typeof api.passkeys>> | undefined) =>
        current ? { ...current, passkeys: update(current.passkeys) } : current,
    );
  const setHasPassword = (hasPassword: boolean) =>
    client.setQueryData(
      ["passkeys"],
      (current: Awaited<ReturnType<typeof api.passkeys>> | undefined) =>
        current ? { ...current, hasPassword } : current,
    );
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null);
  const [passkeyName, setPasskeyName] = useState("");
  const [renamingPasskey, setRenamingPasskey] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountDeleteError, setAccountDeleteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passkeyNameRef = useRef<HTMLInputElement>(null);
  const resetAccountDialog = useCallback(() => setAccountDeleteError(null), []);
  const accountDialog = useDialog(resetAccountDialog, { autoOpen: false });

  useEffect(() => {
    if (credentials.error || config.error)
      setError(errorMessage(credentials.error ?? config.error));
  }, [credentials.error, config.error]);

  const addPasskey = async () => {
    setEditingPasskeyId(null);
    setPasskeyBusy(true);
    setError(null);
    try {
      const passkey = await runSensitive(async () => {
        const { ceremonyId, options } = await mutateRequest(() => api.passkeyRegistrationOptions());
        const response = await startRegistration({ optionsJSON: options });
        return (await mutateRequest(() => api.registerPasskey(ceremonyId, response))).passkey;
      });
      setPasskeys((current) => [passkey, ...current]);
      showToast("Passkey added");
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "NotAllowedError")) {
        setError(errorMessage(caught));
      }
    } finally {
      setPasskeyBusy(false);
    }
  };

  const startRenamingPasskey = (id: string, name: string) => {
    setEditingPasskeyId(id);
    setPasskeyName(name);
    setError(null);
    window.requestAnimationFrame(() => {
      passkeyNameRef.current?.focus();
      passkeyNameRef.current?.select();
    });
  };

  const cancelRenamingPasskey = () => {
    if (renamingPasskey) return;
    setEditingPasskeyId(null);
    setPasskeyName("");
  };

  const renamePasskey = async (event: FormEvent, id: string, currentName: string) => {
    event.preventDefault();
    const name = passkeyName.trim();
    if (!name) return;
    if (name === currentName) {
      cancelRenamingPasskey();
      return;
    }
    setRenamingPasskey(true);
    setError(null);
    try {
      const { passkey } = await mutateRequest(() => api.renamePasskey(id, name));
      setPasskeys((current) => current.map((item) => (item.id === id ? passkey : item)));
      setEditingPasskeyId(null);
      setPasskeyName("");
      showToast("Passkey renamed");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRenamingPasskey(false);
    }
  };

  const removePasskey = async (id: string) => {
    setPasskeyBusy(true);
    setError(null);
    try {
      await runSensitive(() => mutateRequest(() => api.deletePasskey(id)));
      setPasskeys((current) => current.filter((passkey) => passkey.id !== id));
      showToast("Passkey removed");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPasskeyBusy(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    setChangingPassword(true);
    setError(null);
    try {
      await runSensitive(() => mutateRequest(() => api.changePassword(newPassword)));
      setHasPassword(true);
      setNewPassword("");
      setConfirmPassword("");
      showToast("Password changed. Other sessions were signed out");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setChangingPassword(false);
    }
  };

  const removePassword = async () => {
    setChangingPassword(true);
    setError(null);
    try {
      await runSensitive(() => mutateRequest(() => api.removePassword()));
      setHasPassword(false);
      setNewPassword("");
      setConfirmPassword("");
      showToast("Password removed");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setChangingPassword(false);
    }
  };

  const closeAccountDialog = () => {
    if (!deletingAccount) accountDialog.close();
  };

  const deleteAccount = async (event: FormEvent) => {
    event.preventDefault();
    setDeletingAccount(true);
    setAccountDeleteError(null);
    try {
      await runSensitive(() => mutateRequest(() => api.deleteAccount()));
      clearReaderPreferences(userId);
      onAccountDeleted();
    } catch (caught) {
      setAccountDeleteError(errorMessage(caught));
      setDeletingAccount(false);
    }
  };

  return (
    <section
      className="settings-section account-settings-section"
      aria-labelledby="account-heading"
    >
      <div className="settings-heading">
        <h2 id="account-heading">Account security</h2>
        <p>Manage the credentials you use to sign in.</p>
      </div>
      <div className="account-setting-block">
        <div className="account-setting-heading">
          <div>
            <strong>Passkeys</strong>
            <p>Use your device lock, fingerprint, face, or security key instead of a password.</p>
          </div>
          <div className="settings-item-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={!passkeysAvailable || loadingPasskeys || passkeyBusy}
              onClick={() => void addPasskey()}
            >
              {passkeyBusy ? (
                <LoaderCircle className="spin" aria-hidden="true" size={15} />
              ) : (
                <KeyRound aria-hidden="true" size={15} />
              )}
              Add passkey
            </button>
          </div>
        </div>
        {!loadingPasskeys && !passkeysAvailable ? (
          <p className="account-setting-note">Passkeys require a supported browser and HTTPS.</p>
        ) : null}
        {passkeys.length > 0 ? (
          <ul className="settings-item-list">
            {passkeys.map((passkey) => (
              <li key={passkey.id}>
                <div className="settings-item-copy">
                  {editingPasskeyId === passkey.id ? (
                    <form
                      className="passkey-rename-form"
                      onSubmit={(event) => void renamePasskey(event, passkey.id, passkey.name)}
                    >
                      <label className="sr-only" htmlFor={`passkey-name-${passkey.id}`}>
                        Passkey name
                      </label>
                      <input
                        ref={passkeyNameRef}
                        id={`passkey-name-${passkey.id}`}
                        type="text"
                        value={passkeyName}
                        maxLength={80}
                        required
                        disabled={renamingPasskey}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape") return;
                          event.preventDefault();
                          cancelRenamingPasskey();
                        }}
                        onChange={(event) => setPasskeyName(event.target.value)}
                      />
                      <button
                        className="icon-button passkey-save-name"
                        type="submit"
                        aria-label="Save passkey name"
                        disabled={renamingPasskey || !passkeyName.trim()}
                      >
                        {renamingPasskey ? (
                          <LoaderCircle className="spin" aria-hidden="true" size={15} />
                        ) : (
                          <Check aria-hidden="true" size={15} />
                        )}
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label="Cancel renaming passkey"
                        disabled={renamingPasskey}
                        onClick={cancelRenamingPasskey}
                      >
                        <X aria-hidden="true" size={15} />
                      </button>
                    </form>
                  ) : (
                    <strong title={passkey.name}>{passkey.name}</strong>
                  )}
                  <p>
                    Added {new Date(passkey.createdAt).toLocaleDateString()}
                    {passkey.lastUsedAt
                      ? ` · Last used ${new Date(passkey.lastUsedAt).toLocaleDateString()}`
                      : " · Never used"}
                  </p>
                </div>
                {editingPasskeyId === passkey.id ? null : (
                  <div className="passkey-item-actions">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Rename ${passkey.name}`}
                      disabled={passkeyBusy || renamingPasskey}
                      onClick={() => startRenamingPasskey(passkey.id, passkey.name)}
                    >
                      <Pencil aria-hidden="true" size={15} />
                    </button>
                    {hasPassword || passkeys.length > 1 ? (
                      <button
                        className="icon-button danger-action"
                        type="button"
                        aria-label={`Remove ${passkey.name}`}
                        disabled={passkeyBusy || renamingPasskey}
                        onClick={() => void removePasskey(passkey.id)}
                      >
                        <Trash2 aria-hidden="true" size={15} />
                      </button>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <form
        className="account-setting-block password-change-form"
        onSubmit={(event) => void changePassword(event)}
      >
        <div>
          <strong>{hasPassword ? "Change password" : "Add password"}</strong>
          <p>Use at least 15 characters.</p>
        </div>
        <div className="password-change-fields">
          <label>
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              minLength={15}
              maxLength={128}
              required
              disabled={changingPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label>
            <span>Confirm new password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              minLength={15}
              maxLength={128}
              required
              disabled={changingPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          <button
            className="secondary-button"
            type="submit"
            disabled={
              changingPassword || newPassword.length < 15 || newPassword !== confirmPassword
            }
          >
            {changingPassword ? (
              <LoaderCircle className="spin" aria-hidden="true" size={15} />
            ) : null}
            {hasPassword ? "Change password" : "Add password"}
          </button>
          {hasPassword && passkeys.length > 0 ? (
            <button
              className="danger-button"
              type="button"
              disabled={changingPassword}
              onClick={() => void removePassword()}
            >
              Remove password
            </button>
          ) : null}
        </div>
      </form>
      <div className="account-setting-block account-delete-setting">
        <div>
          <strong>Delete account</strong>
          <p>Permanently delete your subscriptions, reading state, passkeys, and saved API keys.</p>
        </div>
        <button className="danger-button" type="button" onClick={accountDialog.open}>
          <Trash2 aria-hidden="true" size={15} />
          Delete account
        </button>
      </div>
      {error ? (
        <div className="ai-settings-error" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>{error}</span>
        </div>
      ) : null}
      <Modal
        dialog={accountDialog}
        className="management-dialog passkey-dialog"
        aria-labelledby="account-delete-dialog-title"
        dismissible={!deletingAccount}
      >
        <form className="passkey-dialog-form" onSubmit={(event) => void deleteAccount(event)}>
          <header className="management-dialog-heading">
            <span className="dialog-icon" aria-hidden="true">
              <Trash2 size={16} />
            </span>
            <div>
              <h2 id="account-delete-dialog-title">Delete account</h2>
              <p>This cannot be undone. Every browser will be signed out.</p>
            </div>
            <button
              className="icon-button"
              type="button"
              disabled={deletingAccount}
              onClick={closeAccountDialog}
              aria-label="Close account deletion"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </header>
          <div className="management-dialog-body passkey-dialog-body">
            <p className="account-delete-warning">
              This permanently deletes this account and all private data.
            </p>
            {accountDeleteError ? (
              <div className="management-dialog-error" role="alert">
                <AlertTriangle aria-hidden="true" size={16} />
                <span>{accountDeleteError}</span>
              </div>
            ) : null}
          </div>
          <footer className="management-dialog-footer">
            <span />
            <div>
              <button
                className="secondary-button"
                type="button"
                disabled={deletingAccount}
                onClick={closeAccountDialog}
              >
                Cancel
              </button>
              <button className="danger-button" type="submit" disabled={deletingAccount}>
                {deletingAccount ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={15} />
                ) : null}
                Delete account
              </button>
            </div>
          </footer>
        </form>
      </Modal>
    </section>
  );
}
