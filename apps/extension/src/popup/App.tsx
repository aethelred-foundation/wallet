import { useEffect } from "react";
import { NavigationProvider, useNavigation } from "./router";
import { useWalletState } from "./hooks/use-wallet-state";
import { Header } from "./components/header";
import { NavBar } from "./components/nav-bar";
import { Loading } from "./components/loading";
import { ErrorBoundary } from "./components/error-boundary";
import { ViewErrorBoundary } from "./components/view-error-boundary";
import { PageTransition } from "./components/page-transition";
import { EmptyState } from "./components/empty-state";
import { TranslationProvider } from "./i18n/i18n-provider";
import { ServicesProvider } from "./services/services-context";
import { FormatProvider } from "./i18n/format";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { ShieldAlert } from "lucide-react";

// Views
import { HomeView } from "./views/home";
import { HomeViewV2 } from "./views/home-v2";

// ── Wallet UI version ─────────────────────────────────────────
// Default is 2 (Premium Apple-grade redesign). The Developer Tools
// page can override this via localStorage and reload — the value is
// read once at module load so a full reload is required to switch.
//   1 = Original (v1)
//   2 = Premium Apple-grade redesign (v2)
const WALLET_UI_VERSION: number = (() => {
  if (import.meta.env.PROD) {
    return 2;
  }
  try {
    const stored = localStorage.getItem("aethelred-ui-version");
    if (stored === "1" || stored === "2") return parseInt(stored, 10);
  } catch {
    // localStorage may be unavailable (private mode)
  }
  return 2;
})();
// ──────────────────────────────────────────────────────────────
import { AccountsView } from "./views/accounts";
import { AccountDetailView } from "./views/account-detail";
import { ApprovalsView } from "./views/approvals";
import { AppCatalogView } from "./views/app-catalog";
import { SettingsView } from "./views/settings";
import { SendView } from "./views/send";
import { ReceiveView } from "./views/receive";
import { AuditLogView } from "./views/audit-log";
import { PolicyView } from "./views/policy-view";
import { WorkspaceSelectorView } from "./views/workspace-selector";
import { LockScreenView } from "./views/lock-screen";

// Phase 1-3 views
import { NetworkSelectorView } from "./views/network-selector";
import { ActivityView } from "./views/activity";
import { DeploymentInfoView } from "./views/deployment-info";
import { ContactsView } from "./views/contacts";
import { ConnectedSitesView } from "./views/connected-sites";
import { TokenApprovalsView } from "./views/token-approvals";
import { SwapView } from "./views/swap";
import { SecurityView } from "./views/security";
import { PortfolioView } from "./views/portfolio";
import { MarketsView } from "./views/markets";
import { PaymentsView } from "./views/payments";
import { HubView } from "./views/hub";
import { DigitalAssetsView } from "./views/digital-assets";
import { RewardsView } from "./views/rewards";
import { QrScannerView } from "./views/qr-scanner";
import { RegulatoryPassportView } from "./views/regulatory-passport";
import { IdVerificationView } from "./views/id-verification";
import { DeveloperToolsView } from "./views/developer-tools";
import { MachineDelegationView } from "./views/machine-delegation";

// Components
import { ToastProvider } from "./components/toast";
import { CommandPalette } from "./components/command-palette";

// Onboarding
import { WelcomeView } from "./views/onboarding/welcome";
import { CreateWalletView } from "./views/onboarding/create-wallet";
import { ImportWalletView } from "./views/onboarding/import-wallet";
import { RecoveryPhraseView } from "./views/onboarding/recovery-phrase";
import { OnboardingCompleteView } from "./views/onboarding/complete";

function WalletApp() {
  const { state, lockState, loading, contextError } = useWalletState();
  const { view, navigate } = useNavigation();

  /* ─── Scroll reset on navigation ───────────────────────────
   * The `.view-container` is the scrolling element. React swaps
   * the inner view component when `view` changes, but the parent
   * container keeps its previous scrollTop — so navigating from a
   * deep-scrolled Portfolio to a short view like Send and back
   * would leave the user looking at empty space or miss the top
   * section entirely. Resetting to the top on every navigation
   * is the expected mobile behavior: every tap on a tab/page
   * lands you at the top of that page's content. */
  useEffect(() => {
    const el = document.querySelector(".view-container");
    if (el) el.scrollTop = 0;
  }, [view]);

  /* ─── Global keyboard shortcuts ────────────────────────────
   * Power-user navigation. Shortcuts are skipped when the user
   * is typing in an input (handled by the hook) so they don't
   * interfere with form entry. The CommandPalette component has
   * its own mod+k listener, so we don't register it here —
   * keeping these disjoint avoids double-firing. */
  useKeyboardShortcuts({
    h: () => navigate("home"),
    p: () => navigate("portfolio"),
    m: () => navigate("markets"),
    y: () => navigate("payments"),      // p is taken; y for "payY"
    b: () => navigate("hub"),           // b for "browse" (hub is the dApp hub)
    s: () => navigate("send"),
    r: () => navigate("receive"),
    w: () => navigate("swap"),          // w for "sWap"
    a: () => navigate("accounts"),
    ",": () => navigate("settings"),    // VS Code convention
    g: () => navigate("activity"),
  });

  if (loading) {
    return <Loading message="Connecting to wallet..." />;
  }

  if (contextError) {
    return (
      <main className="shell popup-shell">
        <div className="canvas">
          <div className="view-container">
            <EmptyState
              icon={<ShieldAlert size={28} />}
              title="Production wallet preview is unavailable"
              description={contextError}
              tone="warning"
              padding="lg"
            />
          </div>
        </div>
      </main>
    );
  }

  // Not initialized → onboarding
  if (lockState && !lockState.initialized) {
    return <OnboardingRouter />;
  }

  // Locked → lock screen
  if (lockState?.locked) {
    return (
      <main className="shell popup-shell">
        <LockScreenView onUnlock={() => { /* state update from background will re-render */ }} />
      </main>
    );
  }

  // No state yet → loading
  if (!state) {
    return <Loading message="Loading wallet state..." />;
  }

  // Show onboarding views even after initialization
  const isOnboarding = view.startsWith("onboarding-");
  if (isOnboarding) {
    return <OnboardingRouter />;
  }

  return (
    <main className="shell popup-shell">
      <div className="canvas">
        <Header
          workspaceName={state.activeWorkspace.name}
          subjectName={state.subject.displayName}
          approvalCount={state.pendingApprovals.length}
        />
        <div className="view-container">
          {/* Per-route error boundary — a crash here keeps nav + header alive.
              viewName is passed so componentDidUpdate can auto-reset on navigation.
              PageTransition wraps the router output so every navigation re-plays
              a spring-eased fade-up, making the whole popup feel more fluid. */}
          <ViewErrorBoundary viewName={view} onNavigateHome={() => navigate("home")}>
            <PageTransition viewKey={view}>
              <ViewRouter state={state} />
            </PageTransition>
          </ViewErrorBoundary>
        </div>
        <NavBar approvalCount={state.pendingApprovals.length} />
      </div>
    </main>
  );
}

