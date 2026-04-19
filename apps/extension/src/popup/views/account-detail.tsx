import { useMemo, useState, useEffect, useRef } from "react";
import {
  ArrowLeft, Copy, Check, Send, QrCode, ExternalLink,
  Hexagon, Wallet, KeyRound, Cpu, Building2, Coins,
  Shield, Fingerprint, AlertTriangle, Info, Pencil, Trash2,
  CheckCircle2, X,
} from "lucide-react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import { useComingSoon } from "../hooks/use-coming-soon";
import { useCopyToClipboard } from "../hooks/use-copy-to-clipboard";
import { useAccountActions } from "../hooks/use-account-actions";
import { useToast } from "../components/toast";
import { Tooltip } from "../components/tooltip";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";

/* Same maps as the Accounts list — kept in sync via the shared
   WalletAccount type so the detail page shows identical iconography
   and colors. */

type Namespace = "eip155" | "aethelred";
type Custody = "local" | "imported" | "hardware" | "institutional" | "approval-bound";
type Assurance = "passkey" | "device-key" | "hardware" | "approval-bound";

const NAMESPACE_META: Record<Namespace, { label: string; color: string; icon: typeof Hexagon; chainExample: string }> = {
  "eip155":    { label: "EVM",        color: "#2775ca", icon: Hexagon, chainExample: "Ethereum · Polygon · Base" },
  "aethelred": { label: "Aethelred",  color: "#c41e1e", icon: Wallet,  chainExample: "Aethelred L1" },
};

const CUSTODY_META: Record<Custody, { label: string; icon: typeof KeyRound; color: string; description: string }> = {
  "local":          { label: "Local Key",         icon: KeyRound,  color: "#34c759", description: "Encrypted on this device" },
  "imported":       { label: "Imported",          icon: Wallet,    color: "#0ea5e9", description: "Imported from recovery phrase" },
  "hardware":       { label: "Hardware Wallet",   icon: Cpu,       color: "#8b5cf6", description: "Signed on Ledger / Trezor" },
  "institutional":  { label: "Institutional",     icon: Building2, color: "#6366f1", description: "Held in institutional custody" },
  "approval-bound": { label: "Approval-Bound",    icon: Coins, color: "#ff9f0a", description: "Requires multi-party approval" },
};

const ASSURANCE_META: Record<Assurance, { label: string; icon: typeof Shield; description: string }> = {
  "passkey":        { label: "Passkey",        icon: Fingerprint, description: "Biometric + platform authenticator" },
  "device-key":     { label: "Device Key",     icon: KeyRound,    description: "Private key stored on device" },
  "hardware":       { label: "Hardware",       icon: Cpu,         description: "Hardware wallet signing" },
  "approval-bound": { label: "Approval-Bound", icon: Coins,   description: "Requires human approval" },
};

