import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  NetworkManager,
  PortfolioManager,
  AddressBook,
  TransactionSimulator,
  MessageAnalyzer,
} from "@aethelred/wallet-simulation";
import {
  WALLET_STATE_STORAGE_KEY,
  type WalletPersistentState,
} from "@aethelred/wallet-chain";

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

export interface WalletServices {
  networkManager: NetworkManager;
  portfolio: PortfolioManager;
  addressBook: PersistentAddressBook;
  simulator: TransactionSimulator;
  messageAnalyzer: MessageAnalyzer;
}

const ServicesContext = createContext<WalletServices | null>(null);

type PersistedContact = { address: string; label: string; addedAt: number };

function canUseExtensionStorage(): boolean {
  return (
    typeof chrome !== "undefined" &&
    typeof chrome.storage !== "undefined" &&
    typeof chrome.storage.local !== "undefined"
  );
}

function isPersistedContact(value: unknown): value is PersistedContact {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.address === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.addedAt === "number"
  );
}

async function readPersistedContacts(): Promise<PersistedContact[]> {
  if (!canUseExtensionStorage()) {
    return [];
  }

  const raw = await new Promise<string | null>((resolve) => {
    chrome.storage.local.get(WALLET_STATE_STORAGE_KEY, (result) => {
      resolve((result[WALLET_STATE_STORAGE_KEY] as string) ?? null);
    });
  });

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WalletPersistentState>;
    const contacts = Array.isArray(parsed.contacts) ? parsed.contacts : [];
    return contacts.filter(isPersistedContact);
  } catch {
    return [];
  }
}

async function writePersistedContacts(
  contacts: PersistedContact[],
): Promise<void> {
  if (!canUseExtensionStorage()) {
    return;
  }

  const raw = await new Promise<string | null>((resolve) => {
    chrome.storage.local.get(WALLET_STATE_STORAGE_KEY, (result) => {
      resolve((result[WALLET_STATE_STORAGE_KEY] as string) ?? null);
    });
  });

  let nextState: Partial<WalletPersistentState> = {};
  if (raw) {
    try {
      nextState = JSON.parse(raw) as Partial<WalletPersistentState>;
    } catch {
      nextState = {};
    }
  }

  nextState.contacts = contacts;

  await new Promise<void>((resolve) => {
    chrome.storage.local.set(
      {
        [WALLET_STATE_STORAGE_KEY]: JSON.stringify(nextState),
      },
      () => resolve(),
    );
  });
}

class PersistentAddressBook extends AddressBook {
  hydrate(contacts: PersistedContact[]): void {
    super.loadFromSnapshot(contacts);
  }

  override addContact(address: string, label: string): void {
    super.addContact(address, label);
    void writePersistedContacts(this.toSnapshot());
  }

  override removeContact(address: string): void {
    super.removeContact(address);
    void writePersistedContacts(this.toSnapshot());
  }
}

/**
 * Provider — wraps the entire app. Instantiates all services exactly once
 * per mount, memoized so re-renders never create new instances.
 */
export function ServicesProvider({ children }: { children: ReactNode }) {
  const services = useMemo<WalletServices>(() => ({
    networkManager: new NetworkManager(),
    portfolio: new PortfolioManager(),
    addressBook: new PersistentAddressBook(),
    simulator: new TransactionSimulator(),
    messageAnalyzer: new MessageAnalyzer(),
  }), []);
  const [hydrated, setHydrated] = useState(!canUseExtensionStorage());

  useEffect(() => {
    if (!canUseExtensionStorage()) {
      return;
    }

    let cancelled = false;

    void readPersistedContacts().then((contacts) => {
      if (cancelled) return;
      services.addressBook.hydrate(contacts);
      setHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, [services]);

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
export const usePortfolioManager = () => useServices().portfolio;
export const useAddressBook = () => useServices().addressBook;
export const useTransactionSimulator = () => useServices().simulator;
export const useMessageAnalyzer = () => useServices().messageAnalyzer;
