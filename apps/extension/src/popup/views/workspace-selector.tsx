import { useMemo, useState } from "react";
import {
  Building2,
  ArrowLeft,
  Users,
  Crown,
  Lock,
  ArrowUpRight,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  X,
} from "lucide-react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import {
  TierMigrator,
  InMemoryTenantProfileStore,
  materializeTenantProfile,
  getTierPreset,
  type TierLevel,
  type TierMigrationPlan,
  type TierMigrationReceipt,
  type TenantProfile,
} from "@aethelred/wallet-deployment";
import { useNavigation } from "../router";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";
import "../../styles/legacy/simple-pages.css";

/* ─── Locked upgrade card fixtures ────────────────────────────────── *
 * In alpha only a single (personal) workspace exists. Two more are
 * planned for Phase 2 — render them grayed out so the user can see
 * the roadmap. */

interface LockedTier {
  id: "enterprise" | "sovereign";
  name: string;
  desc: string;
  icon: typeof Users;
}

const LOCKED_TIERS: readonly LockedTier[] = [
  {
    id: "enterprise",
    name: "Enterprise Workspace",
    desc: "Multi-user treasury with role-based controls and approval flows.",
    icon: Users,
  },
  {
    id: "sovereign",
    name: "Sovereign Workspace",
    desc: "On-chain governance, delegated signing, and institutional custody.",
    icon: Crown,
  },
];

/* ─── Tier graduation ladder ───────────────────────────────────────── *
 *
 * Moat #5 exposes a "Graduate tier" CTA that upgrades (never
 * downgrades) a tenant into a higher capability tier while preserving
 * the audit chain + credentials + workflow history. The flow is:
 *
 *   1. Select a target tier from the ladder.
 *   2. Review the TierMigrationPlan (features gained, limit changes,
 *      compliance additions) in a modal sheet.
 *   3. Tick consent checkboxes for each continuity invariant.
 *   4. Click Execute — the bridge stub logs and returns a mock receipt
 *      (the real background handler is Phase 2).
 *
 * Downgrade is intentionally not offered: graduating *down* requires
 * legal / compliance review because feature loss may violate the
 * tenant's regulatory commitments. The UI explains this.
 */
interface GraduationTarget {
  tier: TierLevel;
  displayName: string;
  description: string;
  icon: typeof Users;
}

const UPGRADE_LADDER: Readonly<Record<TierLevel, readonly GraduationTarget[]>> =
  Object.freeze({
    personal: [
      {
        tier: "enterprise",
        displayName: "Enterprise",
        description:
          "Multi-approver workflows, MPC signing, MiCA reports, 1-year audit retention.",
        icon: Users,
      },
      {
        tier: "managed-dedicated",
        displayName: "Managed Dedicated",
        description:
          "Aethelred-operated tenant with dedicated infrastructure — regulated SMB posture.",
        icon: Building2,
      },
    ],
    enterprise: [
      {
        tier: "sovereign",
        displayName: "Sovereign",
        description:
          "Ministry / critical-infrastructure tier. L1-notarized audit chain, 7-year retention, BYOKMS.",
        icon: Crown,
      },
      {
        tier: "managed-institutional",
        displayName: "Managed Institutional",
        description:
          "Aethelred-operated institutional tenant with BYOKMS and 10-year retention.",
        icon: ShieldCheck,
      },
    ],
    sovereign: [],
    "managed-shared": [
      {
        tier: "managed-dedicated",
        displayName: "Managed Dedicated",
        description:
          "Graduate to dedicated tenant infrastructure with enhanced KYC.",
        icon: Building2,
      },
    ],
    "managed-dedicated": [
      {
        tier: "managed-institutional",
        displayName: "Managed Institutional",
        description:
          "Graduate to institutional-grade tenant with BYOKMS and notarized audit.",
        icon: ShieldCheck,
      },
    ],
    "managed-institutional": [],
  });

/* ─── Continuity consent invariants ────────────────────────────────── *
 *
 * These mirror the {@link TierMigrationInvariantError.code} taxonomy —
 * if the user does not tick every one, the Execute button is disabled.
 */
