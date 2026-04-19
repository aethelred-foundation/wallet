import { useState, useMemo } from "react";
import {
  ShieldAlert,
  AlertTriangle,
  Infinity as InfinityIcon,
  ArrowLeft,
  Trash2,
  Coins,
} from "lucide-react";
import { ConfirmModal } from "../components/confirm-modal";
import { TokenLogo } from "../components/token-logo";
import { useNavigation } from "../router";
import { useBackground } from "../hooks/use-background";

/* Shared permissions stylesheet (.tok2-* classes). Co-located import
   so it only loads when one of the permission views mounts. */
import "../../styles/legacy/permissions.css";

interface TokenApproval {
  id: string;
  token: string;
  symbol: string;
  spender: string;
  spenderLabel: string;
  allowance: string;
  isUnlimited: boolean;
  grantedAt: number;
  riskLevel: "safe" | "medium" | "high";
}

/* Seed data — the extension hasn't wired a real token-approval
   indexer yet, so we render from an in-memory list. Keeping this
   here (rather than moving to the background) preserves the
   revoke-on-send-transaction flow the original view shipped with. */
const DEMO_APPROVALS: TokenApproval[] = [
  {
    id: "1",
    token: "USDC",
    symbol: "USDC",
    spender: "0x7a25...488d",
    spenderLabel: "Uniswap V2 Router",
    allowance: "Unlimited",
    isUnlimited: true,
    grantedAt: Date.now() - 4 * 86400000,
    riskLevel: "medium",
  },
  {
    id: "2",
    token: "AETHEL",
    symbol: "AETHEL",
    spender: "0xCruz...Vault",
    spenderLabel: "Cruzible Vault",
    allowance: "100,000",
    isUnlimited: false,
    grantedAt: Date.now() - 2 * 86400000,
    riskLevel: "safe",
  },
  {
    id: "3",
    token: "USDT",
    symbol: "USDT",
    spender: "0x6832...c8ef",
    spenderLabel: "Unknown Contract",
    allowance: "Unlimited",
    isUnlimited: true,
    grantedAt: Date.now() - 10 * 86400000,
    riskLevel: "high",
  },
];

/**
 * TokenApprovalsView — "Apple-grade" re-skin of the ERC-20 approvals
 * dashboard. Groups approvals by token symbol so a user revoking
 * multiple spenders for the same token can scan them as a set,
 * and promotes the red accent so the inherent security risk of
 * these grants is obvious on entry.
 *
 * Preserved unchanged from the original implementation:
 *   • the revoke handler fires an eth_sendTransaction with
 *     approve(spender, 0) encoded in the calldata
 *   • unlimited-vs-capped detection drives the pill variant
 *   • ConfirmModal gates destructive actions
 */
