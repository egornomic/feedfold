import { startAuthentication } from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, KeyRound, LoaderCircle, X } from "lucide-react";
import { type FormEvent, useCallback, useRef, useState } from "react";
import { ApiError, api, errorMessage } from "../../api/api";
import { useRequestMutation } from "../../api/use-request-mutation";
import { Modal, useDialog } from "../../ui/dialog";

export type SensitiveAction = <T>(action: () => Promise<T>) => Promise<T>;

interface PendingSensitiveAction {
  operationId: string;
  action: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export function useSensitiveAction() {
  const { run: mutateRequest } = useRequestMutation();
  const queryClient = useQueryClient();
  const [pendingSensitive, setPendingSensitive] = useState<PendingSensitiveAction | null>(null);
  const [stepUpPassword, setStepUpPassword] = useState("");
  const [stepUpBusy, setStepUpBusy] = useState(false);
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [stepUpHasPassword, setStepUpHasPassword] = useState(false);
  const [stepUpHasPasskey, setStepUpHasPasskey] = useState(false);
  const stepUpDialog = useDialog(() => cancelStepUp(), { autoOpen: false });
  const stepUpPasswordRef = useRef<HTMLInputElement>(null);

  const runSensitive = useCallback<SensitiveAction>(
    async <T,>(action: () => Promise<T>) => {
      try {
        return await action();
      } catch (caught) {
        if (
          !(caught instanceof ApiError) ||
          caught.code !== "RECENT_AUTH_REQUIRED" ||
          !caught.operationId
        )
          throw caught;
        const credentials = await queryClient.fetchQuery({
          queryKey: ["passkeys"],
          queryFn: api.passkeys,
          staleTime: 0,
        });
        setStepUpHasPassword(credentials.hasPassword);
        setStepUpHasPasskey(credentials.passkeys.length > 0);
        setStepUpPassword("");
        setStepUpError(null);
        return await new Promise<T>((resolve, reject) => {
          setPendingSensitive({
            operationId: caught.operationId as string,
            action,
            resolve: resolve as (value: unknown) => void,
            reject,
          });
          stepUpDialog.open();
        });
      }
    },
    [stepUpDialog.open, queryClient.fetchQuery],
  );

  const finishStepUp = async (authenticate: () => Promise<void>) => {
    const pending = pendingSensitive;
    if (!pending) return;
    setStepUpBusy(true);
    setStepUpError(null);
    try {
      await authenticate();
      const result = await pending.action();
      pending.resolve(result);
      setPendingSensitive(null);
      setStepUpPassword("");
      stepUpDialog.close();
    } catch (caught) {
      setStepUpError(errorMessage(caught));
    } finally {
      setStepUpBusy(false);
    }
  };

  const authenticateWithPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!pendingSensitive || !stepUpPassword) return;
    await finishStepUp(() =>
      mutateRequest(() => api.stepUpPassword(pendingSensitive.operationId, stepUpPassword)),
    );
  };

  const authenticateWithPasskey = async () => {
    if (!pendingSensitive) return;
    await finishStepUp(async () => {
      const { ceremonyId, options } = await mutateRequest(() =>
        api.stepUpPasskeyOptions(pendingSensitive.operationId),
      );
      const response = await startAuthentication({ optionsJSON: options });
      await mutateRequest(() => api.stepUpPasskey(ceremonyId, response));
    });
  };

  const cancelStepUp = () => {
    if (stepUpBusy) return;
    pendingSensitive?.reject(new DOMException("Authentication was cancelled.", "AbortError"));
    setPendingSensitive(null);
    setStepUpPassword("");
    stepUpDialog.close();
  };

  return {
    runSensitive,
    authenticationDialog: (
      <Modal
        dialog={stepUpDialog}
        initialFocus={stepUpPasswordRef}
        className="management-dialog passkey-dialog"
        aria-labelledby="step-up-dialog-title"
        dismissible={!stepUpBusy}
      >
        <form
          className="passkey-dialog-form"
          onSubmit={(event) => void authenticateWithPassword(event)}
        >
          <header className="management-dialog-heading">
            <span className="dialog-icon" aria-hidden="true">
              <KeyRound size={16} />
            </span>
            <div>
              <h2 id="step-up-dialog-title">Authenticate to continue</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              disabled={stepUpBusy}
              onClick={cancelStepUp}
              aria-label="Close authentication"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </header>
          <div className="management-dialog-body passkey-dialog-body">
            {stepUpHasPassword ? (
              <label className="passkey-dialog-field" htmlFor="step-up-password">
                <span>Password</span>
                <input
                  ref={stepUpPasswordRef}
                  id="step-up-password"
                  type="password"
                  autoComplete="current-password"
                  value={stepUpPassword}
                  maxLength={128}
                  required
                  disabled={stepUpBusy}
                  onChange={(event) => {
                    setStepUpPassword(event.target.value);
                    setStepUpError(null);
                  }}
                />
              </label>
            ) : null}
            {stepUpHasPasskey ? (
              <button
                className="secondary-button"
                type="button"
                disabled={stepUpBusy}
                onClick={() => void authenticateWithPasskey()}
              >
                <KeyRound aria-hidden="true" size={15} />
                Use a passkey
              </button>
            ) : null}
            {stepUpError ? (
              <div className="management-dialog-error" role="alert">
                <AlertTriangle aria-hidden="true" size={16} />
                <span>{stepUpError}</span>
              </div>
            ) : null}
          </div>
          <footer className="management-dialog-footer">
            <span />
            <div>
              <button
                className="secondary-button"
                type="button"
                disabled={stepUpBusy}
                onClick={cancelStepUp}
              >
                Cancel
              </button>
              {stepUpHasPassword ? (
                <button
                  className="primary-button"
                  type="submit"
                  disabled={stepUpBusy || !stepUpPassword}
                >
                  {stepUpBusy ? (
                    <LoaderCircle className="spin" aria-hidden="true" size={15} />
                  ) : null}
                  Continue
                </button>
              ) : null}
            </div>
          </footer>
        </form>
      </Modal>
    ),
  };
}
