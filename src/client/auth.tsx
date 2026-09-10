import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { KeyRound, LoaderCircle, LogIn, UserPlus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  INVITE_CODE_INPUT_MAX_LENGTH,
  INVITE_CODE_LENGTH,
  INVITE_CODE_PATTERN_SOURCE,
  normalizeInviteCode,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN_SOURCE,
} from "../shared/auth";
import type { RegistrationMode, SessionUser } from "../shared/types";
import { api, appUrl, errorMessage } from "./api";
import { BrandIdentity } from "./brand";

export function SessionLoading() {
  return (
    <main className="auth-page" aria-busy="true">
      <div className="session-loading" role="status" aria-label="Opening feedfold">
        <BrandIdentity decorative />
      </div>
    </main>
  );
}

export function LoginPage({ onAuthenticated }: { onAuthenticated: (user: SessionUser) => void }) {
  const [inviteCode, setInviteCode] = useState(() =>
    window.location.pathname.replace(/\/$/, "").endsWith("/join")
      ? normalizeInviteCode(window.location.hash.slice(1))
      : "",
  );
  const [mode, setMode] = useState<"login" | "register">(
    window.location.pathname.replace(/\/$/, "").endsWith("/join") ? "register" : "login",
  );
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>("closed");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [usingPasskey, setUsingPasskey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationAvailable, setRegistrationAvailable] = useState(false);
  const [passkeysAvailable, setPasskeysAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .authConfig()
      .then((config) => {
        if (!active) return;
        setRegistrationAvailable(config.registrationAvailable);
        setRegistrationMode(config.registrationMode);
        setConfigLoaded(true);
        if (!config.registrationAvailable) setMode("login");
        setPasskeysAvailable(config.passkeysAvailable && browserSupportsWebAuthn());
      })
      .catch((caught) => {
        if (active) {
          setError(errorMessage(caught));
          setConfigLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const authenticated = (user: SessionUser) => {
    if (window.location.pathname.replace(/\/$/, "").endsWith("/join")) {
      window.history.replaceState(null, "", appUrl("/"));
    }
    onAuthenticated(user);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      authenticated(
        mode === "login"
          ? await api.login(username, password)
          : await api.register(username, password, inviteCode),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode((current) => (current === "login" ? "register" : "login"));
    setPassword("");
    setError(null);
  };

  const signInWithPasskey = async () => {
    setUsingPasskey(true);
    setError(null);
    try {
      const { ceremonyId, options } = await api.passkeyAuthenticationOptions();
      const response = await startAuthentication({ optionsJSON: options });
      authenticated(await api.passkeyLogin(ceremonyId, response));
    } catch (caught) {
      setError(
        caught instanceof DOMException && caught.name === "NotAllowedError"
          ? "Passkey sign-in was cancelled or timed out."
          : errorMessage(caught),
      );
    } finally {
      setUsingPasskey(false);
    }
  };

  const createAccountWithPasskey = async () => {
    setUsingPasskey(true);
    setError(null);
    try {
      const { registrationId, options } = await api.passkeySignupOptions(username, inviteCode);
      const response = await startRegistration({ optionsJSON: options });
      authenticated(await api.completePasskeySignup(registrationId, response));
    } catch (caught) {
      setError(
        caught instanceof DOMException && caught.name === "NotAllowedError"
          ? "Passkey creation was cancelled or timed out."
          : errorMessage(caught),
      );
    } finally {
      setUsingPasskey(false);
    }
  };

  const registering = mode === "register";
  const actionLabel = registering ? "Create account" : "Sign in";
  const progressLabel = registering ? "Creating account" : "Signing in";
  const ActionIcon = registering ? UserPlus : LogIn;

  return (
    <main className="auth-page">
      <section className="login-panel" aria-labelledby="auth-heading">
        <BrandIdentity className="login-brand" />
        <div className="login-heading">
          <h1 id="auth-heading">{actionLabel}</h1>
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
              passkeysAvailable ? "secondary-button login-button" : "primary-button login-button"
            }
            type="submit"
            disabled={
              !configLoaded || submitting || usingPasskey || (registering && !registrationAvailable)
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
      </section>
    </main>
  );
}