function ViewRouter({ state }: { state: NonNullable<ReturnType<typeof useWalletState>["state"]> }) {
  const { view } = useNavigation();

  switch (view) {
    // Main 5 tabs
    case "home": return WALLET_UI_VERSION === 2 ? <HomeViewV2 state={state} /> : <HomeView state={state} />;
    case "portfolio": return <PortfolioView />;
    case "markets": return <MarketsView />;
    case "payments": return <PaymentsView />;
    case "hub": return <HubView state={state} />;
    // Sub-views
    case "accounts": return <AccountsView state={state} />;
    case "account-detail": return <AccountDetailView state={state} />;
    case "approvals": return <ApprovalsView state={state} />;
    case "app-catalog": return <AppCatalogView state={state} />;
    case "settings": return <SettingsView state={state} />;
    case "send": return <SendView state={state} />;
    case "receive": return <ReceiveView state={state} />;
    case "audit-log": return <AuditLogView />;
    case "policy-view": return <PolicyView state={state} />;
    case "workspace-selector": return <WorkspaceSelectorView state={state} />;
    case "network-selector": return <NetworkSelectorView />;
    case "activity": return <ActivityView />;
    case "deployment-info": return <DeploymentInfoView />;
    case "contacts": return <ContactsView />;
    case "connected-sites": return <ConnectedSitesView state={state} />;
    case "token-approvals": return <TokenApprovalsView />;
    case "swap": return <SwapView />;
    case "security": return <SecurityView />;
    case "digital-assets": return <DigitalAssetsView />;
    case "rewards": return <RewardsView />;
    case "qr-scanner": return <QrScannerView />;
    case "regulatory-passport": return <RegulatoryPassportView />;
    case "id-verification": return <IdVerificationView />;
    case "developer-tools": return <DeveloperToolsView />;
    case "machine-delegation": return <MachineDelegationView />;
    default: {
      // Unknown route — surface it to developers in dev mode via
      // console.warn, but gracefully fall back to home so users
      // never see a white screen.
      if (import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.warn(`[router] Unknown view name — falling back to home`);
      }
      return WALLET_UI_VERSION === 2 ? <HomeViewV2 state={state} /> : <HomeView state={state} />;
    }
  }
}

function OnboardingRouter() {
  const { view } = useNavigation();

  return (
    <main className="shell popup-shell">
      <div className="canvas">
        {(() => {
          switch (view) {
            case "onboarding-create": return <CreateWalletView />;
            case "onboarding-import": return <ImportWalletView />;
            case "onboarding-recovery": return <RecoveryPhraseView />;
            case "onboarding-complete": return <OnboardingCompleteView />;
            default: return <WelcomeView />;
          }
        })()}
      </div>
    </main>
  );
}

export default function App() {
  /* ─── Provider ordering ─────────────────────
   * ErrorBoundary (outermost — top-level catastrophic catch)
   *   └─ TranslationProvider (i18next — string translations)
   *        └─ ServicesProvider (owns stateful managers)
   *             └─ FormatProvider (Intl currency/number formatting)
   *                  └─ ToastProvider (toast notifications)
   *                       └─ NavigationProvider (router state)
   *                            └─ WalletApp (the actual UI)
   *
   * Ordering rationale:
   *   - TranslationProvider is outermost because error-boundary fallback
   *     UIs may eventually want translated strings ("Something went wrong").
   *   - ServicesProvider sits above Toast + Nav so view error boundaries
   *     can still reach services when recovering from a render crash.
   *   - FormatProvider sits just inside services so every display view
   *     uses ONE currency/number formatter, not scattered Intl.NumberFormat
   *     instantiations.
   *   - ToastProvider sits inside Format so toast messages can use
   *     formatted numbers/currencies without passing formatters through
   *     props.
   *   - NavigationProvider is innermost so routes can freely change
   *     without destroying any of the upstream singletons. */
  return (
    <ErrorBoundary>
      <TranslationProvider>
        <ServicesProvider>
          <FormatProvider>
            <ToastProvider>
              <NavigationProvider initialView="home">
                <WalletApp />
                <CommandPalette />
              </NavigationProvider>
            </ToastProvider>
          </FormatProvider>
        </ServicesProvider>
      </TranslationProvider>
    </ErrorBoundary>
  );
}
