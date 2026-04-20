import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type ViewName =
  | "home"
  | "portfolio"
  | "markets"
  | "payments"
  | "hub"
  | "accounts"
  | "account-detail"
  | "approvals"
  | "send"
  | "receive"
  | "app-catalog"
  | "settings"
  | "audit-log"
  | "workspace-selector"
  | "policy-view"
  | "network-selector"
  | "activity"
  | "deployment-info"
  | "contacts"
  | "connected-sites"
  | "token-approvals"
  | "swap"
  | "tx-detail"
  | "security"
  | "digital-assets"
  | "rewards"
  | "qr-scanner"
  | "regulatory-passport"
  | "id-verification"
  | "developer-tools"
  | "machine-delegation"
  | "wallet-connect"
  | "onboarding-welcome"
  | "onboarding-create"
  | "onboarding-import"
  | "onboarding-recovery"
  | "onboarding-passkey"
  | "onboarding-complete"
  | "recovery-backup"
  | "lock-screen";

interface NavigationState {
  view: ViewName;
  params?: Record<string, string>;
  history: Array<{ view: ViewName; params?: Record<string, string> }>;
}

interface NavigationContextValue {
  view: ViewName;
  params: Record<string, string>;
  navigate: (view: ViewName, params?: Record<string, string>) => void;
  goBack: () => void;
  canGoBack: boolean;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider");
  return ctx;
}

export function NavigationProvider({
  initialView,
  children,
}: {
  initialView: ViewName;
  children: ReactNode;
}) {
  const [state, setState] = useState<NavigationState>({
    view: initialView,
    params: {},
    history: [],
  });

  const navigate = useCallback((view: ViewName, params?: Record<string, string>) => {
    setState((prev) => ({
      view,
      params,
      history: [...prev.history, { view: prev.view, params: prev.params }],
    }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => {
      if (prev.history.length === 0) return prev;
      const last = prev.history[prev.history.length - 1];
      return {
        view: last.view,
        params: last.params,
        history: prev.history.slice(0, -1),
      };
    });
  }, []);

  return (
    <NavigationContext.Provider
      value={{
        view: state.view,
        params: state.params ?? {},
        navigate,
        goBack,
        canGoBack: state.history.length > 0,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}