export function TokenApprovalsView() {
  const { navigate } = useNavigation();
  const { send } = useBackground();
  const [approvals, setApprovals] = useState(DEMO_APPROVALS);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);

  /* Pre-compute the groups only when the approvals list changes.
     useMemo keeps the grouped shape stable across renders so React
     doesn't tear the list down on every keypress elsewhere. */
  const groups = useMemo(() => {
    const map = new Map<string, TokenApproval[]>();
    for (const a of approvals) {
      if (!map.has(a.symbol)) map.set(a.symbol, []);
      map.get(a.symbol)!.push(a);
    }
    return Array.from(map.entries()).map(([symbol, items]) => ({ symbol, items }));
  }, [approvals]);

  const unlimitedCount = approvals.filter((a) => a.isUnlimited).length;
  const revokable = approvals.find((a) => a.id === revoking);

  const handleRevoke = async () => {
    if (!revoking || !revokable) return;
    setRevokeLoading(true);
    try {
      // approve(spender, 0) — keeps the original encoding so the
      // background's tx-screening pipeline sees the same calldata.
      await send("rpc-request", {
        method: "eth_sendTransaction",
        params: [{
          from: "0xae7e3d7c2a4c5b11f9d0b9ea81c3f4e55cafef10",
          to:
            revokable.token === "USDC"
              ? "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
              : "0xdac17f958d2ee523a2206206994597c13d831ec7",
          data:
            "0x095ea7b3" +
            revokable.spender.slice(2).padStart(64, "0") +
            "0".repeat(64),
        }],
      });
      setApprovals((prev) => prev.filter((a) => a.id !== revoking));
    } catch {
      /* keep the row in the list on failure — the user can retry */
    }
    setRevokeLoading(false);
    setRevoking(null);
  };

  return (
    <div className="view-padded">
      <button className="acc-back" onClick={() => navigate("settings")} type="button">
        <ArrowLeft size={14} /> Back
      </button>

      {/* Hero — red accent. This surface exposes spend rights, which
          is the single highest-risk permission a dApp can ask for,
          so the colour language is intentionally loud. */}
      <div className="tok2-hero">
        <div className="tok2-hero-icon">
          <Coins size={22} strokeWidth={2.4} />
        </div>
        <div className="tok2-hero-body">
          <span className="tok2-hero-label">TOKEN APPROVALS</span>
          <strong className="tok2-hero-title">
            {approvals.length === 0 ? "No active grants" : `${approvals.length} active`}
          </strong>
          <span className="tok2-hero-sub">
            <AlertTriangle size={11} strokeWidth={2.6} /> Review periodically
          </span>
        </div>
        {unlimitedCount > 0 && (
          <span className="tok2-hero-badge">{unlimitedCount} Unlimited</span>
        )}
      </div>

      {approvals.length === 0 ? (
        <div className="tok2-empty">
          <div className="tok2-empty-icon">
            <ShieldAlert size={28} strokeWidth={2.2} />
          </div>
          <strong>No active approvals</strong>
          <p>
            Token approvals granted to smart contracts will appear here. Revoke
            stale grants from this page when you're done interacting with a
            dApp.
          </p>
        </div>
      ) : (
        <>
          {/* Advisory strip — the "spend rights" explainer. Sits
              directly under the hero so it is the first thing the
              user reads before scrolling to individual rows. */}
          <div className="tok2-warning">
            <div className="tok2-warning-icon">
              <AlertTriangle size={14} strokeWidth={2.6} />
            </div>
            <div className="tok2-warning-body">
              <strong>Unlimited approvals let dApps spend your tokens at any time.</strong>
              <span>Revoke unused ones to reduce your exposure.</span>
            </div>
          </div>

          {groups.map((group) => (
            <div className="tok2-group" key={group.symbol}>
              {/* Per-token header — logo, symbol, count */}
              <div className="tok2-group-header">
                <div className="tok2-group-logo">
                  <TokenLogo symbol={group.symbol} size={26} />
                </div>
                <span className="tok2-group-symbol">{group.symbol}</span>
                <span className="tok2-group-count">
                  {group.items.length} {group.items.length === 1 ? "grant" : "grants"}
                </span>
              </div>

              {group.items.map((a) => (
                <div className="tok2-row" key={a.id}>
                  <div className="tok2-row-body">
                    <span className="tok2-row-title">{a.spenderLabel}</span>
                    <span className="tok2-row-sub">
                      {a.symbol} · {a.riskLevel} risk
                    </span>
                  </div>

                  <div className="tok2-row-actions">
                    <span
                      className={`tok2-allowance ${a.isUnlimited ? "unlimited" : "capped"}`}
                    >
                      {a.isUnlimited ? (
                        <>
                          <InfinityIcon size={11} strokeWidth={2.6} />
                          Unlimited
                        </>
                      ) : (
                        a.allowance
                      )}
                    </span>
                    <button
                      className="tok2-revoke"
                      onClick={() => setRevoking(a.id)}
                      type="button"
                      aria-label={`Revoke ${a.spenderLabel}`}
                    >
                      <Trash2 size={11} strokeWidth={2.4} /> Revoke
                    </button>
                  </div>

                  <p className="tok2-row-address">{a.spender}</p>
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      <ConfirmModal
        open={!!revoking}
        title="Revoke approval?"
        description={`This will revoke ${revokable?.spenderLabel ?? "this contract"}'s permission to spend your ${revokable?.symbol ?? "tokens"}. This requires a transaction.`}
        confirmLabel={revokeLoading ? "Revoking..." : "Revoke"}
        variant="danger"
        onConfirm={handleRevoke}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}
