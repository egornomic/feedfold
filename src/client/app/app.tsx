import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { SessionUser } from "../../shared/types";
import { ApiError, AUTH_REQUIRED_EVENT, api, errorMessage } from "../api/api";
import { LoginPage, SessionLoading } from "../features/auth/auth";
import { StartupError } from "../features/reader/reader-states";

const AppShell = lazy(() => import("./app-shell"));

export function App() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const sessionRequestId = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
  }, []);

  const loadSession = useCallback(async () => {
    const requestId = sessionRequestId.current + 1;
    sessionRequestId.current = requestId;
    setCheckingSession(true);
    setSessionError(null);
    try {
      const sessionUser = await api.session();
      if (sessionRequestId.current === requestId) setUser(sessionUser);
    } catch (error) {
      if (sessionRequestId.current !== requestId) return;
      setUser(null);
      if (!(error instanceof ApiError && error.status === 401)) {
        setSessionError(
          !navigator.onLine
            ? "You are offline. Reconnect, then try again."
            : error instanceof ApiError
              ? errorMessage(error)
              : "feedfold could not reach the server. Check the connection, then try again.",
        );
      }
    } finally {
      if (sessionRequestId.current === requestId) setCheckingSession(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
    return () => {
      sessionRequestId.current += 1;
    };
  }, [loadSession]);

  useEffect(() => {
    const requireAuthentication = () => {
      setUser(null);
      setCheckingSession(false);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, requireAuthentication);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, requireAuthentication);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  if (checkingSession) return <SessionLoading />;
  if (sessionError) {
    return <StartupError message={sessionError} retry={() => void loadSession()} />;
  }
  if (!user) return <LoginPage onAuthenticated={setUser} />;
  return (
    <Suspense fallback={<SessionLoading />}>
      <AppShell
        key={user.id}
        user={user}
        onLogout={logout}
        onAccountDeleted={() => setUser(null)}
      />
    </Suspense>
  );
}
