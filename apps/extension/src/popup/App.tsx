import {
  lazy as reactLazy,
  Suspense,
  useEffect,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";
import { assertNever } from "@aethelred/wallet-observability";
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
import { getUnreleasedFeature, isViewReleased } from "./lib/feature-availability";

/* ═════════════════════════════════════════════════════════════════════
 * Route-level code splitting
 * ═════════════════════════════════════════════════════════════════════
 *
 * The popup has grown to 30+ distinct views; eagerly loading every one
 * when the extension starts inflates `popup.js` well past the budget
 * and forces users to parse code they'll almost never run (Developer
 * Tools, Regulatory Passport, Audit Log, etc.).
 *
 * Strategy:
 *   • The five bottom-nav tabs (home, portfolio, markets, payments, hub)
 *     + the lock screen are the ONLY truly hot paths — they're hit on
 *     every popup open. They stay eager-imported so the first render
 *     doesn't pay a waterfall cost.
 *   • Everything else is wrapped in `React.lazy(() => import(...))` so
 *     Rollup emits a dedicated chunk per view (see vite.config.ts →
 *     `chunkFileNames: "chunks/[name].js"`).
 *   • Onboarding views share a named import chunk-prefix so Rollup keeps
 *     the entire welcome → complete flow in a handful of closely-sized
 *     chunks rather than one huge blob.
 *
 * Tests keep importing the named exports from the view files directly
 * (e.g. `import { SendView } from "../popup/views/send"`) — lazy() only
 * affects how App.tsx loads them at runtime; the module surface itself
 * is unchanged.
 * ═════════════════════════════════════════════════════════════════════ */

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

// ── Eager-loaded views (hot paths) ────────────────────────────
// The five main tabs + lock screen are entered on essentially every
// session. Code-splitting them costs more in waterfall delay than it
// saves in bytes, so they stay in the main bundle.
import { HomeViewV2 } from "./views/home-v2";
import { PortfolioView } from "./views/portfolio";
import { PaymentsView } from "./views/payments";
import { HubView } from "./views/hub";
import { LockScreenView } from "./views/lock-screen";

// ── Lazy-loaded views (cold / rarely-used paths) ───────────────
// Each lazy() call becomes a separate `chunks/<name>.js` file thanks
// to the chunkFileNames output in vite.config.ts.
//
// `lazy()` here wraps React.lazy with a retry. Each cold view is a
// separate chunk fetched on demand; when the popup is previewed over a
// network (e.g. the mobile WebView shell pulling the bundle over LAN),
// a single transient fetch failure would otherwise reject the dynamic
// import and trip ViewErrorBoundary — the page renders as an "error"
// even though the code is sound. Retrying with a short backoff turns
// those flaky-network failures into a successful load. In the packaged
// extension (chunks served from disk) the first attempt always wins, so
// this is a no-op there.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors React.lazy's own signature
function lazy<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return reactLazy(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await factory();
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
    throw lastError;
  });
}

// Vite replaces import.meta.env.PROD at build time. Keeping unreleased lazy
// imports on the development-only side of this conditional lets Rollup omit
// their fixture/scaffold chunks from the production extension entirely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route components have heterogeneous props
const ProductionUnavailableView: ComponentType<any> = () => null;

// The legacy dashboard contains design-preview datasets and is available only
// to local development builds. The production branch is compile-time constant,
// so Rollup must not emit a legacy-home chunk into the extension package.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route components have heterogeneous props
const LegacyHomeView: ComponentType<any> = import.meta.env.PROD
  ? ProductionUnavailableView
  : lazy(() => import("./views/home").then((m) => ({ default: m.HomeView })));

