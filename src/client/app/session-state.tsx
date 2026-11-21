import {
    createContext,
    type ReactNode,
    useContext,
    useEffect,
    useLayoutEffect,
    useState,
} from "react";
import { useStore } from "zustand";
import { assert } from "../../shared/assert";
import {
    applyReaderAppearance,
    createReaderPreferencesStore,
    followReaderPreferences,
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
    useEffect(
        () => followReaderPreferences(stores.preferences, userId),
        [stores, userId],
    );
    return (
        <SessionStateContext value={stores}>
            <ReaderAppearance />
            {children}
        </SessionStateContext>
    );
}

function useSessionStores() {
    const stores = useContext(SessionStateContext);
    assert(stores, "Session state requires a signed-in account");
    return stores;
}

export function useInterfaceState<T>(
    selector: (state: ReturnType<SessionStores["interface"]["getState"]>) => T,
) {
    return useStore(useSessionStores().interface, selector);
}

export function useReaderPreferences<T>(
    selector: (
        state: ReturnType<SessionStores["preferences"]["getState"]>,
    ) => T,
) {
    return useStore(useSessionStores().preferences, selector);
}

function ReaderAppearance() {
    const theme = useReaderPreferences((state) => state.theme);
    const colorPalettes = useReaderPreferences((state) => state.colorPalettes);
    const articleFontSize = useReaderPreferences(
        (state) => state.articleFontSize,
    );

    useLayoutEffect(
        () => applyReaderAppearance(theme, colorPalettes),
        [theme, colorPalettes],
    );

    useLayoutEffect(() => {
        // Stored sizes are expressed in pixels at the standard 16px root size.
        document.documentElement.style.setProperty(
            "--article-font-size",
            `${articleFontSize / 16}rem`,
        );
    }, [articleFontSize]);

    return null;
}
