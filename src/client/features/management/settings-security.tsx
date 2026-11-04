import { startAuthentication } from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, KeyRound, LoaderCircle, X } from "lucide-react";
import { type FormEvent, useCallback, useRef, useState } from "react";
import { ApiError, api, errorMessage } from "../../api/api";
import { useRequestMutation } from "../../api/use-request-mutation";
import { Modal, useDialog } from "../../ui/dialog";

export type SensitiveAction = <T>(action: () => Promise<T>) => Promise<T>;

interface StepUpRequest {
  operationId: string;
  action: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  hasPassword: boolean;
  hasPasskey: boolean;
}

type StepUpState =
  | { phase: "idle" }
  | { phase: "asking"; request: StepUpRequest; error: string | null }
  | { phase: "checking"; request: StepUpRequest };

export function useSensitiveAction() {
  const { run: mutateRequest } = useRequestMutation();
  const queryClient = useQueryClient();
  const [stepUp, setStepUp] = useState<StepUpState>({ phase: "idle" });
  const [stepUpPassword, setStepUpPassword] = useState("");
  const stepUpDialog = useDialog(() => cancelStepUp(), { autoOpen: false });
  const stepUpPasswordRef = useRef<HTMLInputElement>(null);
  const request = stepUp.phase === "idle" ? null : stepUp.request;
  const checking = stepUp.phase === "checking";
  const stepUpError = stepUp.phase === "asking" ? stepUp.error : null;

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
        setStepUpPassword("");
        return await new Promise<T>((resolve, reject) => {
          setStepUp({
            phase: "asking",
            request: {
              operationId: caught.operationId as string,
              action,
              resolve: resolve as (value: unknown) => void,
              reject,
              hasPassword: credentials.hasPassword,
              hasPasskey: credentials.passkeys.length > 0,
            },
            error: null,
          });
          stepUpDialog.open();
        });
      }
    },
    [stepUpDialog.open, queryClient.fetchQuery],
  );

  const finishStepUp = async (authenticate: (request: StepUpRequest) => Promise<void>) => {
    if (stepUp.phase !== "asking") return;
    const { request } = stepUp;
    setStepUp({ phase: "checking", request });
    try {
      await authenticate(request);
      request.resolve(await request.action());
      setStepUp({ phase: "idle" });
      setStepUpPassword("");
      stepUpDialog.close();
    } catch (caught) {
      setStepUp({ phase: "asking", request, error: errorMessage(caught) });
    }
  };

  const authenticateWithPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!stepUpPassword) return;
    await finishStepUp((request) =>
      mutateRequest(() => api.stepUpPassword(request.operationId, stepUpPassword)),
    );
  };

  const authenticateWithPasskey = async () => {
    await finishStepUp(async (request) => {
      const { ceremonyId, options } = await mutateRequest(() =>
        api.stepUpPasskeyOptions(request.operationId),
      );
      const response = await startAuthentication({ optionsJSON: options });
      await mutateRequest(() => api.stepUpPasskey(ceremonyId, response));
    });
  };

  const cancelStepUp = () => {
    if (stepUp.phase !== "asking") return;
    stepUp.request.reject(new DOMException("Authentication was cancelled.", "AbortError"));
    setStepUp({ phase: "idle" });
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
        dismissible={!checking}
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
              disabled={checking}
              onClick={cancelStepUp}
              aria-label="Close authentication"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </header>
          <div className="management-dialog-body passkey-dialog-body">
            {request?.hasPassword ? (
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
                  disabled={checking}
                  onChange={(event) => {
                    setStepUpPassword(event.target.value);
                    setStepUp((current) =>
                      current.phase === "asking" ? { ...current, error: null } : current,
                    );
                  }}
                />
              </label>
            ) : null}
            {request?.hasPasskey ? (
              <button
                className="secondary-button"
                type="button"
                disabled={checking}
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
                disabled={checking}
                onClick={cancelStepUp}
              >
                Cancel
              </button>
              {request?.hasPassword ? (
                <button
                  className="primary-button"
                  type="submit"
                  disabled={checking || !stepUpPassword}
                >
                  {checking ? <LoaderCircle className="spin" aria-hidden="true" size={15} /> : null}
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
