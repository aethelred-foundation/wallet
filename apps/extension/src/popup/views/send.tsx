import { useState, useEffect, useMemo } from "react";
import {
  ArrowLeft, ChevronDown, AlertTriangle, CheckCircle2, Fuel, Loader2,
  Check, X, Send, ExternalLink,
} from "lucide-react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import { useBackground } from "../hooks/use-background";
import { useLiveBalances, type LiveToken } from "../hooks/use-live-balances";
import { useAddressBook } from "../services/services-context";
import { TokenLogo } from "../components/token-logo";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";
import "../../styles/legacy/transact.css";

/**
 * Shape adapter for send.tsx.
 *
 * The legacy PortfolioManager returned `{ token: { symbol, address, ... },
 * balance, balanceFormatted, price, priceChange24h, value }`. The new live
 * balances from background return a flat shape. Rather than rewrite every
 * JSX reference in this 450-line view, we build a minimal adapter that
 * wraps a LiveToken back into the legacy shape so the rest of the
 * component is untouched. The ~5 field accesses `t.token.symbol`,
 * `t.token.address`, `t.token.logoColor`, `t.balanceFormatted`, etc. all
 * work unchanged.
 */
interface LegacyShapedToken {
  token: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoColor: string;
    category: string;
    chainId: string;
  };
  balance: string;
  balanceFormatted: string;
  price: number;
  priceChange24h: number;
  value: number;
}

function liveToLegacy(t: LiveToken): LegacyShapedToken {
  return {
    token: {
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      logoColor: "#6e6e73",
      category: "other",
      chainId: "0x1",
    },
    balance: t.balance,
    balanceFormatted: t.balance,
    price: t.priceUsd,
    priceChange24h: t.change24h,
    value: t.value,
  };
}

type GasSpeed = "slow" | "standard" | "fast";

/* Fallback gas prices (used when RPC is unavailable) */
const FALLBACK_GAS: Record<GasSpeed, { label: string; gwei: string; time: string; cost: string }> = {
  slow:     { label: "Slow",     gwei: "12", time: "~5 min",  cost: "$0.38" },
  standard: { label: "Standard", gwei: "18", time: "~30 sec", cost: "$0.57" },
  fast:     { label: "Fast",     gwei: "25", time: "~15 sec", cost: "$0.79" },
};

/* Demo recent addresses — replaced with real history once contact book ships. */
const RECENT_ADDRESSES: { label: string; address: string }[] = [
  { label: "Treasury Ops", address: "0xae7e3f1c2b9a4d8e6c5f2a1b7c4e3d9f8a5b6c7e" },
  { label: "Staking Reserve", address: "0x55fea7b3c1d8e2f4a6b9c0d5e7f8a3b4c6d9e0f2" },
  { label: "Vendor USD", address: "0x3c917f8d1b2e4a5c6b8d9e0f1a2b3c4d5e6f7a8b" },
];

function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr) || /^aethel1[a-z0-9]{38,}$/.test(addr);
}

