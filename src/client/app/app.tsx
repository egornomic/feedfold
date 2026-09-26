import { QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "../../shared/types";
import { ApiError, AUTH_REQUIRED_EVENT, api, appUrl, errorMessage } from "../api/api";
import { createQueryClient } from "../api/query";
import { SessionLoading } from "../features/auth/auth";
import { Homepage } from "../features/auth/homepage";
import { onboardingStep } from "../features/auth/onboarding-state";
import { StartupError } from "../features/reader/reader-states";
import AppShell from "./app-shell";

export function App() {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <Session />
    </QueryClientProvider>
  );
}

function Session() {
  const client = useQueryClient();
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const session = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        return await api.session();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
  });
  const { mutateAsync: logout } = useMutation({
    mutationFn: api.logout,
    onSettled: () => signedOut(),
  });

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
  }, []);

  const clearSession = useCallback(() => {
    client.clear();
    client.setQueryData(["session"], null);
    setOnboardingComplete(false);
  }, [client]);
  useEffect(() => {
    window.addEventListener(AUTH_REQUIRED_EVENT, clearSession);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, clearSession);
  }, [clearSession]);
  const signedOut = useCallback(() => {
    window.history.replaceState(null, "", appUrl("/"));
    clearSession();
  }, [clearSession]);

  if (session.isPending) return <SessionLoading />;
  if (session.error)
    return (
      <StartupError
        message={
          !navigator.onLine
            ? "You are offline. Reconnect, then try again."
            : errorMessage(session.error)
        }
        retry={() => void session.refetch()}
      />
    );
  const user = session.data;
  const needsSetup = user && !onboardingComplete && onboardingStep(user.id);
  if (!user || needsSetup)
    return (
      <Homepage
        onboardingUser={needsSetup ? user : undefined}
        onAuthenticated={(authenticated: SessionUser) => {
          client.clear();
          client.setQueryData(["session"], authenticated);
          setOnboardingComplete(true);
        }}
      />
    );
  return (
    <AppShell
      key={user.id}
      user={user}
      onLogout={async () => {
        await logout();
      }}
      onAccountDeleted={signedOut}
    />
  );
}
