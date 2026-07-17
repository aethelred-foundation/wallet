import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  NetworkManager,
  PortfolioManager,
  TransactionSimulator,
  MessageAnalyzer,
} from "@aethelred/wallet-simulation";
import {
  PersistentAddressBook,
  canUseSavedRecipientBackground,
} from "./persistent-address-book";

/**
 * Services Context
 * ────────────────
 * Single React-Context source of truth for all stateful services that
 * were previously instantiated at module load time (`const foo = new Foo()`
 * at the top of view files).
 *
 * Why this exists:
 *   - Module-level singletons break React HMR (ghost instances after edits)
 *   - They share state across the entire popup session with no cleanup
 *   - They're impossible to mock in tests
 *   - Two views importing the same singleton race each other on init
 *
 * How to use:
 *   const { networkManager, portfolio, addressBook } = useServices();
 *
 * The instances are created ONCE per React tree (via useMemo with []),
 * which is effectively the popup's lifetime — but because they're owned
 * by the provider component, React will garbage-collect them when the
 * popup unmounts instead of keeping them on the module cache forever.
 */

interface WalletServices {
  networkManager: NetworkManager;
  /** Legacy preview-only portfolio. Never instantiated in production. */
  portfolio?: PortfolioManager;
  addressBook: PersistentAddressBook;
  simulator: TransactionSimulator;
  messageAnalyzer: MessageAnalyzer;
}

const ServicesContext = createContext<WalletServices | null>(null);

/**
 * Provider — wraps the entire app. Instantiates all services exactly once
 * per mount, memoized so re-renders never create new instances.
 */
export function ServicesProvider({ children }: { children: ReactNode }) {
  const services = useMemo<WalletServices>(() => ({
    networkManager: new NetworkManager(),
    ...(import.meta.env.PROD ? {} : { portfolio: new PortfolioManager() }),
    addressBook: new PersistentAddressBook(),
    simulator: new TransactionSimulator(),
    messageAnalyzer: new MessageAnalyzer(),
  }), []);
  const hasRecipientBackground = canUseSavedRecipientBackground();
  const [hydrated, setHydrated] = useState(!hasRecipientBackground);
  const [initializationError, setInitializationError] = useState<Error | null>(null);

  useEffect(() => {
    if (!hasRecipientBackground) {
      return;
    }

    let cancelled = false;

    void services.addressBook.initialize().then(
      () => {
        if (cancelled) return;
        setHydrated(true);
      },
      (error: unknown) => {
        if (cancelled) return;
        setInitializationError(
          error instanceof Error ? error : new Error("Failed to load saved recipients"),
        );
      },
    );

    return () => {
      cancelled = true;
      services.addressBook.dispose();
    };
  }, [hasRecipientBackground, services]);

  if (initializationError) {
    throw initializationError;
  }

  if (!hydrated) {
    return null;
  }

  return (
    <ServicesContext.Provider value={services}>
      {children}
    </ServicesContext.Provider>
  );
}

/**
 * Hook — throws in development if used outside a ServicesProvider
 * so missing-provider bugs surface immediately instead of silently
 * returning null.
 */
export function useServices(): WalletServices {
  const ctx = useContext(ServicesContext);
  if (!ctx) {
    throw new Error(
      "useServices() must be used inside a <ServicesProvider>. " +
      "Wrap your app root in main.tsx or App.tsx."
    );
  }
  return ctx;
}

/** Convenience selector hooks for when you only need one service */
export const useNetworkManager = () => useServices().networkManager;
export const usePortfolioManager = (): PortfolioManager => {
  const portfolio = useServices().portfolio;
  if (!portfolio) {
    throw new Error("The legacy preview portfolio is unavailable in production builds.");
  }
  return portfolio;
};
export const useAddressBook = () => useServices().addressBook;
export const useAddressBookContacts = () => {
  const addressBook = useAddressBook();
  return useSyncExternalStore(
    addressBook.subscribe,
    addressBook.getSnapshot,
    addressBook.getSnapshot,
  );
};
