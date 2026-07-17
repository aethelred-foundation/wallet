import { useState, useMemo } from "react";
import {
  Wallet, Copy, Check, ArrowLeft, Plus, Shield, KeyRound,
  Cpu, Building2, Coins, Fingerprint, ChevronRight, Hexagon,
  CheckCircle2,
} from "lucide-react";
import type { AethelredWalletState, WalletAccount } from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import { useAccountActions } from "../hooks/use-account-actions";
import { useToast } from "../components/toast";
import { useHaptics } from "../hooks/use-haptics";
import { useSound } from "../hooks/use-sound";
import { useCopyToClipboard } from "../hooks/use-copy-to-clipboard";

/* ─── Namespace / custody / assurance → icon + color maps ─────────── *
 * Each account property gets a semantic color. `eip155` (EVM) gets blue,
 * `aethelred` gets red (the brand). Custody modes are differentiated by
 * iconography — hardware wallets get a Cpu icon, institutional gets a
 * Building, approval-bound gets Coins, etc. */

type Namespace = "eip155" | "aethelred";
type Custody = "local" | "imported" | "hardware" | "institutional" | "approval-bound";
type Assurance = "passkey" | "device-key" | "hardware" | "approval-bound";

const NAMESPACE_META: Record<Namespace, { label: string; color: string; icon: typeof Hexagon }> = {
  "eip155":    { label: "EVM",        color: "#2775ca", icon: Hexagon },
  "aethelred": { label: "Aethelred",  color: "#c41e1e", icon: Wallet  },
};

const CUSTODY_META: Record<Custody, { label: string; icon: typeof KeyRound; color: string }> = {
  "local":          { label: "Local",          icon: KeyRound,  color: "#34c759" },
  "imported":       { label: "Imported",       icon: Wallet,    color: "#0ea5e9" },
  "hardware":       { label: "Hardware",       icon: Cpu,       color: "#8b5cf6" },
  "institutional":  { label: "Institutional",  icon: Building2, color: "#6366f1" },
  "approval-bound": { label: "Approval-Bound", icon: Coins, color: "#ff9f0a" },
};

const ASSURANCE_META: Record<Assurance, { label: string; icon: typeof Shield }> = {
  "passkey":        { label: "Passkey",        icon: Fingerprint },
  "device-key":     { label: "Device Key",     icon: KeyRound    },
  "hardware":       { label: "Hardware",       icon: Cpu         },
  "approval-bound": { label: "Approval-Bound", icon: Coins   },
};

type FilterKey = "all" | Namespace;

