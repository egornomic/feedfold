import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, LoaderCircle, LogIn, UserPlus, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  INVITE_CODE_INPUT_MAX_LENGTH,
  INVITE_CODE_LENGTH,
  INVITE_CODE_PATTERN_SOURCE,
  normalizeInviteCode,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN_SOURCE,
} from "../../../shared/auth.js";
import type { SessionUser } from "../../../shared/types.js";
import { AUTH_REQUIRED_EVENT, api, appUrl, errorMessage } from "../../api/api.js";
import { useRequestMutation } from "../../api/use-request-mutation.js";
import { BrandIdentity } from "../../ui/brand.js";
import { Modal, useDialog } from "../../ui/dialog.js";
import { Onboarding } from "./onboarding.js";
import { finishOnboarding, saveOnboardingStep } from "./onboarding-state.js";

export function SessionLoading() {
  return (
    <main className="auth-page" aria-busy="true">
      <div className="session-loading" role="status" aria-label="Opening feedfold">
        <BrandIdentity decorative loading />
      </div>
    </main>
  );
}

export function AuthLegalLinks() {
  return (
    <nav className="auth-legal" aria-label="Legal">
      <a href={appUrl("/privacy")}>privacy</a>
      <a href={appUrl("/terms")}>terms</a>
    </nav>
  );
}

type AuthMode = "login" | "register";

type AuthStage =
  | {
      kind: "form";
      mode: AuthMode;
      pending: "password" | "passkey" | null;
      error: string | null;
    }
  | { kind: "onboarding"; user: SessionUser };

type AuthForm = Extract<AuthStage, { kind: "form" }>;

