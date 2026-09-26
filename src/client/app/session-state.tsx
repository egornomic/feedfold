import { createContext, type ReactNode, useContext, useLayoutEffect, useState } from "react";
import { useStore } from "zustand";
import {
  createReaderPreferencesStore,
  resolveAppearance,
} from "../features/reader/reader-preferences";
import { createInterfaceStore } from "./interface-state";

type SessionStores = {
  interface: ReturnType<typeof createInterfaceStore>;
  preferences: ReturnType<typeof createReaderPreferencesStore>;
};

const SessionStateContext = createContext<SessionStores | null>(null);

// Mounted inside the account-keyed shell: sign-out or account changes discard transient state.
export function SessionStateProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const [stores] = useState(() => ({
    interface: createInterfaceStore(),
    preferences: createReaderPreferencesStore(userId),
  }));
  return (
    <SessionStateContext value={stores}>
      <ReaderAppearance />
      {children}
    </SessionStateContext>
  );
}

function useSessionStores() {
  const stores = useContext(SessionStateContext);
  if (!stores) throw new Error("Session state requires a signed-in account");
  return stores;
}

export function useInterfaceState<T>(
  selector: (state: ReturnType<SessionStores["interface"]["getState"]>) => T,
) {
  return useStore(useSessionStores().interface, selector);
}

export function useReaderPreferences<T>(
  selector: (state: ReturnType<SessionStores["preferences"]["getState"]>) => T,
) {
  return useStore(useSessionStores().preferences, selector);
}

function ReaderAppearance() {
  const theme = useReaderPreferences((state) => state.theme);
  const colorPalettes = useReaderPreferences((state) => state.colorPalettes);
  const articleFontSize = useReaderPreferences((state) => state.articleFontSize);

  useLayoutEffect(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: light)");
    const applyTheme = () => {
      const appearance = resolveAppearance(theme, colorPalettes, colorScheme.matches);
      document.documentElement.dataset.theme = appearance.mode;
      document.documentElement.dataset.palette = appearance.palette;
      document
        .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.setAttribute("content", getComputedStyle(document.body).backgroundColor);
    };
    applyTheme();
    if (theme !== "auto") return;
    colorScheme.addEventListener("change", applyTheme);
    return () => colorScheme.removeEventListener("change", applyTheme);
  }, [theme, colorPalettes]);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--article-font-size", `${articleFontSize}px`);
  }, [articleFontSize]);

  return null;
}