export function AccountsView({ state }: { state: AethelredWalletState }) {
  const { navigate } = useNavigation();
  const { setActive, derive, busy } = useAccountActions();
  const { toast } = useToast();
  const haptics = useHaptics();
  const audio = useSound();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [switching, setSwitching] = useState<string | null>(null);
  const { copy, copied } = useCopyToClipboard(1800);

  const accounts: WalletAccount[] = state.accounts;

  /* Resolve the active account by id, falling back to accounts[0] so
   * an older state blob without `activeAccountId` still has a valid
   * "active" card. We key all "is active" decisions off this id so the
   * hero, the pill in the list, and the Make-Active tap target stay
   * in sync even if the user has just switched. */
  const activeId = state.activeAccountId ?? accounts[0]?.id ?? "";
  const active = useMemo(
    () => accounts.find(a => a.id === activeId) ?? accounts[0],
    [accounts, activeId],
  );

  const counts = useMemo(() => {
    const out = { all: accounts.length, eip155: 0, aethelred: 0 };
    for (const a of accounts) {
      if (a.namespace === "eip155") out.eip155++;
      if (a.namespace === "aethelred") out.aethelred++;
    }
    return out;
  }, [accounts]);

  const filtered = useMemo(() => {
    if (filter === "all") return accounts;
    return accounts.filter(a => a.namespace === filter);
  }, [accounts, filter]);

  const copyAddress = async (address: string, evt?: React.MouseEvent) => {
    evt?.stopPropagation();
    const ok = await copy(address, address);
    if (ok) {
      haptics.success();
      audio.playCopy();
    } else {
      haptics.error();
      toast("error", "Unable to copy address to the clipboard");
    }
  };

  /* Switching the active account is a no-op if they tap the already-active
   * row. We track `switching` separately from `busy` so we can show a ring
   * on the exact card that was tapped — `busy` would gray out every row. */
  const handleSwitch = async (account: WalletAccount, evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (account.id === activeId) return;
    haptics.impact("medium");
    setSwitching(account.id);
    const res = await setActive(account.id);
    setSwitching(null);
    if (res.ok) {
      haptics.success();
      toast("success", `Switched to ${account.label}`);
    } else {
      haptics.error();
      toast("error", res.error ?? "Could not switch account");
    }
  };

  const handleAddAccount = async () => {
    haptics.impact("medium");
    const result = await derive();
    if (result.ok) {
      haptics.success();
      toast("success", "Account created");
    } else {
      haptics.error();
      toast("error", result.error ?? "Could not create account");
    }
  };

  return (
    <div className="view-padded">
      {/* Back to Settings */}
      <button className="acc-back" onClick={() => navigate("settings")} type="button">
        <ArrowLeft size={14} strokeWidth={2.3} />
        <span>Settings</span>
      </button>

      {/* ═════ Hero — total wallets + primary summary ═════ */}
      <div className="acc-hero">
        <div className="acc-hero-top">
          <div className="acc-hero-icon">
            <Wallet size={20} strokeWidth={2.3} />
          </div>
          <div className="acc-hero-info">
            <span className="acc-hero-label">WALLETS</span>
            <strong className="acc-hero-title">
              {accounts.length} <span>account{accounts.length === 1 ? "" : "s"}</span>
            </strong>
            <span className="acc-hero-sub">Across {counts.eip155 > 0 && counts.aethelred > 0 ? "EVM & Aethelred" : counts.eip155 > 0 ? "EVM chains" : "Aethelred"}</span>
          </div>
          <button
            className="acc-hero-add"
            disabled={busy}
            onClick={() => void handleAddAccount()}
            type="button"
            title="Add account"
          >
            <Plus size={14} strokeWidth={2.6} />
          </button>
        </div>
        {active && (
          <div className="acc-hero-primary">
            <span className="acc-hero-primary-label">ACTIVE</span>
            <code className="acc-hero-primary-addr">
              {active.address.slice(0, 10)}…{active.address.slice(-8)}
            </code>
            <button
              className="acc-hero-primary-copy"
              onClick={() => void copyAddress(active.address)}
              type="button"
              title="Copy active address"
            >
              {copied === active.address
                ? <Check size={11} strokeWidth={3.2} />
                : <Copy size={11} strokeWidth={2.3} />}
            </button>
          </div>
        )}
      </div>

      {/* ═════ Namespace filter chips ═════ */}
      <div className="acc-filters">
        <button
          className={`acc-filter ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
          type="button"
        >
          All <span className="acc-filter-count">{counts.all}</span>
        </button>
        {counts.eip155 > 0 && (
          <button
            className={`acc-filter ${filter === "eip155" ? "active" : ""}`}
            onClick={() => setFilter("eip155")}
            type="button"
          >
            <Hexagon size={10} strokeWidth={2.6} />
            EVM <span className="acc-filter-count">{counts.eip155}</span>
          </button>
        )}
        {counts.aethelred > 0 && (
          <button
            className={`acc-filter ${filter === "aethelred" ? "active" : ""}`}
            onClick={() => setFilter("aethelred")}
            type="button"
          >
            <Wallet size={10} strokeWidth={2.6} />
            Aethelred <span className="acc-filter-count">{counts.aethelred}</span>
          </button>
        )}
      </div>

      {/* ═════ Account list ═════ */}
      <div className="acc-section-label">{filtered.length} of {accounts.length}</div>

      {filtered.length === 0 ? (
        <div className="acc-empty">
          <Wallet size={20} />
          <strong>No accounts</strong>
          <span>Try a different filter or create a new account.</span>
        </div>
      ) : (
        <div className="acc-list">
          {filtered.map((account) => {
            const ns = NAMESPACE_META[account.namespace as Namespace] ?? NAMESPACE_META.eip155;
            const custody = CUSTODY_META[account.custody as Custody] ?? CUSTODY_META.local;
            const assurance = ASSURANCE_META[account.assurance as Assurance] ?? ASSURANCE_META.passkey;
            const NsIcon = ns.icon;
            const CustodyIcon = custody.icon;
            const AssuranceIcon = assurance.icon;
            const isActive = account.id === activeId;
            const isSwitchingThis = switching === account.id;

            /* Restructured from a single nested <button> (which caused
             * validateDOMNesting warnings and broken click targeting) into
             * a <div> container with two siblings:
             *   1. `.acc-card-open` — full-width button that handles the
             *      "navigate to detail" tap, covers the avatar + body
             *   2. `.acc-card-actions` — sibling container holding the
             *      action buttons (Switch, Copy) as genuine siblings of
             *      the open button, not descendants.
             * This is the same pattern MUI/Radix use for "clickable card
             * with action buttons" — valid HTML, proper a11y, and pointer
             * events hit the element the user actually tapped. */
            return (
              <div
                key={account.id}
                className={`acc-card${isActive ? " is-active" : ""}`}
                style={
                  isActive
                    ? {
                        borderColor: `${ns.color}80`,
                        boxShadow: `0 0 0 1px ${ns.color}40, 0 6px 18px ${ns.color}20`,
                      }
                    : undefined
                }
              >
                <button
                  className="acc-card-open"
                  onClick={() => navigate("account-detail", { accountId: account.id })}
                  type="button"
                  aria-label={`Open ${account.label} details`}
                >
                  <div
                    className="acc-card-avatar"
                    style={{
                      background: `linear-gradient(135deg, ${ns.color} 0%, ${ns.color}c0 100%)`,
                      boxShadow: `0 4px 14px ${ns.color}40`,
                    }}
                  >
                    <NsIcon size={18} strokeWidth={2.3} />
                  </div>
                  <div className="acc-card-body">
                    <div className="acc-card-top">
                      <strong>{account.label}</strong>
                      {isActive && (
                        <span
                          className="acc-card-primary"
                          style={{ background: `${ns.color}20`, color: ns.color }}
                        >
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <code className="acc-card-addr">
                      {account.address.slice(0, 6)}…{account.address.slice(-4)}
                    </code>
                    <div className="acc-card-meta">
                      <div className="acc-card-chip">
                        <CustodyIcon size={9} strokeWidth={2.6} style={{ color: custody.color }} />
                        {custody.label}
                      </div>
                      <div className="acc-card-chip">
                        <AssuranceIcon size={9} strokeWidth={2.6} />
                        {assurance.label}
                      </div>
                    </div>
                  </div>
                  <ChevronRight size={14} className="acc-card-arrow" />
                </button>
                <div className="acc-card-actions">
                  {!isActive && (
                    <button
                      className="acc-card-copy"
                      onClick={(e) => handleSwitch(account, e)}
                      disabled={busy || isSwitchingThis}
                      type="button"
                      title="Make this the active account"
                      aria-label="Switch to this account"
                    >
                      <CheckCircle2
                        size={12}
                        strokeWidth={2.6}
                        style={{ opacity: isSwitchingThis ? 0.4 : 1 }}
                      />
                    </button>
                  )}
                  <button
                    className="acc-card-copy"
                    onClick={(e) => void copyAddress(account.address, e)}
                    type="button"
                    title="Copy address"
                    aria-label="Copy address"
                  >
                    {copied === account.address
                      ? <Check size={12} strokeWidth={3.2} />
                      : <Copy size={12} strokeWidth={2.3} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