interface ContinuityConsent {
  auditChain: boolean;
  credentials: boolean;
  workflowHistory: boolean;
  accountsStayWithOwner: boolean;
}

const CONSENT_COPY: Record<keyof ContinuityConsent, string> = {
  auditChain:
    "I consent to my existing audit history being preserved under the new tenant for regulatory continuity.",
  credentials:
    "I consent to my credentials being re-validated against the new tenant's lineage chain.",
  workflowHistory:
    "I consent to my workflow / approval history being carried forward.",
  accountsStayWithOwner:
    "I confirm that account key material remains under my control and is not re-issued.",
};

/* ─── Stub bridge client ──────────────────────────────────────────── *
 *
 * Until the background service worker ships its migration handler, we
 * run the full plan+execute flow *in the popup* against an in-memory
 * TenantProfileStore. This keeps the UX honest — every consent gate,
 * every invariant check, every receipt field behaves as it will in
 * production.
 */
function usePopupMigrationEngine(activeWorkspaceId: string) {
  return useMemo(() => {
    const store = new InMemoryTenantProfileStore();
    // Seed the store with a deterministic "current tenant" snapshot so
    // the Graduate CTA has a tenantId to operate against. The tenant
    // is always `personal` tier for the alpha build — Phase 2 replaces
    // this with the real profile from the background.
    const seedTenant: TenantProfile = materializeTenantProfile(
      getTierPreset("personal", "US"),
      {
        tenantId: `tenant-local-${activeWorkspaceId}`,
        workspaceId: activeWorkspaceId,
        createdAt: Date.now(),
      }
    );
    void store.put(seedTenant);
    const migrator = new TierMigrator({
      profileStore: store,
      // No audit/credential refs in the popup stub — the real values
      // land when the bridge ships.
    });
    return { store, migrator, seedTenantId: seedTenant.tenantId };
  }, [activeWorkspaceId]);
}