export function AccountDetailView({ state }: { state: AethelredWalletState }) {
  const { navigate, params } = useNavigation();
  const comingSoon = useComingSoon();
  const { copy, copied } = useCopyToClipboard(1800);
  const { setActive, rename, busy } = useAccountActions();
  const { toast } = useToast();

  const accountId = params?.accountId;
  const explorerUnavailable = IS_PRODUCTION_BUILD;
  const accountRemovalUnavailable = IS_PRODUCTION_BUILD;

  const account = useMemo(
    () => state.accounts.find(a => a.id === accountId),
    [state.accounts, accountId],
  );

  /* Is this the currently-selected "from" account? Drives the
   * "Make Active" CTA visibility and the big "Active" checkmark pill
   * in the hero. Falls back to accounts[0] like accounts.tsx does, so
   * pre-`activeAccountId` persisted state still resolves cleanly. */
  const activeId = state.activeAccountId ?? state.accounts[0]?.id ?? "";
  const isActive = account?.id === activeId;

  /* Inline rename state — we swap the hero title for a controlled
   * <input> when renaming is true. The ref is used to auto-focus on
   * entry and select the whole label so the user can just start
   * typing. Discarding on Esc restores the saved label. */
  const [renaming, setRenaming] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const labelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      setLabelDraft(account?.label ?? "");
      // Defer focus to next frame so the input is mounted first.
      requestAnimationFrame(() => {
        labelInputRef.current?.focus();
        labelInputRef.current?.select();
      });
    }
  }, [renaming, account?.label]);

  const handleMakeActive = async () => {
    if (!account || isActive) return;
    const res = await setActive(account.id);
    if (res.ok) {
      toast("success", `${account.label} is now active`);
    } else {
      toast("error", res.error ?? "Could not switch active account");
    }
  };

  const handleRenameSubmit = async () => {
    if (!account) return;
    if (labelDraft.trim() === account.label) {
      setRenaming(false);
      return;
    }
    const res = await rename(account.id, labelDraft);
    if (res.ok) {
      setRenaming(false);
      toast("success", "Account renamed");
    } else {
      toast("error", res.error ?? "Could not rename account");
    }
  };

  const handleRenameKeyDown = (evt: React.KeyboardEvent<HTMLInputElement>) => {
    if (evt.key === "Enter") {
      evt.preventDefault();
      handleRenameSubmit();
    } else if (evt.key === "Escape") {
      evt.preventDefault();
      setRenaming(false);
    }
  };

  if (!account) {
    return (
      <div className="view-padded">
        <button className="acc-back" onClick={() => navigate("accounts")} type="button">
          <ArrowLeft size={14} strokeWidth={2.3} />
          <span>Accounts</span>
        </button>
        <div className="acc-empty">
          <AlertTriangle size={20} />
          <strong>Account not found</strong>
          <span>The requested account may have been removed.</span>
        </div>
      </div>
    );
  }

  const ns = NAMESPACE_META[account.namespace as Namespace];
  const custody = CUSTODY_META[account.custody as Custody];
  const assurance = ASSURANCE_META[account.assurance as Assurance];
  const NsIcon = ns.icon;

  /* Powered by the useCopyToClipboard hook which:
   *   1. Writes to navigator.clipboard (falls back to execCommand)
   *   2. Tracks transient "copied" state with auto-reset
   *   3. Surfaces errors for us to toast
   * We emit a success toast on copy so the user gets feedback even if
   * they're looking elsewhere (e.g. tapping the button via screen reader). */
  const copyAddress = async () => {
    const ok = await copy(account.address, "addr");
    if (ok) {
      toast("success", "Address copied");
    } else {
      toast("error", "Clipboard access denied");
    }
  };

  return (
    <div className="view-padded">
      <button className="acc-back" onClick={() => navigate("accounts")} type="button">
        <ArrowLeft size={14} strokeWidth={2.3} />
        <span>Accounts</span>
      </button>

      {/* ═════ Hero — identity card ═════ */}
      <div
        className="acd-hero"
        style={{
          background: `linear-gradient(135deg, ${ns.color}20 0%, ${ns.color}05 100%)`,
          borderColor: `${ns.color}50`,
        }}
      >
        <div
          className="acd-hero-avatar"
          style={{
            background: `linear-gradient(135deg, ${ns.color} 0%, ${ns.color}c0 100%)`,
            boxShadow: `0 6px 22px ${ns.color}50, inset 0 1px 0 rgba(255,255,255,0.3)`,
          }}
        >
          <NsIcon size={24} strokeWidth={2.3} />
        </div>
        <span className="acd-hero-kicker" style={{ color: ns.color }}>
          {ns.label} WALLET {isActive && <span style={{ marginLeft: 8 }}>· ACTIVE</span>}
        </span>
        {renaming ? (
          <div
            className="acd-hero-name-edit"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <input
              ref={labelInputRef}
              type="text"
              maxLength={40}
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              disabled={busy}
              aria-label="Account label"
              style={{
                fontSize: "1.15rem",
                fontWeight: 700,
                background: "rgba(0,0,0,0.2)",
                border: `1px solid ${ns.color}66`,
                borderRadius: 8,
                padding: "4px 10px",
                color: "inherit",
                minWidth: 180,
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={handleRenameSubmit}
              disabled={busy}
              aria-label="Save label"
              style={{
                background: ns.color,
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "4px 6px",
                cursor: "pointer",
              }}
            >
              <Check size={12} strokeWidth={3} />
            </button>
            <button
              type="button"
              onClick={() => setRenaming(false)}
              disabled={busy}
              aria-label="Cancel rename"
              style={{
                background: "rgba(0,0,0,0.25)",
                color: "inherit",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 6,
                padding: "4px 6px",
                cursor: "pointer",
              }}
            >
              <X size={12} strokeWidth={3} />
            </button>
          </div>
        ) : (
          <strong className="acd-hero-name">{account.label}</strong>
        )}
        <span className="acd-hero-chain">{ns.chainExample}</span>

        {/* Full address block — monospace, with copy action.
            Tooltip primitive provides the hover label; useCopyToClipboard
            manages the transient "copied" state + the underlying API call. */}
        <div className="acd-address-block">
          <code className="acd-address-full">{account.address}</code>
          <Tooltip
            content={copied === "addr" ? "Copied to clipboard" : "Copy full address"}
            position="top"
            delay={300}
          >
            <button
              className="acd-address-copy"
              onClick={copyAddress}
              type="button"
              aria-label="Copy address"
            >
              {copied === "addr"
                ? <><Check size={11} strokeWidth={3.2} /> Copied</>
                : <><Copy size={11} strokeWidth={2.3} /> Copy</>}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* ═════ Action row — quick buttons ═════ */}
      <div className="acd-actions">
        <button className="acd-action" onClick={() => navigate("send")} type="button">
          <div className="acd-action-icon" style={{ background: "linear-gradient(135deg, #c41e1e 0%, #e63e3e 100%)" }}>
            <Send size={15} strokeWidth={2.4} />
          </div>
          <span>Send</span>
        </button>
        <button className="acd-action" onClick={() => navigate("receive")} type="button">
          <div className="acd-action-icon" style={{ background: "linear-gradient(135deg, #34c759 0%, #30d158 100%)" }}>
            <QrCode size={15} strokeWidth={2.4} />
          </div>
          <span>Receive</span>
        </button>
        {!explorerUnavailable && (
          <button
            className="acd-action is-coming-soon"
            type="button"
            onClick={() => comingSoon("Block explorer", "ships with mainnet")}
            aria-label="Open in block explorer — coming soon"
          >
            <div className="acd-action-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
              <ExternalLink size={15} strokeWidth={2.4} />
            </div>
            <span>Explorer</span>
          </button>
        )}
      </div>

      {/* ═════ Security properties ═════ */}
      <div className="acd-section-label">SECURITY</div>
      <div className="acd-panel">
        <div className="acd-prop">
          <div
            className="acd-prop-icon"
            style={{
              background: `linear-gradient(135deg, ${custody.color} 0%, ${custody.color}c0 100%)`,
            }}
          >
            <custody.icon size={14} strokeWidth={2.3} />
          </div>
          <div className="acd-prop-body">
            <span>CUSTODY</span>
            <strong>{custody.label}</strong>
            <span className="acd-prop-desc">{custody.description}</span>
          </div>
        </div>
        <div className="acd-prop-divider" />
        <div className="acd-prop">
          <div
            className="acd-prop-icon"
            style={{ background: "linear-gradient(135deg, #64748b 0%, #94a3b8 100%)" }}
          >
            <assurance.icon size={14} strokeWidth={2.3} />
          </div>
          <div className="acd-prop-body">
            <span>ASSURANCE</span>
            <strong>{assurance.label}</strong>
            <span className="acd-prop-desc">{assurance.description}</span>
          </div>
        </div>
      </div>

      {/* ═════ Identity fields ═════ */}
      <div className="acd-section-label">DETAILS</div>
      <div className="acd-fields">
        <div className="acd-field">
          <span>Account ID</span>
          <code>{account.id}</code>
        </div>
        <div className="acd-field">
          <span>Namespace</span>
          <strong>{account.namespace}</strong>
        </div>
        <div className="acd-field">
          <span>Display name</span>
          <strong>{account.label}</strong>
        </div>
      </div>

      {/* ═════ Management actions ═════ */}
      <div className="acd-section-label">MANAGE</div>
      <div className="acd-manage">
        {!isActive && (
          <button
            className="acd-manage-row"
            type="button"
            onClick={handleMakeActive}
            disabled={busy}
          >
            <div
              className="acd-manage-icon"
              style={{
                background: `linear-gradient(135deg, ${ns.color} 0%, ${ns.color}c0 100%)`,
              }}
            >
              <CheckCircle2 size={13} strokeWidth={2.3} />
            </div>
            <div className="acd-manage-body">
              <strong>Make active account</strong>
              <span>Use this account as the default "from" for sends &amp; swaps</span>
            </div>
          </button>
        )}
        <button
          className="acd-manage-row"
          type="button"
          onClick={() => setRenaming(true)}
          disabled={busy || renaming}
        >
          <div className="acd-manage-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
            <Pencil size={13} strokeWidth={2.3} />
          </div>
          <div className="acd-manage-body">
            <strong>Rename</strong>
            <span>Change the display label</span>
          </div>
        </button>
        {explorerUnavailable ? (
          <button
            className="acd-manage-row"
            type="button"
            disabled
            aria-label="View on explorer unavailable in this release"
          >
            <div className="acd-manage-icon" style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)" }}>
              <Info size={13} strokeWidth={2.3} />
            </div>
            <div className="acd-manage-body">
              <strong>View on explorer unavailable</strong>
              <span>This release hides explorer links until a live explorer is configured.</span>
            </div>
          </button>
        ) : (
          <button
            className="acd-manage-row is-coming-soon"
            type="button"
            onClick={() => comingSoon("Block explorer", "ships with mainnet")}
          >
            <div className="acd-manage-icon" style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)" }}>
              <Info size={13} strokeWidth={2.3} />
            </div>
            <div className="acd-manage-body">
              <strong>View on explorer <span className="soon-pill">Soon</span></strong>
              <span>Open in block explorer</span>
            </div>
          </button>
        )}
        {accountRemovalUnavailable ? (
          <button
            className="acd-manage-row danger"
            type="button"
            disabled
            aria-label="Account removal unavailable in this release"
          >
            <div className="acd-manage-icon" style={{ background: "linear-gradient(135deg, #ff3b30 0%, #ff6b6b 100%)" }}>
              <Trash2 size={13} strokeWidth={2.3} />
            </div>
            <div className="acd-manage-body">
              <strong>Account removal unavailable</strong>
              <span>This release does not expose account removal from the popup.</span>
            </div>
          </button>
        ) : (
          <button
            className="acd-manage-row danger is-coming-soon"
            type="button"
            onClick={() => comingSoon("Remove account", "account removal ships in v0.9.2")}
          >
            <div className="acd-manage-icon" style={{ background: "linear-gradient(135deg, #ff3b30 0%, #ff6b6b 100%)" }}>
              <Trash2 size={13} strokeWidth={2.3} />
            </div>
            <div className="acd-manage-body">
              <strong>Remove account <span className="soon-pill">Soon</span></strong>
              <span>Does not delete the private key</span>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