const AccountsView = lazy(() =>
  import("./views/accounts").then((m) => ({ default: m.AccountsView })),
);
const AccountDetailView = lazy(() =>
  import("./views/account-detail").then((m) => ({ default: m.AccountDetailView })),
);
const ApprovalsView = lazy(() =>
  import("./views/approvals").then((m) => ({ default: m.ApprovalsView })),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route components have heterogeneous props
const AppCatalogView: ComponentType<any> = import.meta.env.PROD ? ProductionUnavailableView : lazy(() =>
  import("./views/app-catalog").then((m) => ({ default: m.AppCatalogView })),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route components have heterogeneous props
const MarketsView: ComponentType<any> = import.meta.env.PROD ? ProductionUnavailableView : lazy(() =>
  import("./views/markets").then((m) => ({ default: m.MarketsView })),
);
const SettingsView = lazy(() =>
  import("./views/settings").then((m) => ({ default: m.SettingsView })),
);
const SendView = lazy(() =>
  import("./views/send").then((m) => ({ default: m.SendView })),
);
const ReceiveView = lazy(() =>
  import("./views/receive").then((m) => ({ default: m.ReceiveView })),
);
const AuditLogView = lazy(() =>
  import("./views/audit-log").then((m) => ({ default: m.AuditLogView })),
);
const PolicyView = lazy(() =>
  import("./views/policy-view").then((m) => ({ default: m.PolicyView })),
);
const WorkspaceSelectorView = lazy(() =>
  import("./views/workspace-selector").then((m) => ({ default: m.WorkspaceSelectorView })),
);
const NetworkSelectorView = lazy(() =>
  import("./views/network-selector").then((m) => ({ default: m.NetworkSelectorView })),
);
const ActivityView = lazy(() =>
  import("./views/activity").then((m) => ({ default: m.ActivityView })),
);
const DeploymentInfoView = lazy(() =>
  import("./views/deployment-info").then((m) => ({ default: m.DeploymentInfoView })),
);
const ContactsView = lazy(() =>
  import("./views/contacts").then((m) => ({ default: m.ContactsView })),
);
const ConnectedSitesView = lazy(() =>
  import("./views/connected-sites").then((m) => ({ default: m.ConnectedSitesView })),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route components have heterogeneous props
const TokenApprovalsView: ComponentType<any> = import.meta.env.PROD ? ProductionUnavailableView : lazy(() =>
  import("./views/token-approvals").then((m) => ({ default: m.TokenApprovalsView })),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route components have heterogeneous props
const SwapView: ComponentType<any> = import.meta.env.PROD ? ProductionUnavailableView : lazy(() =>
  import("./views/swap").then((m) => ({ default: m.SwapView })),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route components have heterogeneous props
const TxDetailView: ComponentType<any> = import.meta.env.PROD ? ProductionUnavailableView : lazy(() =>
  import("./views/tx-detail").then((m) => ({ default: m.TxDetailView })),
);
const SecurityView = lazy(() =>
  import("./views/security").then((m) => ({ default: m.SecurityView })),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route components have heterogeneous props
const DigitalAssetsView: ComponentType<any> = import.meta.env.PROD ? ProductionUnavailableView : lazy(() =>
  import("./views/digital-assets").then((m) => ({ default: m.DigitalAssetsView })),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route components have heterogeneous props
const RewardsView: ComponentType<any> = import.meta.env.PROD ? ProductionUnavailableView : lazy(() =>
  import("./views/rewards").then((m) => ({ default: m.RewardsView })),
);
const QrScannerView = lazy(() =>
  import("./views/qr-scanner").then((m) => ({ default: m.QrScannerView })),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route components have heterogeneous props
const RegulatoryPassportView: ComponentType<any> = import.meta.env.PROD ? ProductionUnavailableView : lazy(() =>
  import("./views/regulatory-passport").then((m) => ({ default: m.RegulatoryPassportView })),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route components have heterogeneous props
const IdVerificationView: ComponentType<any> = import.meta.env.PROD ? ProductionUnavailableView : lazy(() =>
  import("./views/id-verification").then((m) => ({ default: m.IdVerificationView })),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route components have heterogeneous props
const DeveloperToolsView: ComponentType<any> = import.meta.env.PROD ? ProductionUnavailableView : lazy(() =>
  import("./views/developer-tools").then((m) => ({ default: m.DeveloperToolsView })),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route components have heterogeneous props
const MachineDelegationView: ComponentType<any> = import.meta.env.PROD ? ProductionUnavailableView : lazy(() =>
  import("./views/machine-delegation").then((m) => ({ default: m.MachineDelegationView })),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route components have heterogeneous props
const WalletConnectView: ComponentType<any> = import.meta.env.PROD ? ProductionUnavailableView : lazy(() =>
  import("./views/wallet-connect").then((m) => ({ default: m.WalletConnectView })),
);
const RecoveryBackupView = lazy(() =>
  import("./views/recovery-backup").then((m) => ({ default: m.RecoveryBackupView })),
);

// ── Onboarding views — lazy-loaded as a shared flow ────────────
// The onboarding flow fires on first install and then (almost) never
// again. Keep it off the main bundle and let Rollup decide how many
// chunks are most efficient.
const WelcomeView = lazy(() =>
  import("./views/onboarding/welcome").then((m) => ({ default: m.WelcomeView })),
);
const CreateWalletView = lazy(() =>
  import("./views/onboarding/create-wallet").then((m) => ({ default: m.CreateWalletView })),
);
const ImportWalletView = lazy(() =>
  import("./views/onboarding/import-wallet").then((m) => ({ default: m.ImportWalletView })),
);
const RecoveryPhraseView = lazy(() =>
  import("./views/onboarding/recovery-phrase").then((m) => ({ default: m.RecoveryPhraseView })),
);
const OnboardingPasskeyView = lazy(() =>
  import("./views/onboarding/passkey").then((m) => ({ default: m.OnboardingPasskeyView })),
);
const OnboardingCompleteView = lazy(() =>
  import("./views/onboarding/complete").then((m) => ({ default: m.OnboardingCompleteView })),
);

// Components
import { ToastProvider } from "./components/toast";
import { CommandPalette } from "./components/command-palette";

function WalletApp() {
  const { state, lockState, loading, contextError } = useWalletState();
  const { view, navigate } = useNavigation();

  /* ─── Scroll reset + focus management on navigation ─────────
   * Two concerns share one effect so they stay in lock-step with the
   * `view` dependency.
   *
   * 1. Scroll reset: the `.view-container` is the scrolling element.
   *    React swaps the inner view component when `view` changes, but
   *    the parent container keeps its previous scrollTop — navigating
   *    from a deep-scrolled Portfolio to a short view like Send and
   *    back would leave the user looking at empty space. Every tap
   *    on a tab/page should land at the top.
   *
   * 2. Focus management: when navigating between views, screen readers
   *    and keyboard users need focus to move to the new view so they
   *    hear the new heading and don't get left on a now-unmounted
   *    button. Native apps do this automatically with their navigation
   *    stack; the web requires us to do it explicitly. We target the
   *    new view's <h1>, falling back to the scroll container itself
   *    (with a synthetic tabindex) if the view has no h1. `preventScroll`
   *    is critical because we've just reset scrollTop — refocusing
   *    without it would undo the reset on tall forms. */
  useEffect(() => {
    const container = document.querySelector<HTMLElement>(".view-container");
    if (container) container.scrollTop = 0;

    const id = window.setTimeout(() => {
      const heading = document.querySelector<HTMLElement>("main h1");
      const target: HTMLElement | null =
        heading ??
        (container ? (container.setAttribute("tabindex", "-1"), container) : null);
      if (target) {
        try {
          target.focus({ preventScroll: true });
        } catch {
          // Non-focusable nodes refuse focus — swallow so navigation
          // never throws. This is expected when a view is still streaming
          // in via Suspense and the placeholder has no h1.
        }
      }
    }, 0);
    return () => window.clearTimeout(id);
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
    ...(isViewReleased("markets") ? { m: () => navigate("markets") } : {}),
    y: () => navigate("payments"),      // p is taken; y for "payY"
    b: () => navigate("hub"),           // b for "browse" (hub is the dApp hub)
    s: () => navigate("send"),
    r: () => navigate("receive"),
    ...(isViewReleased("swap") ? { w: () => navigate("swap") } : {}),
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
              a spring-eased fade-up, making the whole popup feel more fluid.
              Suspense provides a skeleton-free inline fallback while a lazy
              chunk streams in — the shell (header + nav) stays visible so the
              popup never blanks out during a route load. */}
          <ViewErrorBoundary viewName={view} onNavigateHome={() => navigate("home")}>
            <PageTransition viewKey={view}>
              <Suspense fallback={<Loading message="Loading..." />}>
                <ViewRouter state={state} />
              </Suspense>
            </PageTransition>
          </ViewErrorBoundary>
        </div>
        <NavBar approvalCount={state.pendingApprovals.length} />
      </div>
    </main>
  );
}

/* ─── Per-view error boundary wrapper ──────────────────────────
 * Every case in ViewRouter wraps its rendered view in a
 * ViewErrorBoundary. Why per-route (inside the switch) rather than
 * once around the router? Because the outer boundary already covers
 * "the entire router errored" — what we actually want is: a crash
 * deep inside Send.tsx must not destroy the navigation chrome OR
 * neighbouring views' mount state. Wrapping at the case boundary
 * means each view gets its OWN boundary instance, keyed by the view
 * name so React resets state when the user navigates away.
 *
 * The helper keeps call sites tidy and the `viewName` consistent
 * with the React key — a single source of truth for error reports. */
function Wrap({ viewName, children }: { viewName: string; children: ReactNode }) {
  const { navigate } = useNavigation();
  return (
    <ViewErrorBoundary
      key={viewName}
      viewName={viewName}
      onNavigateHome={() => navigate("home")}
    >
      {children}
    </ViewErrorBoundary>
  );
}

function ViewRouter({ state }: { state: NonNullable<ReturnType<typeof useWalletState>["state"]> }) {
  const { view } = useNavigation();
  const unreleased = getUnreleasedFeature(view);

  if (unreleased) {
    return (
      <Wrap viewName={`unreleased-${view}`}>
        <div className="view-padded">
          <EmptyState
            icon={<ShieldAlert size={24} />}
            title={`${unreleased.name} is not enabled`}
            description={`${unreleased.reason} No demo records or placeholder transactions are shown in production.`}
            tone="info"
          />
        </div>
      </Wrap>
    );
  }

  switch (view) {
    // Main 5 tabs (eager)
    case "home":
      return <Wrap viewName="home">{WALLET_UI_VERSION === 2 ? <HomeViewV2 state={state} /> : <LegacyHomeView state={state} />}</Wrap>;
    case "portfolio": return <Wrap viewName="portfolio"><PortfolioView /></Wrap>;
    case "markets": return <Wrap viewName="markets"><MarketsView /></Wrap>;
    case "payments": return <Wrap viewName="payments"><PaymentsView /></Wrap>;
    case "hub": return <Wrap viewName="hub"><HubView state={state} /></Wrap>;
    // Sub-views (lazy-loaded)
    case "accounts": return <Wrap viewName="accounts"><AccountsView state={state} /></Wrap>;
    case "account-detail": return <Wrap viewName="account-detail"><AccountDetailView state={state} /></Wrap>;
    case "approvals": return <Wrap viewName="approvals"><ApprovalsView state={state} /></Wrap>;
    case "app-catalog": return <Wrap viewName="app-catalog"><AppCatalogView state={state} /></Wrap>;
    case "settings": return <Wrap viewName="settings"><SettingsView state={state} /></Wrap>;
    case "send": return <Wrap viewName="send"><SendView state={state} /></Wrap>;
    case "receive": return <Wrap viewName="receive"><ReceiveView state={state} /></Wrap>;
    case "audit-log": return <Wrap viewName="audit-log"><AuditLogView /></Wrap>;
    case "policy-view": return <Wrap viewName="policy-view"><PolicyView state={state} /></Wrap>;
    case "workspace-selector": return <Wrap viewName="workspace-selector"><WorkspaceSelectorView state={state} /></Wrap>;
    case "network-selector": return <Wrap viewName="network-selector"><NetworkSelectorView /></Wrap>;
    case "activity": return <Wrap viewName="activity"><ActivityView /></Wrap>;
    case "deployment-info": return <Wrap viewName="deployment-info"><DeploymentInfoView /></Wrap>;
    case "contacts": return <Wrap viewName="contacts"><ContactsView /></Wrap>;
    case "connected-sites": return <Wrap viewName="connected-sites"><ConnectedSitesView state={state} /></Wrap>;
    case "token-approvals": return <Wrap viewName="token-approvals"><TokenApprovalsView /></Wrap>;
    case "swap": return <Wrap viewName="swap"><SwapView /></Wrap>;
    case "tx-detail": return <Wrap viewName="tx-detail"><TxDetailView /></Wrap>;
    case "security": return <Wrap viewName="security"><SecurityView /></Wrap>;
    case "recovery-backup": return <Wrap viewName="recovery-backup"><RecoveryBackupView /></Wrap>;
    case "digital-assets": return <Wrap viewName="digital-assets"><DigitalAssetsView /></Wrap>;
    case "rewards": return <Wrap viewName="rewards"><RewardsView /></Wrap>;
    case "qr-scanner": return <Wrap viewName="qr-scanner"><QrScannerView /></Wrap>;
    case "regulatory-passport": return <Wrap viewName="regulatory-passport"><RegulatoryPassportView /></Wrap>;
    case "id-verification": return <Wrap viewName="id-verification"><IdVerificationView /></Wrap>;
    case "developer-tools": return <Wrap viewName="developer-tools"><DeveloperToolsView /></Wrap>;
    case "machine-delegation": return <Wrap viewName="machine-delegation"><MachineDelegationView /></Wrap>;
    case "wallet-connect": return <Wrap viewName="wallet-connect"><WalletConnectView /></Wrap>;
    // ── Handled by sibling routers ───────────────────────────────
    // These variants are narrowed out before reaching ViewRouter —
    // "lock-screen" is rendered by WalletApp when the wallet is locked,
    // and every "onboarding-*" variant goes through OnboardingRouter.
    // We still enumerate them explicitly so `assertNever` below proves
    // at compile time that every ViewName is accounted for.
    case "lock-screen":
    case "onboarding-welcome":
    case "onboarding-create":
    case "onboarding-import":
    case "onboarding-recovery":
    case "onboarding-passkey":
    case "onboarding-complete": {
      if (import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.warn(`[router] Received ${view} in ViewRouter — falling back to home`);
      }
      return <Wrap viewName="home">{WALLET_UI_VERSION === 2 ? <HomeViewV2 state={state} /> : <LegacyHomeView state={state} />}</Wrap>;
    }
    default: {
      // Adding a new ViewName without wiring it above will trip
      // `assertNever` at build time. At runtime we still fall back to
      // home so a stale URL / storage value never leaves the user
      // staring at a white screen.
      if (import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.warn(`[router] Unknown view name — falling back to home`);
        assertNever(view, "ViewRouter");
      }
      return <Wrap viewName="home">{WALLET_UI_VERSION === 2 ? <HomeViewV2 state={state} /> : <LegacyHomeView state={state} />}</Wrap>;
    }
  }
}

function OnboardingRouter() {
  const { view, navigate } = useNavigation();

  /* Each onboarding step gets its own ViewErrorBoundary. A crash during
   * key generation or import would otherwise strand a brand-new user on
   * a white screen with no way to recover — wrapping each step lets them
   * retry or bounce back to Welcome. */
  const renderStep = () => {
    // OnboardingRouter is only reached for `onboarding-*` views (or as
    // a pre-init fallback); every other ViewName collapses into the
    // welcome step rather than crashing. The explicit case enumeration
    // lets TypeScript verify we handle every onboarding variant — if a
    // new `onboarding-*` view is added, the `default` will fall through
    // to `assertNever` in dev.
    switch (view) {
      case "onboarding-create":
        return <ViewErrorBoundary key="onboarding-create" viewName="onboarding-create" onNavigateHome={() => navigate("onboarding-welcome")}><CreateWalletView /></ViewErrorBoundary>;
      case "onboarding-import":
        return <ViewErrorBoundary key="onboarding-import" viewName="onboarding-import" onNavigateHome={() => navigate("onboarding-welcome")}><ImportWalletView /></ViewErrorBoundary>;
      case "onboarding-recovery":
        return <ViewErrorBoundary key="onboarding-recovery" viewName="onboarding-recovery" onNavigateHome={() => navigate("onboarding-welcome")}><RecoveryPhraseView /></ViewErrorBoundary>;
      case "onboarding-passkey":
        return <ViewErrorBoundary key="onboarding-passkey" viewName="onboarding-passkey" onNavigateHome={() => navigate("onboarding-welcome")}><OnboardingPasskeyView /></ViewErrorBoundary>;
      case "onboarding-complete":
        return <ViewErrorBoundary key="onboarding-complete" viewName="onboarding-complete" onNavigateHome={() => navigate("onboarding-welcome")}><OnboardingCompleteView /></ViewErrorBoundary>;
      case "onboarding-welcome":
        return <ViewErrorBoundary key="onboarding-welcome" viewName="onboarding-welcome" onNavigateHome={() => navigate("onboarding-welcome")}><WelcomeView /></ViewErrorBoundary>;
      default:
        // Any non-onboarding view that reaches here collapses into welcome
        // (e.g. initial render before onboarding narrowing). Silent by design —
        // onboarding routing is driven by a `startsWith("onboarding-")` check
        // in WalletApp, so this branch is reachable when the wallet is not
        // yet initialized and the initial view is "home".
        return <ViewErrorBoundary key="onboarding-welcome" viewName="onboarding-welcome" onNavigateHome={() => navigate("onboarding-welcome")}><WelcomeView /></ViewErrorBoundary>;
    }
  };

  return (
    <main className="shell popup-shell">
      <div className="canvas">
        <Suspense fallback={<Loading message="Loading..." />}>{renderStep()}</Suspense>
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