export function WorkspaceSelectorView({ state }: { state: AethelredWalletState }) {
  const { navigate } = useNavigation();
  const ws = state.activeWorkspace;
  const upgradeTiers = IS_PRODUCTION_BUILD ? [] : LOCKED_TIERS;

  // Graduation UI state — when non-null, the review sheet is open.
  const [pendingTarget, setPendingTarget] = useState<GraduationTarget | null>(
    null
  );
  const [pendingPlan, setPendingPlan] = useState<TierMigrationPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [consent, setConsent] = useState<ContinuityConsent>({
    auditChain: false,
    credentials: false,
    workflowHistory: false,
    accountsStayWithOwner: false,
  });
  const [receipt, setReceipt] = useState<TierMigrationReceipt | null>(null);
  const [busy, setBusy] = useState(false);

  const { migrator, seedTenantId } = usePopupMigrationEngine(ws.id);
  // The alpha build only ships the `personal` tier — real tier lookup
  // lands with the background handler.
  const currentTier: TierLevel = "personal";
  const availableUpgrades = UPGRADE_LADDER[currentTier];

  const openGraduateSheet = async (target: GraduationTarget) => {
    setBusy(true);
    setPlanError(null);
    setPendingPlan(null);
    setReceipt(null);
    setPendingTarget(target);
    setConsent({
      auditChain: false,
      credentials: false,
      workflowHistory: false,
      accountsStayWithOwner: false,
    });
    try {
      const result = await migrator.planMigration(seedTenantId, target.tier);
      if ("errors" in result) {
        setPlanError(
          `Migration refused: ${result.errors.map((e) => e.code).join(", ")}`
        );
      } else {
        setPendingPlan(result);
      }
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Unknown planner error");
    } finally {
      setBusy(false);
    }
  };

  const closeSheet = () => {
    setPendingTarget(null);
    setPendingPlan(null);
    setPlanError(null);
    setReceipt(null);
    setBusy(false);
  };

  const allConsentGranted =
    consent.auditChain &&
    consent.credentials &&
    consent.workflowHistory &&
    consent.accountsStayWithOwner;

  const executeGraduation = async () => {
    if (!pendingPlan) return;
    setBusy(true);
    try {
      // Stubbed bridge call — in production this posts a
      // `tenant-execute-migration` message to the background service
      // worker and awaits the receipt over a BridgeMessage round-trip.
      // For now we run the migrator in-page so the UX is faithful.
      console.info("[graduate-tier] stub bridge call", { plan: pendingPlan });
      const result = await migrator.executeMigration(pendingPlan, []);
      setReceipt(result);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view-padded">
      <button className="acc-back" onClick={() => navigate("settings")} type="button">
        <ArrowLeft size={14} strokeWidth={2.3} />
        <span>Settings</span>
      </button>

      {/* ═════ Hero ═════ */}
      <div className="wks-hero">
        <div className="wks-hero-top">
          <div className="wks-hero-icon">
            <Building2 size={20} strokeWidth={2.3} />
          </div>
          <div className="wks-hero-info">
            <span className="wks-hero-label">WORKSPACE</span>
            <strong className="wks-hero-title">Identity</strong>
            <span className="wks-hero-sub">Active context for signing and policy</span>
          </div>
        </div>
      </div>

      {/* ═════ Active workspace card ═════ */}
      <div className="wks-section-label">
        <span>ACTIVE</span>
        <span className="wks-section-hint">1 workspace</span>
      </div>

      <div className="wks-active">
        <div className="wks-active-icon">
          <Building2 size={22} strokeWidth={2.3} />
        </div>
        <div className="wks-active-body">
          <div className="wks-active-top">
            <strong className="wks-active-name">{ws.name}</strong>
            <span className="wks-active-dot">Active</span>
          </div>
          <div className="wks-active-badges">
            <span className="wks-badge">{ws.kind}</span>
            <span className="wks-badge is-role">{ws.role}</span>
          </div>
          {ws.summary && (
            <p className="wks-active-summary">{ws.summary}</p>
          )}
        </div>
      </div>

      {/* ═════ Graduate tier ═════ *
       *
       * The moat: users can graduate a single identity up the tier
       * ladder while keeping audit trail + credentials + workflows
       * intact. Downgrade is not offered — an info pill explains why.
       */}
      {availableUpgrades.length > 0 && (
        <>
          <div className="wks-section-label">
            <span>GRADUATE TIER</span>
            <span className="wks-section-hint">
              {availableUpgrades.length} path{availableUpgrades.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="wks-locked-list">
            {availableUpgrades.map((target) => {
              const Icon = target.icon;
              return (
                <button
                  key={target.tier}
                  type="button"
                  className="wks-locked"
                  onClick={() => openGraduateSheet(target)}
                  style={{ cursor: "pointer" }}
                  disabled={busy}
                >
                  <div className="wks-locked-icon">
                    <Icon size={18} strokeWidth={2.3} />
                  </div>
                  <div className="wks-locked-body">
                    <div className="wks-locked-top">
                      <strong className="wks-locked-name">{target.displayName}</strong>
                      <span className="wks-locked-pill">
                        <ArrowUpRight size={9} strokeWidth={2.8} />
                        Graduate
                      </span>
                    </div>
                    <p className="wks-locked-desc">{target.description}</p>
                  </div>
                </button>
              );
            })}
          </div>

          <p className="wks-active-summary" style={{ marginTop: 12 }}>
            <strong>Note.</strong> Downgrading a tier drops enterprise and
            compliance features and may violate regulatory commitments.
            Contact support for a compliance-reviewed downgrade path.
          </p>
        </>
      )}

      {/* ═════ Phase-2 locked fixtures (non-prod only) ═════ */}
      {upgradeTiers.length > 0 && (
        <>
          <div className="wks-section-label">
            <span>UPGRADE TO</span>
          </div>

          <div className="wks-locked-list">
            {upgradeTiers.map((tier) => {
              const Icon = tier.icon;
              return (
                <div className="wks-locked" key={tier.id}>
                  <div className="wks-locked-icon">
                    <Icon size={18} strokeWidth={2.3} />
                  </div>
                  <div className="wks-locked-body">
                    <div className="wks-locked-top">
                      <strong className="wks-locked-name">{tier.name}</strong>
                      <span className="wks-locked-pill">
                        <Lock size={9} strokeWidth={2.8} />
                        Phase 2
                      </span>
                    </div>
                    <p className="wks-locked-desc">{tier.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ═════ Graduation review sheet ═════ */}
      {pendingTarget && (
        <GraduationReviewSheet
          target={pendingTarget}
          plan={pendingPlan}
          planError={planError}
          consent={consent}
          receipt={receipt}
          busy={busy}
          onToggleConsent={(k) =>
            setConsent((c) => ({ ...c, [k]: !c[k] }))
          }
          onExecute={executeGraduation}
          onClose={closeSheet}
          allConsentGranted={allConsentGranted}
        />
      )}
    </div>
  );
}

/* ─── Graduation review sheet ──────────────────────────────────────── */

interface GraduationReviewSheetProps {
  target: GraduationTarget;
  plan: TierMigrationPlan | null;
  planError: string | null;
  consent: ContinuityConsent;
  receipt: TierMigrationReceipt | null;
  busy: boolean;
  allConsentGranted: boolean;
  onToggleConsent: (key: keyof ContinuityConsent) => void;
  onExecute: () => void;
  onClose: () => void;
}

function GraduationReviewSheet({
  target,
  plan,
  planError,
  consent,
  receipt,
  busy,
  allConsentGranted,
  onToggleConsent,
  onExecute,
  onClose,
}: GraduationReviewSheetProps) {
  const Icon = target.icon;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Graduate to ${target.displayName}`}
      style={sheetOverlayStyle}
    >
      <div style={sheetCardStyle}>
        <div style={sheetHeaderStyle}>
          <div style={sheetIconStyle}>
            <Icon size={18} strokeWidth={2.3} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={kickerStyle}>GRADUATE TO</span>
            <strong style={headerTitleStyle}>{target.displayName}</strong>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={closeButtonStyle}
          >
            <X size={14} strokeWidth={2.6} />
          </button>
        </div>

        {planError && (
          <div style={errorBoxStyle}>
            <AlertTriangle size={14} strokeWidth={2.4} />
            <span>{planError}</span>
          </div>
        )}

        {!plan && !planError && !receipt && (
          <p style={mutedStyle}>Preparing migration plan…</p>
        )}

        {plan && !receipt && (
          <>
            <div style={sectionLabelStyle}>CHANGES</div>
            <ul style={changeListStyle}>
              {plan.estimatedChanges.map((c, i) => (
                <li key={i} style={changeRowStyle}>
                  <span style={badgeStyle(c.kind)}>{c.kind}</span>
                  <span style={{ opacity: 0.85 }}>{c.area}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{c.detail}</span>
                </li>
              ))}
            </ul>

            <div style={sectionLabelStyle}>CONTINUITY CONSENT</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(Object.keys(CONSENT_COPY) as Array<keyof ContinuityConsent>).map(
                (key) => (
                  <label key={key} style={consentRowStyle}>
                    <input
                      type="checkbox"
                      checked={consent[key]}
                      onChange={() => onToggleConsent(key)}
                    />
                    <span>{CONSENT_COPY[key]}</span>
                  </label>
                )
              )}
            </div>

            <div style={sheetActionsStyle}>
              <button type="button" onClick={onClose} style={secondaryBtnStyle}>
                Cancel
              </button>
              <button
                type="button"
                onClick={onExecute}
                disabled={!allConsentGranted || busy}
                style={{
                  ...primaryBtnStyle,
                  opacity: !allConsentGranted || busy ? 0.5 : 1,
                  cursor:
                    !allConsentGranted || busy ? "not-allowed" : "pointer",
                }}
              >
                {busy ? "Graduating…" : "Execute graduation"}
              </button>
            </div>
          </>
        )}

        {receipt && (
          <>
            <div style={successBoxStyle}>
              <CheckCircle2 size={16} strokeWidth={2.4} />
              <strong>Graduation complete</strong>
            </div>
            <dl style={receiptListStyle}>
              <ReceiptRow label="Plan hash" value={receipt.planHash} />
              <ReceiptRow label="New tenant" value={receipt.toTenantId} />
              <ReceiptRow
                label="Predecessor"
                value={receipt.fromTenantId}
              />
              <ReceiptRow
                label="Audit events carried"
                value={String(receipt.auditEventsCarried)}
              />
              <ReceiptRow
                label="Credentials carried"
                value={String(receipt.credentialsCarried)}
              />
            </dl>
            <div style={sheetActionsStyle}>
              <button type="button" onClick={onClose} style={primaryBtnStyle}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={receiptRowStyle}>
      <dt style={{ opacity: 0.7 }}>{label}</dt>
      <dd style={{ margin: 0, fontFamily: "monospace", wordBreak: "break-all" }}>
        {value}
      </dd>
    </div>
  );
}

/* ─── Inline styles (keeps the patch self-contained) ──────────────── */

const sheetOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(7, 10, 18, 0.78)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  padding: 12,
  zIndex: 50,
};

const sheetCardStyle: React.CSSProperties = {
  background: "#ffffff",
  color: "#0b1220",
  borderRadius: 16,
  padding: 16,
  width: "100%",
  maxHeight: "92vh",
  overflowY: "auto",
  boxShadow: "0 20px 48px rgba(0,0,0,0.32)",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const sheetHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const sheetIconStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 10,
  background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
  color: "white",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const kickerStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  letterSpacing: 0.6,
  opacity: 0.65,
};

const headerTitleStyle: React.CSSProperties = {
  display: "block",
  fontSize: 15,
  fontWeight: 600,
};

const closeButtonStyle: React.CSSProperties = {
  background: "#f1f5f9",
  border: "none",
  width: 28,
  height: 28,
  borderRadius: 8,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 0.8,
  opacity: 0.55,
  fontWeight: 700,
  marginTop: 4,
};

const changeListStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  maxHeight: 180,
  overflowY: "auto",
};

const changeRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  padding: "6px 8px",
  background: "#f8fafc",
  borderRadius: 8,
};

const consentRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  fontSize: 12,
  padding: "6px 0",
  cursor: "pointer",
};

const sheetActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 4,
};

const primaryBtnStyle: React.CSSProperties = {
  flex: 1,
  background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
  color: "white",
  border: "none",
  padding: "10px 12px",
  borderRadius: 10,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  flex: 1,
  background: "#f1f5f9",
  color: "#0b1220",
  border: "none",
  padding: "10px 12px",
  borderRadius: 10,
  fontWeight: 500,
  cursor: "pointer",
};

const errorBoxStyle: React.CSSProperties = {
  background: "#fef2f2",
  color: "#991b1b",
  border: "1px solid #fecaca",
  borderRadius: 10,
  padding: 10,
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
};

const successBoxStyle: React.CSSProperties = {
  background: "#ecfdf5",
  color: "#065f46",
  border: "1px solid #a7f3d0",
  borderRadius: 10,
  padding: 10,
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontWeight: 600,
  fontSize: 13,
};

const receiptListStyle: React.CSSProperties = {
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
};

const receiptRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  padding: "6px 8px",
  background: "#f8fafc",
  borderRadius: 8,
};

const mutedStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.7,
};

function badgeStyle(kind: "added" | "removed" | "modified"): React.CSSProperties {
  const palette = {
    added: { bg: "#dcfce7", fg: "#166534" },
    removed: { bg: "#fee2e2", fg: "#991b1b" },
    modified: { bg: "#fef3c7", fg: "#854d0e" },
  } as const;
  const p = palette[kind];
  return {
    background: p.bg,
    color: p.fg,
    padding: "1px 6px",
    borderRadius: 6,
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  };
}