function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function SendView({ state }: { state: AethelredWalletState }) {
  const { goBack, params } = useNavigation();
  const { send } = useBackground();
  const addressBook = useAddressBook();

  /* Real on-chain holdings for the active account. The send.tsx form
   * only lists tokens with a non-zero balance — you can't send what you
   * don't have, and filtering at the source reduces the token picker
   * clutter significantly vs. showing every ERC-20 on the chain. */
  // Resolve the active account first so useLiveBalances reads the
  // right address on multi-account wallets (GAP H).
  const resolvedActive = state.activeAccountId
    ? state.accounts.find((a) => a.id === state.activeAccountId)
    : undefined;
  const activeAddress = (resolvedActive ?? state.accounts[0])?.address;
  const { tokens: liveTokens } = useLiveBalances(activeAddress);

  /* Real holdings only — no mock fallback. An empty wallet must show an
   * empty state (see below). App Store submission cannot ship placeholder
   * balances. */
  const tokens = useMemo<LegacyShapedToken[]>(() => {
    return liveTokens
      .filter((t) => parseFloat(t.balance) > 0)
      .map(liveToLegacy);
  }, [liveTokens]);

  const [selectedToken, setSelectedToken] = useState(tokens[0]?.token.symbol ?? "AETHEL");
  const [toAddress, setToAddress] = useState(() => params?.recipient ?? "");
  const [amount, setAmount] = useState("");
  const [gasSpeed, setGasSpeed] = useState<GasSpeed>("standard");
  const [showTokens, setShowTokens] = useState(false);
  const [step, setStep] = useState<"form" | "review" | "sending" | "sent">("form");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [gasData, setGasData] = useState<{ slow: any; standard: any; fast: any } | null>(null);
  const [_gasLoading, setGasLoading] = useState(false);
  /**
   * The draftId of the prepared tx, set by `handleReview` when the user
   * clicks Review. Used by `handleConfirmSend` to execute the pre-computed
   * draft via the `execute-tx` message. Resets when the user edits the
   * form or cancels.
   */
  const [draftId, setDraftId] = useState<string | null>(null);
  const [preparedDetail, setPreparedDetail] = useState<Record<string, unknown> | null>(null);
  const recentAddresses = useMemo(
    () =>
      addressBook
        .listContacts()
        .sort((a, b) => b.addedAt - a.addedAt)
        .slice(0, 6),
    [addressBook],
  );

  const token = tokens.find((t) => t.token.symbol === selectedToken);
  const addressValid = toAddress.length === 0 || isValidAddress(toAddress);
  const amountNum = parseFloat(amount) || 0;
  const hasBalance = token ? amountNum <= parseFloat(token.balance) : false;
  const hasGasEstimate = !IS_PRODUCTION_BUILD || !!gasData;
  const canReview = toAddress && isValidAddress(toAddress) && amount && amountNum > 0 && hasBalance && hasGasEstimate;
  useEffect(() => {
    if (params?.recipient && !toAddress) {
      setToAddress(params.recipient);
    }
  }, [params?.recipient, toAddress]);

  // Resolve the active account — multi-account fix for GAP H
  const activeAccount = state.activeAccountId
    ? state.accounts.find((a) => a.id === state.activeAccountId) ?? state.accounts[0]
    : state.accounts[0];

  /* Fetch real gas estimates when recipient and amount are set */
  useEffect(() => {
    if (!toAddress || !isValidAddress(toAddress) || !activeAccount) {
      setGasData(null);
      return;
    }
    setGasData(null);
    setGasLoading(true);
    send("get-gas", {
      tx: {
        from: activeAccount.address,
        to: toAddress,
        value: "0x" + Math.floor(amountNum * 1e18).toString(16),
      },
    })
      .then((result: any) => {
        if (result?.tiers) setGasData(result.tiers);
      })
      .catch(() => { /* use fallback */ })
      .finally(() => setGasLoading(false));
  }, [toAddress, amount, activeAccount]);

  /**
   * Cancel any existing draft when the form is edited — otherwise the
   * draft's nonce would become stale and broadcast could fail.
   */
  const cancelDraftIfAny = async () => {
    if (draftId) {
      try {
        await send("cancel-tx", { draftId });
      } catch { /* best effort */ }
      setDraftId(null);
      setPreparedDetail(null);
    }
  };

  /**
   * Step 1: Click "Review" → call prepare-tx to get a draftId + full
   * ApprovalDetail. No approval queue entry is created; the UI renders
   * confirm inline. This is the fix for GAP C (send.tsx deadlock).
   */
  const handleReview = async () => {
    if (!activeAccount || !canReview) return;
    setSendError(null);
    try {
      const result = (await send("prepare-tx", {
        from: activeAccount.address,
        to: toAddress,
        value: "0x" + Math.floor(amountNum * 1e18).toString(16),
        data: "0x",
      })) as { draftId?: string; detail?: Record<string, unknown>; requiresReview?: boolean; error?: { message: string } };
      if ((result as { error?: { message: string } }).error) {
        throw new Error((result as { error: { message: string } }).error.message);
      }
      if (!result.draftId) {
        throw new Error("prepare-tx returned no draftId");
      }
      setDraftId(result.draftId);
      setPreparedDetail(result.detail ?? null);
      setStep("review");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Failed to prepare transaction");
    }
  };

  /**
   * Step 2: Click "Confirm & send" → call execute-tx with the draftId.
   * The backend signs + broadcasts the previously-prepared draft and
   * returns the real tx hash. Crucially, this NEVER awaits a popup-wide
   * approval — the user already approved inline on this screen.
   */
  const handleConfirmSend = async () => {
    if (!draftId) {
      setSendError("No draft to execute");
      return;
    }
    setStep("sending");
    setSendError(null);
    try {
      const result = (await send("execute-tx", { draftId })) as { hash?: string; error?: { message: string } };
      if (result.error) throw new Error(result.error.message);
      if (!result.hash) throw new Error("execute-tx returned no hash");
      setTxHash(result.hash);
      setDraftId(null);
      setPreparedDetail(null);
      setStep("sent");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Transaction failed");
      setStep("review");
    }
  };

  // Keep the preparedDetail reference valid in dev build (avoid unused warning)
  void preparedDetail;

  const handlePaste = async () => {
    try {
      const txt = await navigator.clipboard.readText();
      if (txt) setToAddress(txt.trim());
    } catch { /* clipboard permission denied — ignore */ }
  };

  /* ══════════ SENT ══════════ */
  if (step === "sent") {
    return (
      <div className="view-padded">
        <button className="acc-back snd-top-back" onClick={goBack} type="button">
          <ArrowLeft size={14} strokeWidth={2.3} />
          <span>Done</span>
        </button>

        <div className="snd-sent">
          <div className="snd-sent-burst">
            <CheckCircle2 size={42} strokeWidth={2.4} />
          </div>
          <h2 className="snd-sent-title">Transaction submitted</h2>
          <p className="snd-sent-sub">
            Your {amount} {selectedToken} transfer has been signed and broadcast.
          </p>
          {txHash && (
            <div className="snd-sent-hash">{txHash}</div>
          )}
          <a
            className="snd-sent-explore"
            href={`https://explorer.aethelred.network/tx/${txHash ?? ""}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={12} strokeWidth={2.4} />
            View on Explorer
          </a>
          <button className="snd-primary-btn" onClick={goBack} type="button">
            Done
          </button>
        </div>
      </div>
    );
  }

  /* ══════════ SENDING ══════════ */
  if (step === "sending") {
    return (
      <div className="view-padded">
        <div className="snd-status">
          <div className="snd-status-spinner">
            <Loader2 size={30} strokeWidth={2.4} />
          </div>
          <h2 className="snd-status-title">Broadcasting transaction…</h2>
          <p className="snd-status-sub">Signing, simulating, and submitting to the network.</p>
        </div>
      </div>
    );
  }

  /* ══════════ REVIEW ══════════ */
  if (step === "review") {
    const gas = gasData?.[gasSpeed] ?? (IS_PRODUCTION_BUILD ? null : FALLBACK_GAS[gasSpeed]);
    if (!gas) {
      return (
        <div className="view-padded">
          <button
            className="acc-back snd-top-back"
            onClick={async () => {
              await cancelDraftIfAny();
              setStep("form");
            }}
            type="button"
          >
            <ArrowLeft size={14} strokeWidth={2.3} />
            <span>Edit</span>
          </button>

          <div className="snd-status">
            <div className="snd-status-spinner">
              <AlertTriangle size={30} strokeWidth={2.4} />
            </div>
            <h2 className="snd-status-title">Live network fee unavailable</h2>
            <p className="snd-status-sub">Production sends stay blocked until the wallet receives a real gas estimate.</p>
          </div>
        </div>
      );
    }
    const feeCostStr = (gas as any)?.cost ?? "—";
    const feeCostNum = parseFloat(String(feeCostStr).replace(/[^0-9.]/g, "")) || 0;
    const usdValue = token ? amountNum * token.price : 0;
    return (
      <div className="view-padded">
        <button
          className="acc-back snd-top-back"
          onClick={async () => {
            // Release the prepared draft so its nonce can be reused
            await cancelDraftIfAny();
            setStep("form");
          }}
          type="button"
        >
          <ArrowLeft size={14} strokeWidth={2.3} />
          <span>Edit</span>
        </button>

        <div className="snd-hero">
          <span className="snd-hero-kicker">REVIEW SEND</span>
          <strong className="snd-hero-title">Review transaction</strong>
          <span className="snd-hero-sub">Double-check details before signing. This cannot be undone.</span>
        </div>

        <div className="snd-review-card">
          <div className="snd-review-amount">
            {amount}<span className="sym">{selectedToken}</span>
          </div>
          <div className="snd-review-usd">
            ≈ ${usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </div>

        <div className="snd-review-rows">
          <div className="snd-review-row">
            <span className="k">From</span>
            <span className="v">{activeAccount?.label ?? "—"}</span>
          </div>
          <div className="snd-review-row">
            <span className="k">From address</span>
            <span className="v mono">{activeAccount?.address ?? ""}</span>
          </div>
          <div className="snd-review-row">
            <span className="k">To</span>
            <span className="v mono">{toAddress}</span>
          </div>
          <div className="snd-review-row">
            <span className="k">Network fee</span>
            <span className="v">
              {feeCostStr}<br />
              <span className="muted" style={{ fontSize: 10.5, fontWeight: 500 }}>
                {(gas as any).label ?? gasSpeed} · {(gas as any).time ?? (gas as any).speed ?? "—"}
              </span>
            </span>
          </div>
          <div className="snd-review-row">
            <span className="k">Policy</span>
            <span className="v">{state.policy.mode}</span>
          </div>
          <div className="snd-review-row total">
            <span className="k">Total</span>
            <span className="v">
              {amount} {selectedToken}
              {feeCostNum > 0 && <> + {feeCostStr}</>}
            </span>
          </div>
        </div>

        {sendError && (
          <div className="snd-hint error" style={{ marginTop: 10 }}>
            <AlertTriangle size={12} strokeWidth={2.4} /> {sendError}
          </div>
        )}

        <div className="snd-actions-pair">
          <button
            className="snd-secondary-btn"
            onClick={() => setStep("form")}
            type="button"
          >
            Cancel
          </button>
          <button
            className="snd-primary-btn"
            onClick={handleConfirmSend}
            type="button"
          >
            <Send size={14} strokeWidth={2.4} />
            Confirm & sign
          </button>
        </div>
      </div>
    );
  }

  /* ══════════ EMPTY ══════════
   * Wallet has no real sendable balances — either the active account is
   * fresh or every token balance is zero. Don't render a fake form: show
   * a clear empty state. Mirrors the Receive CTA that exists elsewhere.
   */
  if (tokens.length === 0) {
    return (
      <div className="view-padded">
        <button className="acc-back snd-top-back" onClick={goBack} type="button">
          <ArrowLeft size={14} strokeWidth={2.3} />
          <span>Back</span>
        </button>
        <div className="snd-hero">
          <span className="snd-hero-kicker">SEND</span>
          <strong className="snd-hero-title">No balances to send</strong>
          <span className="snd-hero-sub">
            {activeAccount
              ? `${activeAccount.label ?? "This account"} has no tokens with a positive balance yet.`
              : "No active account selected."}
          </span>
        </div>
        <div className="snd-review-rows">
          <div className="snd-review-row">
            <span className="k">Account</span>
            <span className="v">{activeAccount?.label ?? "—"}</span>
          </div>
          <div className="snd-review-row">
            <span className="k">Address</span>
            <span className="v mono">{activeAccount?.address ?? "—"}</span>
          </div>
        </div>
        <button
          className="snd-primary-btn"
          onClick={goBack}
          type="button"
        >
          Back to wallet
        </button>
      </div>
    );
  }

  /* ══════════ FORM ══════════ */
  return (
    <div className="view-padded">
      <button className="acc-back snd-top-back" onClick={goBack} type="button">
        <ArrowLeft size={14} strokeWidth={2.3} />
        <span>Back</span>
      </button>

      {/* ─── Hero ─── */}
      <div className="snd-hero">
        <span className="snd-hero-kicker">SEND</span>
        <strong className="snd-hero-title">
          {token?.token.name ?? selectedToken}
        </strong>
        <span className="snd-hero-sub">
          Available {token?.balanceFormatted ?? "0"} {selectedToken}
          {token ? ` · ≈ $${(parseFloat(token.balance) * token.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ""}
        </span>
      </div>

      {/* ─── Recipient ─── */}
      <span className="snd-label">Recipient</span>
      <div
        className={`snd-recipient-row ${
          toAddress && addressValid ? "valid" : ""
        } ${toAddress && !addressValid ? "invalid" : ""}`}
      >
        <input
          id="to"
          className="snd-recipient-input"
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="0x… or aethel1…"
          value={toAddress}
          onChange={(e) => setToAddress(e.target.value)}
        />
        {toAddress && addressValid && (
          <span className="snd-recipient-check ok" aria-label="Valid address">
            <Check size={12} strokeWidth={3} />
          </span>
        )}
        {toAddress && !addressValid && (
          <span className="snd-recipient-check bad" aria-label="Invalid address">
            <X size={12} strokeWidth={3} />
          </span>
        )}
        <button
          className="snd-paste-btn"
          onClick={handlePaste}
          type="button"
          aria-label="Paste address"
        >
          Paste
        </button>
      </div>
      {toAddress && !addressValid && (
        <span className="snd-hint error">
          <AlertTriangle size={12} strokeWidth={2.4} /> Invalid address format
        </span>
      )}

      {/* Recents */}
      {recentAddresses.length > 0 ? (
        <div className="snd-recents">
          {recentAddresses.map((r) => (
            <button
              key={r.address}
              className="snd-recent-chip"
              onClick={() => setToAddress(r.address)}
              type="button"
            >
              <strong>{r.label}</strong>
              <span>{shortAddr(r.address)}</span>
            </button>
          ))}
        </div>
      ) : !IS_PRODUCTION_BUILD && RECENT_ADDRESSES.length > 0 ? (
        <div className="snd-recents">
          {RECENT_ADDRESSES.map((r) => (
            <button
              key={r.address}
              className="snd-recent-chip"
              onClick={() => setToAddress(r.address)}
              type="button"
            >
              <strong>{r.label}</strong>
              <span>{shortAddr(r.address)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* ─── Amount ─── */}
      <span className="snd-label">Amount</span>
      <div className={`snd-amount-card ${amount && !hasBalance ? "error" : ""}`}>
        <div className="snd-amount-row">
          <input
            id="amount"
            className="snd-amount-input"
            type="number"
            inputMode="decimal"
            pattern="[0-9]*"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button
            className="snd-token-pill"
            onClick={() => setShowTokens(!showTokens)}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={showTokens}
          >
            <TokenLogo
              symbol={selectedToken}
              size={22}
              color={token?.token.logoColor ?? "#8b5e2e"}
            />
            <span>{selectedToken}</span>
            <ChevronDown size={14} strokeWidth={2.4} />
          </button>
        </div>

        <div className="snd-amount-meta">
          <div className="snd-amount-meta-left">
            <span className="snd-amount-usd">
              {amountNum > 0 && token
                ? `≈ $${(amountNum * token.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                : "—"}
            </span>
            <span className="snd-amount-balance">
              Balance: {token?.balanceFormatted ?? "0"} {selectedToken}
            </span>
          </div>
          <button
            className="snd-max-btn"
            onClick={() => setAmount(token?.balance ?? "0")}
            type="button"
          >
            MAX
          </button>
        </div>
      </div>

      {showTokens && (
        <div className="snd-token-dropdown" role="listbox">
          {tokens.map((t) => (
            <button
              key={t.token.address}
              className="snd-token-item"
              onClick={() => { setSelectedToken(t.token.symbol); setShowTokens(false); }}
              type="button"
              role="option"
              aria-selected={t.token.symbol === selectedToken}
            >
              <TokenLogo symbol={t.token.symbol} size={24} color={t.token.logoColor} />
              <strong>{t.token.symbol}</strong>
              <span className="bal">{t.balanceFormatted}</span>
            </button>
          ))}
        </div>
      )}

      {amount && !hasBalance && (
        <span className="snd-hint error">
          <AlertTriangle size={12} strokeWidth={2.4} /> Insufficient balance
        </span>
      )}

      {/* ─── Gas speed ─── */}
      <span className="snd-label">
        <Fuel size={10} strokeWidth={2.6} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
        Network fee
      </span>
      {IS_PRODUCTION_BUILD && !gasData ? (
        <span className="snd-hint error">
          <AlertTriangle size={12} strokeWidth={2.4} /> Enter a valid recipient and wait for a live fee quote before sending.
        </span>
      ) : (
        <div className="snd-gas-row">
          {(["slow", "standard", "fast"] as GasSpeed[]).map((speed) => {
            const tier = gasData?.[speed] ?? FALLBACK_GAS[speed];
            return (
              <button
                key={speed}
                className={`snd-gas-chip ${gasSpeed === speed ? "active" : ""}`}
                onClick={() => setGasSpeed(speed)}
                type="button"
                aria-pressed={gasSpeed === speed}
              >
                <span className="g-label">{(tier as any).label ?? speed}</span>
                <span className="g-cost">{(tier as any).cost ?? (tier as any).maxFeePerGas ?? "—"}</span>
                <span className="g-time">{(tier as any).time ?? (tier as any).speed ?? "—"}</span>
              </button>
            );
          })}
        </div>
      )}

      <button
        className="snd-primary-btn"
        onClick={handleReview}
        type="button"
        disabled={!canReview}
      >
        Review transaction
      </button>
    </div>
  );
}
