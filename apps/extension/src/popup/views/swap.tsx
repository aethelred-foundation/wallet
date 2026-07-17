import { useState, useMemo } from "react";
import {
  ArrowDownUp, ChevronDown, Settings, CheckCircle2, Loader2,
  RefreshCw, ArrowLeft, Zap,
} from "lucide-react";
import { useNavigation } from "../router";
import { useBackground } from "../hooks/use-background";
import { useWalletState } from "../hooks/use-wallet-state";
import { useLiveBalances, type LiveToken } from "../hooks/use-live-balances";
import { TokenLogo } from "../components/token-logo";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";
import "../../styles/legacy/activity-swap.css";

const SLIPPAGE_CHIPS = ["0.1", "0.5", "1.0", "custom"] as const;

/** Matches the shape adapter in send.tsx. Kept local to each view so
 *  a future refactor can move it to a shared util without chasing
 *  multiple call sites. */
interface LegacySwapToken {
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

function liveToLegacy(t: LiveToken): LegacySwapToken {
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
    price: t.priceUsd ?? 0,
    priceChange24h: t.change24h ?? 0,
    value: t.value ?? 0,
  };
}

export function SwapView() {
  const { goBack } = useNavigation();
  const { send } = useBackground();
  const { state } = useWalletState();

  // Resolve active account so we fetch balances for the right address
  // on multi-account wallets (GAP H).
  const activeAddress = state?.activeAccountId
    ? state.accounts.find((a) => a.id === state.activeAccountId)?.address ?? state.accounts[0]?.address
    : state?.accounts[0]?.address;

  /* Real on-chain holdings only — no PortfolioManager mock fallback.
   * An empty wallet shows a dedicated empty state below (same policy
   * as send.tsx). App Store submission cannot ship placeholder balances. */
  const { tokens: liveTokens } = useLiveBalances(activeAddress);

  const tokens = useMemo<LegacySwapToken[]>(() => {
    return liveTokens
      .filter((t) => parseFloat(t.balance) > 0)
      .map(liveToLegacy);
  }, [liveTokens]);

  // Default the "from" token to whatever the wallet actually holds.
  // Previously hardcoded to "AETHEL" which was never a real on-chain token.
  const defaultFromSymbol = tokens[0]?.token.symbol ?? "";
  const defaultToSymbol = tokens.find((t) => t.token.symbol !== defaultFromSymbol)?.token.symbol ?? "USDC";
  const [fromToken, setFromToken] = useState(defaultFromSymbol);
  const [toToken, setToToken] = useState(defaultToSymbol);
  const [fromAmount, setFromAmount] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [customSlippage, setCustomSlippage] = useState("");
  const [showSlippage, setShowSlippage] = useState(false);
  const [step, setStep] = useState<"form" | "review" | "swapping" | "done">("form");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fromBalance = tokens.find((t) => t.token.symbol === fromToken);
  const toBalance = tokens.find((t) => t.token.symbol === toToken);

  /* Rate calculation — preserved exactly from original */
  const rate = fromBalance && toBalance ? fromBalance.price / toBalance.price : 1;
  const toAmount = fromAmount ? (parseFloat(fromAmount) * rate).toFixed(2) : "";

  /* Balance validation — preserved exactly from original */
  const canSwap =
    !!fromAmount &&
    parseFloat(fromAmount) > 0 &&
    !!fromBalance &&
    parseFloat(fromAmount) <= parseFloat(fromBalance.balance);

  const effectiveSlippage = slippage === "custom" ? (customSlippage || "0") : slippage;

  const minReceived = toAmount
    ? (parseFloat(toAmount) * (1 - parseFloat(effectiveSlippage) / 100)).toFixed(2)
    : "";

  const switchTokens = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmount("");
  };

  const handleMax = () => {
    if (fromBalance) setFromAmount(fromBalance.balance);
  };

  /**
   * Swap flow uses the popup-initiated `prepare-tx` → `execute-tx` path
   * (same fix as send.tsx for GAP C: avoid the deadlock where awaiting
   * an approval unmounts the view). The actual swap route still uses
   * the Uniswap Universal Router address as a placeholder — a real
   * implementation would first fetch a quote from 0x/1inch and build
   * the calldata accordingly.
   */
  const [draftId, setDraftId] = useState<string | null>(null);

  // Resolve active account for multi-account wallets (GAP H)
  const activeAccount = state?.activeAccountId
    ? state.accounts.find((a) => a.id === state.activeAccountId) ?? state.accounts[0]
    : state?.accounts[0];

  const handleReview = async () => {
    if (!activeAccount) {
      setError("No active account");
      return;
    }
    setError(null);
    try {
      const result = (await send("prepare-tx", {
        from: activeAccount.address,
        to: "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", // Uniswap Universal Router
        value: "0x0",
        data: "0x3593564c", // execute() selector placeholder
      })) as { draftId?: string; error?: { message: string } };
      if (result.error) throw new Error(result.error.message);
      if (!result.draftId) throw new Error("prepare-tx returned no draftId");
      setDraftId(result.draftId);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to prepare swap");
    }
  };

  const handleSwap = async () => {
    if (!draftId) {
      setError("No draft to execute");
      return;
    }
    setStep("swapping");
    setError(null);
    try {
      const result = (await send("execute-tx", { draftId })) as { hash?: string; error?: { message: string } };
      if (result.error) throw new Error(result.error.message);
      setTxHash(result.hash ?? null);
      setDraftId(null);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Swap failed");
      setStep("review");
    }
  };

  /* ═══════════════════════════════════════════════════════════
     DONE SCREEN
     ═══════════════════════════════════════════════════════════ */
  if (step === "done") {
    return (
      <div className="view-padded">
        <div className="swp-status">
          <div className="swp-status-icon success">
            <CheckCircle2 size={36} strokeWidth={2.3} />
          </div>
          <div className="swp-status-title">Swap submitted</div>
          <div className="swp-status-sub">
            {fromAmount} {fromToken} → ~{toAmount} {toToken}
          </div>
          {txHash && <div className="swp-status-hash">{txHash}</div>}
          <div className="swp-status-actions">
            {IS_PRODUCTION_BUILD ? (
              <button
                className="swp-status-btn secondary"
                type="button"
                disabled
                aria-label="View on explorer unavailable in this release"
              >
                View unavailable
              </button>
            ) : (
              <button className="swp-status-btn secondary" type="button" onClick={() => { /* view on explorer placeholder */ }}>
                View
              </button>
            )}
            <button className="swp-status-btn primary" type="button" onClick={goBack}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     SWAPPING SCREEN
     ═══════════════════════════════════════════════════════════ */
  if (step === "swapping") {
    return (
      <div className="view-padded">
        <div className="swp-status">
          <div className="swp-status-icon loading">
            <Loader2 size={32} strokeWidth={2.3} />
          </div>
          <div className="swp-status-title">Confirming swap…</div>
          <div className="swp-status-sub">Signing and broadcasting via DEX router.</div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     REVIEW SCREEN
     ═══════════════════════════════════════════════════════════ */
  if (step === "review") {
    return (
      <div className="view-padded">
        <button className="acc-back" onClick={() => setStep("form")} type="button">
          <ArrowLeft size={14} />
          Back
        </button>

        <div className="swp-review-hero">
          <span className="swp-review-label">Review Swap</span>
          <div className="swp-review-amount">{fromAmount} {fromToken}</div>
          <div className="swp-review-arrow"><ArrowDownUp size={18} strokeWidth={2.3} /></div>
          <div className="swp-review-receive">
            ~ <strong>{toAmount}</strong> {toToken}
          </div>
        </div>

        <div className="swp-review-list">
          <div className="swp-review-row">
            <span className="swp-review-row-label">Rate</span>
            <span className="swp-review-row-value">1 {fromToken} = {rate.toFixed(4)} {toToken}</span>
          </div>
          <div className="swp-review-row">
            <span className="swp-review-row-label">Slippage</span>
            <span className="swp-review-row-value">{effectiveSlippage}%</span>
          </div>
          <div className="swp-review-row">
            <span className="swp-review-row-label">Min received</span>
            <span className="swp-review-row-value">{minReceived} {toToken}</span>
          </div>
          <div className="swp-review-row">
            <span className="swp-review-row-label">Router</span>
            <span className="swp-review-row-value">Uniswap V3</span>
          </div>
        </div>

        {error && <div className="swp-error">{error}</div>}

        <div className="swp-review-actions">
          <button className="swp-review-edit" onClick={() => setStep("form")} type="button">Edit</button>
          <button className="swp-review-confirm" onClick={handleSwap} type="button">Confirm swap</button>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     EMPTY STATE — wallet has nothing to swap
     ═══════════════════════════════════════════════════════════ */
  if (tokens.length === 0) {
    return (
      <div className="view-padded">
        <button className="acc-back" onClick={goBack} type="button">
          <ArrowLeft size={14} />
          Back
        </button>
        <div className="swp-hero">
          <div className="swp-hero-top">
            <div className="swp-hero-icon">
              <Zap size={18} strokeWidth={2.3} />
            </div>
            <div className="swp-hero-body">
              <span className="swp-hero-label">SWAP</span>
              <strong className="swp-hero-title">Nothing to swap yet</strong>
              <span className="swp-hero-sub">
                {activeAccount
                  ? `${activeAccount.label ?? "This account"} has no tokens with a positive balance.`
                  : "No active account selected."}
              </span>
            </div>
          </div>
        </div>
        <button className="swp-cta" type="button" onClick={goBack}>
          Back to wallet
        </button>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     FORM SCREEN — main entry
     ═══════════════════════════════════════════════════════════ */
  return (
    <div className="view-padded">
      {/* ═════ Back link ═════ */}
      <button className="acc-back" onClick={goBack} type="button">
        <ArrowLeft size={14} />
        Back
      </button>

      {/* ═════ Hero — indigo/purple "exchange" panel ═════ */}
      <div className="swp-hero">
        <div className="swp-hero-top">
          <div className="swp-hero-icon">
            <Zap size={18} strokeWidth={2.3} />
          </div>
          <div className="swp-hero-body">
            <span className="swp-hero-label">SWAP</span>
            <strong className="swp-hero-title">Exchange tokens</strong>
            <span className="swp-hero-sub">Best execution via DEX aggregator</span>
          </div>
          <button
            className="swp-hero-settings-btn"
            onClick={() => setShowSlippage((s) => !s)}
            type="button"
            aria-label="Slippage settings"
          >
            <Settings size={16} strokeWidth={2.3} />
          </button>
        </div>
      </div>

      {/* ═════ FROM card ═════ */}
      <div className="swp-card">
        <div className="swp-card-head">
          <span className="swp-card-label">You pay</span>
          <span className="swp-card-bal">Balance: {fromBalance?.balanceFormatted ?? "0"}</span>
        </div>
        <div className="swp-card-row">
          <button className="swp-token-chip" type="button">
            <TokenLogo symbol={fromToken} size={26} color={fromBalance?.token.logoColor ?? "#8b5e2e"} />
            {fromToken}
            <ChevronDown size={13} strokeWidth={2.3} />
          </button>
          <input
            className="swp-amount-input"
            type="number"
            placeholder="0"
            value={fromAmount}
            onChange={(e) => setFromAmount(e.target.value)}
            autoFocus
          />
        </div>
        <div className="swp-card-meta">
          <span className="swp-card-usd">
            {fromAmount && fromBalance
              ? `≈ $${(parseFloat(fromAmount) * fromBalance.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
              : "≈ $0.00"}
          </span>
          <button className="swp-max-btn" onClick={handleMax} type="button">MAX</button>
        </div>
      </div>

      {/* ═════ Circular switch button ═════ */}
      <div className="swp-switch-wrap">
        <button className="swp-switch-btn" onClick={switchTokens} type="button" aria-label="Swap tokens">
          <ArrowDownUp size={18} strokeWidth={2.5} />
        </button>
      </div>

      {/* ═════ TO card ═════ */}
      <div className="swp-card">
        <div className="swp-card-head">
          <span className="swp-card-label">You receive</span>
          <span className="swp-card-bal">Balance: {toBalance?.balanceFormatted ?? "0"}</span>
        </div>
        <div className="swp-card-row">
          <button className="swp-token-chip" type="button">
            <TokenLogo symbol={toToken} size={26} color={toBalance?.token.logoColor ?? "#1a1a1a"} />
            {toToken}
            <ChevronDown size={13} strokeWidth={2.3} />
          </button>
          <input
            className="swp-amount-input readonly"
            type="text"
            placeholder="0"
            value={toAmount}
            readOnly
          />
        </div>
        <div className="swp-card-meta">
          <span className="swp-card-usd">
            {toAmount && toBalance
              ? `≈ $${(parseFloat(toAmount) * toBalance.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
              : "≈ $0.00"}
          </span>
          <span className="swp-card-usd" style={{ color: "#8b5cf6", fontWeight: 700 }}>
            ↑ best rate
          </span>
        </div>
      </div>

      {/* ═════ Rate row ═════ */}
      {fromAmount && parseFloat(fromAmount) > 0 && (
        <div className="swp-rate-row">
          <span>1 {fromToken} = <strong>{rate.toFixed(4)}</strong> {toToken}</span>
          <button className="swp-rate-refresh" type="button" aria-label="Refresh rate">
            <RefreshCw size={12} strokeWidth={2.5} />
          </button>
        </div>
      )}

      {/* ═════ Slippage row (inline) ═════ */}
      {showSlippage && (
        <div className="swp-slippage-row">
          <div className="swp-slippage-head">
            <span className="swp-slippage-label">Slippage tolerance</span>
            <span className="swp-slippage-current">{effectiveSlippage}%</span>
          </div>
          <div className="swp-slippage-chips">
            {SLIPPAGE_CHIPS.map((s) => (
              <button
                key={s}
                className={`swp-chip ${slippage === s ? "active" : ""}`}
                onClick={() => setSlippage(s)}
                type="button"
              >
                {s === "custom" ? "Custom" : `${s}%`}
              </button>
            ))}
          </div>
          {slippage === "custom" && (
            <input
              type="number"
              placeholder="Enter %"
              value={customSlippage}
              onChange={(e) => setCustomSlippage(e.target.value)}
              className="swp-amount-input"
              style={{
                marginTop: 8, fontSize: 13, textAlign: "left", padding: "8px 10px",
                border: "1px solid var(--line)", borderRadius: 9,
              }}
            />
          )}
        </div>
      )}

      {/* ═════ Primary CTA ═════ */}
      <button
        className="swp-cta"
        type="button"
        disabled={!canSwap}
        onClick={handleReview}
      >
        {!fromAmount
          ? "Enter amount"
          : !canSwap
          ? "Insufficient balance"
          : "Review swap"}
      </button>
    </div>
  );
}
