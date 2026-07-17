import { Home, PieChart, CandlestickChart, CreditCard, LayoutGrid } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigation, type ViewName } from "../router";
import { isViewReleased } from "../lib/feature-availability";

/* ──────────────────────────────────────────────────────────────
   iOS-grade bottom tab bar.

   Design: a glass surface with a sliding "pill" indicator that
   animates between tabs using spring physics — the same motion
   Apple uses on iPad tab bars and macOS Ventura segmented pickers.

   Architecture:
   - The pill is an absolutely positioned div translated via CSS
     transform. Its `width` is exactly one tab slot (100%/N minus
     the horizontal padding of the bar). Its `transform` is the
     active index times the slot width — that's it. No JS timers,
     no refs: the browser handles the spring via a single
     `transition: transform var(--dur-slow) var(--ease-spring)`.
   - The pill sits at z-index 0 behind the icons/labels (z-index 1).
     Icons and labels inherit `color` so their accent tint simply
     becomes visible against the translucent accent pill.
   - Each button is a <button role="tab">, the active one gets
     `aria-current="page"` and `aria-selected="true"` for screen
     readers and keyboard users.

   Why lucide-react: unified stroke weight (1.75), consistent optical
   size, and zero bundle cost beyond individual icon imports thanks
   to Vite tree-shaking.
   ────────────────────────────────────────────────────────────── */

interface TabDef {
  view: ViewName;
  icon: typeof Home;
  /** i18n key under the `nav` namespace; resolved at render time. */
  labelKey: "home" | "portfolio" | "markets" | "payments" | "hub";
}

const tabs: TabDef[] = [
  { view: "home", icon: Home, labelKey: "home" },
  { view: "portfolio", icon: PieChart, labelKey: "portfolio" },
  /* Markets uses CandlestickChart — the canonical trading/market icon.
     Replaces BarChart3 which felt too generic (it was also used in
     the Markets view body). */
  { view: "markets", icon: CandlestickChart, labelKey: "markets" },
  { view: "payments", icon: CreditCard, labelKey: "payments" },
  /* Hub uses LayoutGrid — matches the dApp-catalog "grid of apps"
     mental model better than AppWindow (which read as a single window). */
  { view: "hub", icon: LayoutGrid, labelKey: "hub" },
];
const availableTabs = tabs.filter((tab) => isViewReleased(tab.view));

// Map every descendant view back to its parent tab so deep navigation
// (e.g. portfolio → account-detail) still highlights the correct tab.
const TAB_CHILDREN: Record<string, ViewName[]> = {
  home: ["home"],
  portfolio: ["portfolio", "accounts", "account-detail"],
  markets: ["markets", "network-selector", "activity"],
  payments: [
    "payments",
    "send",
    "receive",
    "swap",
    "contacts",
  ],
  hub: [
    "hub",
    "app-catalog",
    "approvals",
    "policy-view",
    "connected-sites",
  ],
};

// Profile/chrome views that sit outside any tab. When one of these is
// active we hide the pill entirely so nothing appears selected.
const PROFILE_VIEWS: ViewName[] = [
  "settings",
  "security",
  "audit-log",
  "deployment-info",
  "token-approvals",
  "workspace-selector",
  "tx-detail",
  "digital-assets",
  "rewards",
  "qr-scanner",
  "regulatory-passport",
  "id-verification",
  "developer-tools",
  "machine-delegation",
  "connected-sites",
];

export function NavBar({ approvalCount }: { approvalCount?: number }) {
  const { view, navigate } = useNavigation();
  const { t } = useTranslation();

  const isProfileView = PROFILE_VIEWS.includes(view);
  const activeTabKey = isProfileView
    ? null
    : (Object.entries(TAB_CHILDREN).find(([, children]) => children.includes(view))?.[0] ??
      "home");

  const activeIndex = activeTabKey
    ? availableTabs.findIndex((tab) => tab.view === activeTabKey)
    : -1;

  // The pill is hidden on profile views — we fade it out rather than
  // unmounting so the next entry animates in cleanly.
  const pillVisible = activeIndex >= 0;
  // translateX = active index as a percentage of the pill's own width,
  // which equals one tab slot. So index 2 → 200% translate.
  const pillTransform = `translateX(${activeIndex * 100}%)`;

  return (
    <nav className="nav-bar" role="tablist" aria-label={t("nav.mainNavigation")}>
      <div
        className="nav-pill-bg"
        aria-hidden="true"
        style={{
          transform: pillTransform,
          opacity: pillVisible ? 1 : 0,
          width: `calc((100% - var(--space-4)) / ${availableTabs.length})`,
        }}
      />
      {availableTabs.map(({ view: tabView, icon: Icon, labelKey }) => {
        const isActive = activeTabKey === tabView;
        const showBadge =
          tabView === "hub" && approvalCount !== undefined && approvalCount > 0;
        const label = t(`nav.${labelKey}`);
        return (
          <button
            key={tabView}
            className={`nav-tab motion-press${isActive ? " active" : ""}`}
            onClick={() => navigate(tabView)}
            type="button"
            role="tab"
            aria-label={label}
            aria-selected={isActive}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="nav-tab-icon">
              <Icon
                size={22}
                strokeWidth={isActive ? 2.25 : 1.75}
                aria-hidden="true"
              />
              {showBadge && <span className="nav-badge">{approvalCount}</span>}
            </span>
            <span className="nav-tab-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