export function LoginDialog({
  onAuthenticated,
  onDismiss,
  onReady,
  initialOnboardingUser,
}: {
  onAuthenticated: (user: SessionUser) => void;
  onDismiss: () => void;
  onReady: () => void;
  initialOnboardingUser?: SessionUser | undefined;
}) {
  const { run: mutateRequest } = useRequestMutation();
  const [stage, setStage] = useState<AuthStage>(() =>
    initialOnboardingUser
      ? { kind: "onboarding", user: initialOnboardingUser }
      : {
          kind: "form",
          mode: window.location.pathname.replace(/\/$/, "").endsWith("/join")
            ? "register"
            : "login",
          pending: null,
          error: null,
        },
  );
  const [inviteCode, setInviteCode] = useState(() =>
    window.location.pathname.replace(/\/$/, "").endsWith("/join")
      ? normalizeInviteCode(window.location.hash.slice(1))
      : "",
  );
  const config = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const registrationMode = config.data?.registrationMode ?? "closed";
  const configLoaded = !!initialOnboardingUser || !config.isPending;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const setupUser = stage.kind === "onboarding" ? stage.user : null;
  const form = stage.kind === "form" ? stage : null;
  const mode = form?.mode ?? "login";
  const error = form?.error ?? null;
  const submitting = form?.pending === "password";
  const usingPasskey = form?.pending === "passkey";
  const updateForm = useCallback(
    (change: Partial<AuthForm>) =>
      setStage((current) => (current.kind === "form" ? { ...current, ...change } : current)),
    [],
  );
  const registrationAvailable = config.data?.registrationAvailable ?? false;
  const passkeysAvailable = !!config.data?.passkeysAvailable && browserSupportsWebAuthn();
  const dialog = useDialog(
    () => {
      if (setupUser) {
        finishOnboarding(setupUser.id);
        window.history.replaceState(null, "", appUrl("/"));
        onAuthenticated(setupUser);
      } else onDismiss();
    },
    {
      autoOpen: configLoaded,
    },
  );

  const { close } = dialog;

  useEffect(() => {
    const requireAuthentication = () => {
      setStage({
        kind: "form",
        mode: "login",
        pending: null,
        error: "Your session has ended. Sign in to continue.",
      });
      setPassword("");
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, requireAuthentication);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, requireAuthentication);
  }, []);

  useEffect(() => {
    if (config.data && !config.data.registrationAvailable) updateForm({ mode: "login" });
    if (config.error) updateForm({ error: errorMessage(config.error) });
  }, [config.data, config.error, updateForm]);

  useEffect(() => {
    if (configLoaded) onReady();
  }, [configLoaded, onReady]);

  const authenticated = (user: SessionUser, created = false) => {
    if (window.location.pathname.replace(/\/$/, "").endsWith("/join")) {
      window.history.replaceState(null, "", appUrl("/"));
    }
    if (created) {
      saveOnboardingStep(user.id, "feeds");
      setPassword("");
      setStage({ kind: "onboarding", user });
    } else onAuthenticated(user);
  };

  const attempt = async (
    pending: "password" | "passkey",
    action: () => Promise<void>,
    cancelledMessage?: string,
  ) => {
    updateForm({ pending, error: null });
    try {
      await action();
      updateForm({ pending: null });
    } catch (caught) {
      updateForm({
        pending: null,
        error:
          cancelledMessage && caught instanceof DOMException && caught.name === "NotAllowedError"
            ? cancelledMessage
            : errorMessage(caught),
      });
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void attempt("password", async () =>
      authenticated(
        mode === "login"
          ? await mutateRequest(() => api.login(username, password))
          : await mutateRequest(() => api.register(username, password, inviteCode)),
        mode === "register",
      ),
    );
  };

  const switchMode = () => {
    updateForm({ mode: mode === "login" ? "register" : "login", error: null });
    setPassword("");
  };

  const signInWithPasskey = () =>
    attempt(
      "passkey",
      async () => {
        const { ceremonyId, options } = await mutateRequest(() =>
          api.passkeyAuthenticationOptions(),
        );
        const response = await startAuthentication({ optionsJSON: options });
        authenticated(await mutateRequest(() => api.passkeyLogin(ceremonyId, response)));
      },
      "Passkey sign-in was cancelled or timed out.",
    );

  const createAccountWithPasskey = () =>
    attempt(
      "passkey",
      async () => {
        const { registrationId, options } = await mutateRequest(() =>
          api.passkeySignupOptions(username, inviteCode),
        );
        const response = await startRegistration({ optionsJSON: options });
        authenticated(
          await mutateRequest(() => api.completePasskeySignup(registrationId, response)),
          true,
        );
      },
      "Passkey creation was cancelled or timed out.",
    );

  const registering = mode === "register";
  const actionLabel = registering ? "Create account" : "Sign in";
  const progressLabel = registering ? "Creating account" : "Signing in";
  const ActionIcon = registering ? UserPlus : LogIn;

  return (
    <Modal
      dialog={dialog}
      outsideDismiss
      dismissible={!setupUser}
      className={`login-dialog${setupUser ? " onboarding-dialog" : ""}`}
      aria-labelledby="auth-heading"
    >
      <section className="login-panel" aria-labelledby="auth-heading">
        {!setupUser ? (
          <div className="login-topbar">
            <BrandIdentity className="login-brand" />
            <button
              className="icon-button"
              type="button"
              onClick={close}
              aria-label="Close sign in"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>
        ) : null}
        {setupUser ? (
          <Onboarding user={setupUser} onFinish={close} />
        ) : (
          <>
            <div className="login-heading">
              <h2 id="auth-heading">{actionLabel}</h2>
              <p>
                {registering
                  ? registrationMode === "invite"
                    ? "Create your account with an invite."
                    : "Create the account that will own this reading queue."
                  : "Sign in to open your reading queue."}
              </p>
            </div>
            <form className="login-form" onSubmit={submit}>
              {registering && registrationMode === "invite" ? (
                <label className="login-field" htmlFor="auth-invite">
                  <span>Invite code</span>
                  <input
                    id="auth-invite"
                    name="inviteCode"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    required
                    maxLength={INVITE_CODE_INPUT_MAX_LENGTH}
                    pattern={INVITE_CODE_PATTERN_SOURCE}
                    placeholder="K7M9XR"
                    value={inviteCode}
                    onChange={(event) => setInviteCode(normalizeInviteCode(event.target.value))}
                  />
                </label>
              ) : null}
              {!registering && passkeysAvailable ? (
                <button
                  className="primary-button login-button"
                  type="button"
                  disabled={submitting || usingPasskey}
                  onClick={() => void signInWithPasskey()}
                >
                  {usingPasskey ? (
                    <LoaderCircle className="spin" aria-hidden="true" size={16} />
                  ) : (
                    <KeyRound aria-hidden="true" size={16} />
                  )}
                  {usingPasskey ? "Waiting for passkey" : "Sign in with a passkey"}
                </button>
              ) : null}
              {!registering && passkeysAvailable ? (
                <div className="auth-divider">
                  <span>or</span>
                </div>
              ) : null}
              <label className="login-field" htmlFor="auth-username">
                <span>Username</span>
                <input
                  id="auth-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  minLength={registering ? USERNAME_MIN_LENGTH : undefined}
                  maxLength={registering ? USERNAME_MAX_LENGTH : 80}
                  pattern={registering ? USERNAME_PATTERN_SOURCE : undefined}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              {registering && passkeysAvailable ? (
                <button
                  className="primary-button login-button"
                  type="button"
                  disabled={
                    !configLoaded ||
                    !registrationAvailable ||
                    submitting ||
                    usingPasskey ||
                    username.trim().length < USERNAME_MIN_LENGTH ||
                    (registrationMode === "invite" && inviteCode.length !== INVITE_CODE_LENGTH)
                  }
                  onClick={() => void createAccountWithPasskey()}
                >
                  {usingPasskey ? (
                    <LoaderCircle className="spin" aria-hidden="true" size={16} />
                  ) : (
                    <KeyRound aria-hidden="true" size={16} />
                  )}
                  {usingPasskey ? "Creating passkey" : "Create account with a passkey"}
                </button>
              ) : null}
              {registering && passkeysAvailable ? (
                <div className="auth-divider">
                  <span>or</span>
                </div>
              ) : null}
              <label className="login-field" htmlFor="auth-password">
                <span>Password</span>
                <input
                  id="auth-password"
                  name="password"
                  type="password"
                  autoComplete={registering ? "new-password" : "current-password"}
                  required
                  minLength={registering ? 15 : undefined}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              {error ? (
                <div className="login-error" role="alert">
                  {error}
                </div>
              ) : null}
              <button
                className={
                  passkeysAvailable
                    ? "secondary-button login-button"
                    : "primary-button login-button"
                }
                type="submit"
                disabled={
                  !configLoaded ||
                  submitting ||
                  usingPasskey ||
                  (registering && !registrationAvailable)
                }
              >
                {submitting ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={16} />
                ) : (
                  <ActionIcon aria-hidden="true" size={16} />
                )}
                {submitting ? progressLabel : actionLabel}
              </button>
            </form>
            {registering || registrationAvailable ? (
              <div className="auth-switch">
                <span>{registering ? "Already have an account?" : "Need an account?"}</span>
                <button type="button" onClick={switchMode} disabled={submitting || usingPasskey}>
                  {registering
                    ? "Sign in"
                    : registrationMode === "invite"
                      ? "Create account with invite"
                      : "Create account"}
                </button>
              </div>
            ) : (
              <p className="registration-closed">
                {configLoaded
                  ? "Account creation is closed on this server."
                  : "Checking account availability…"}
              </p>
            )}
            <AuthLegalLinks />
          </>
        )}
      </section>
    </Modal>
  );
}
