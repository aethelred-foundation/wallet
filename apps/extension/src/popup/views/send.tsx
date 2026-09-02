import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import {
  ArrowLeft, ChevronDown, AlertTriangle, Fuel, Loader2,
  Check, X, Send, ExternalLink,
} from "lucide-react";
import type { AethelredWalletState, ApprovalDetail } from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import { useBackground } from "../hooks/use-background";
import { useLiveBalances, type LiveToken } from "../hooks/use-live-balances";
import { baseUnitsToAmount } from "../../background/spending-context";
import { useAddressBookContacts } from "../services/services-context";
import { TokenLogo } from "../components/token-logo";
import { useHaptics } from "../hooks/use-haptics";
import { useSound } from "../hooks/use-sound";
import { Confetti } from "../components/micro/Confetti";
import { SuccessMorph } from "../components/micro/SuccessMorph";
import { ErrorShake } from "../components/micro/ErrorShake";
import {
  buildTransferTransaction,
  formatBaseUnitsForInput,
  parseDecimalAmountToBaseUnits,
  type PreparedTransferTransaction,
} from "../lib/transfer-transaction";
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
  /** Numeric balance derived from rawBalance — the ONLY field for math.
   * `balance` is locale-formatted ("100,000.0"); parseFloat on it
   * truncates at the first separator and once blocked whale-sized sends
   * as "Insufficient balance". */
  balanceNum: number;
  balanceBaseUnits: bigint;
  balanceInputValue: string;
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
    balanceNum: baseUnitsToAmount(BigInt(t.rawBalance || "0x0"), t.decimals),
    balanceBaseUnits: BigInt(t.rawBalance || "0x0"),
    balanceInputValue: formatBaseUnitsForInput(
      BigInt(t.rawBalance || "0x0"),
      t.decimals,
    ),
    price: t.priceUsd ?? 0,
    priceChange24h: t.change24h ?? 0,
    value: t.value ?? 0,
  };
}

type GasSpeed = "slow" | "standard" | "fast";

/**
 * Shape of a single gas tier as delivered by the background's
 * `get-gas` handler. BigInt fields are stringified over the bridge, so
 * the popup sees strings for the fee fields.
 */
interface GasTierPayload {
  label?: string;
  speed?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  estimatedSeconds?: number;
}

type GasTiersPayload = Record<GasSpeed, GasTierPayload>;

interface GetGasResponse {
  estimate?: {
    gasLimit: string;
    baseFee: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    estimatedCostEth: string;
  };
  tiers?: GasTiersPayload;
  error?: string;
}

type TxApprovalDetail = Extract<ApprovalDetail, { kind: "tx" }>;

interface PreparedPopupTransaction {
  draftId: string;
  detail: TxApprovalDetail;
  formFingerprint: string;
  gasSpeed: GasSpeed;
}

interface SelectedGasParameters {
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

const MAX_GAS_LIMIT = (1n << 64n) - 1n;
const MAX_FEE_PER_GAS = (1n << 128n) - 1n;

function decimalToRpcQuantity(
  field: string,
  value: unknown,
  maximum: bigint,
  allowZero: boolean,
): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${field} is not a canonical decimal quantity`);
  }
  const parsed = BigInt(value);
  if (!allowZero && parsed === 0n) throw new Error(`${field} must be greater than zero`);
  if (parsed > maximum) throw new Error(`${field} exceeds the wallet safety bound`);
  return `0x${parsed.toString(16)}`;
}

function buildSelectedGasParameters(
  quote: GetGasResponse | null,
  speed: GasSpeed,
): SelectedGasParameters | null {
  if (!quote?.estimate || !quote.tiers?.[speed]) return null;
  try {
    const gas = decimalToRpcQuantity(
      "gasLimit",
      quote.estimate.gasLimit,
      MAX_GAS_LIMIT,
      false,
    );
    const maxFeePerGas = decimalToRpcQuantity(
      "maxFeePerGas",
      quote.tiers[speed].maxFeePerGas,
      MAX_FEE_PER_GAS,
      true,
    );
    const maxPriorityFeePerGas = decimalToRpcQuantity(
      "maxPriorityFeePerGas",
      quote.tiers[speed].maxPriorityFeePerGas,
      MAX_FEE_PER_GAS,
      true,
    );
    if (BigInt(maxPriorityFeePerGas) > BigInt(maxFeePerGas)) return null;
    return Object.freeze({ gas, maxFeePerGas, maxPriorityFeePerGas });
  } catch {
    return null;
  }
}

function parseCanonicalHexQuantity(field: string, value: unknown): bigint {
  if (
    typeof value !== "string" ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
  ) {
    throw new Error(`Prepared transaction returned an invalid ${field}`);
  }
  return BigInt(value);
}

function validatePreparedTxDetail(value: unknown): TxApprovalDetail {
  if (!value || typeof value !== "object" || (value as { kind?: unknown }).kind !== "tx") {
    throw new Error("prepare-tx returned no transaction approval detail");
  }
  const detail = value as TxApprovalDetail;
  const gasLimit = parseCanonicalHexQuantity("gas limit", detail.gasLimit);
  const maxFeePerGas = parseCanonicalHexQuantity("maximum fee", detail.maxFeePerGas);
  const maxPriorityFeePerGas = parseCanonicalHexQuantity(
    "priority fee",
    detail.maxPriorityFeePerGas,
  );
  const estimatedFee = parseCanonicalHexQuantity("estimated fee", detail.estimatedFee);
  if (gasLimit === 0n) throw new Error("Prepared transaction returned a zero gas limit");
  if (maxPriorityFeePerGas > maxFeePerGas) {
    throw new Error("Prepared transaction returned a priority fee above its maximum fee");
  }
  if (estimatedFee !== gasLimit * maxFeePerGas) {
    throw new Error("Prepared transaction returned an inconsistent estimated fee");
  }
  return Object.freeze({ ...detail });
}

function formatInteger(value: string): string {
  return parseCanonicalHexQuantity("fee", value).toLocaleString("en-US");
}

function formatGwei(value: string): string {
  const wei = parseCanonicalHexQuantity("fee", value);
  const whole = wei / 1_000_000_000n;
  const fraction = (wei % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""} gwei`;
}

function isValidAddress(addr: string): boolean {
  // The send pipeline currently signs EIP-1559 transactions only. Native
  // Cosmos/bech32 sends must not look accepted until that separate pipeline
  // exists end-to-end.
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function SendView({ state }: { state: AethelredWalletState }) {
  const { goBack, params } = useNavigation();
  const { send } = useBackground();
  const savedContacts = useAddressBookContacts();
  const haptics = useHaptics();
  const audio = useSound();

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

  const [selectedAssetKey, setSelectedAssetKey] = useState(
    tokens[0]?.token.address.toLowerCase() ?? "native",
  );
  const [toAddress, setToAddress] = useState(() => params?.recipient ?? "");
  const [amount, setAmount] = useState("");
  const [gasSpeed, setGasSpeed] = useState<GasSpeed>("standard");
  const [showTokens, setShowTokens] = useState(false);
  const [step, setStep] = useState<"form" | "review" | "sending" | "sent">("form");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [gasQuote, setGasQuote] = useState<GetGasResponse | null>(null);
  const [activeExplorerBaseUrl, setActiveExplorerBaseUrl] = useState<string | null>(null);
  const [_gasLoading, setGasLoading] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  /** Immutable, background-authoritative draft reviewed by the user. */
  const [preparedTx, setPreparedTx] = useState<PreparedPopupTransaction | null>(null);
  const preparedTxRef = useRef<PreparedPopupTransaction | null>(null);
  /* Policy verdict from prepare-tx: outcome + human-readable warnings
   * (spend-limit, unknown destination, velocity, unpriced-value notice).
   * Rendered on the review screen so the user decides with them in view. */
  const [policyVerdict, setPolicyVerdict] = useState<{ outcome: string; warnings: string[] } | null>(null);
  const recentAddresses = useMemo(
    () =>
      [...savedContacts]
        .sort((a, b) => b.addedAt - a.addedAt)
        .slice(0, 6),
    [savedContacts],
  );

  const token = tokens.find(
    (entry) => entry.token.address.toLowerCase() === selectedAssetKey,
  );
  const selectedToken = token?.token.symbol ?? "AETHEL";
  const addressValid = toAddress.length === 0 || isValidAddress(toAddress);
  const amountNum = parseFloat(amount) || 0;
  const parsedAmount = useMemo(() => {
    if (!token || !amount) return { units: null as bigint | null, error: null as string | null };
    try {
      return {
        units: parseDecimalAmountToBaseUnits(amount, token.token.decimals),
        error: null,
      };
    } catch (error) {
      return {
        units: null,
        error: error instanceof Error ? error.message : "Invalid amount",
      };
    }
  }, [amount, token]);
  const hasBalance = !!token && parsedAmount.units !== null && parsedAmount.units <= token.balanceBaseUnits;
  const transferTx = useMemo<PreparedTransferTransaction | null>(() => {
    if (!token || !amount || !toAddress || !isValidAddress(toAddress)) return null;
    try {
      return buildTransferTransaction({
        tokenAddress: token.token.address,
        tokenDecimals: token.token.decimals,
        recipient: toAddress,
        amount,
      });
    } catch {
      return null;
    }
  }, [amount, toAddress, token]);
  const selectedGasParameters = useMemo(
    () => buildSelectedGasParameters(gasQuote, gasSpeed),
    [gasQuote, gasSpeed],
  );
  useEffect(() => {
    if (params?.recipient && !toAddress) {
      setToAddress(params.recipient);
    }
  }, [params?.recipient, toAddress]);

  // Resolve the active account — multi-account fix for GAP H
  const activeAccount = state.activeAccountId
    ? state.accounts.find((a) => a.id === state.activeAccountId) ?? state.accounts[0]
    : state.accounts[0];
  const formFingerprint = useMemo(
    () => JSON.stringify({
      from: activeAccount?.address.toLowerCase() ?? "",
      asset: selectedAssetKey,
      to: transferTx?.to.toLowerCase() ?? "",
      value: transferTx?.value ?? "",
      data: transferTx?.data ?? "",
    }),
    [activeAccount?.address, selectedAssetKey, transferTx],
  );
  const canReview =
    !!transferTx && hasBalance && selectedGasParameters !== null && !isPreparing;

  useEffect(() => {
    if (tokens.length > 0 && !tokens.some((entry) => entry.token.address.toLowerCase() === selectedAssetKey)) {
      setSelectedAssetKey(tokens[0].token.address.toLowerCase());
    }
  }, [selectedAssetKey, tokens]);

  useEffect(() => {
    if (step !== "sent") return;
    let cancelled = false;
    send("get-networks", {})
      .then((result) => {
        const typed = result as {
          active?: unknown;
          networks?: Array<{ chainId?: unknown; blockExplorerUrl?: unknown }>;
        } | undefined;
        const active = typeof typed?.active === "string" ? typed.active : null;
        const network = active
          ? typed?.networks?.find((entry) => entry.chainId === active)
          : undefined;
        const explorer = network?.blockExplorerUrl;
        if (!cancelled) {
          setActiveExplorerBaseUrl(typeof explorer === "string" && explorer ? explorer : null);
        }
      })
      .catch(() => {
        if (!cancelled) setActiveExplorerBaseUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [send, step]);

  /* Fetch real gas estimates when recipient and amount are set */
  useEffect(() => {
    if (step !== "form" || !transferTx || !activeAccount) {
      if (step === "form") setGasQuote(null);
      return;
    }
    let cancelled = false;
    setGasQuote(null);
    setGasLoading(true);
    send("get-gas", {
      tx: {
        from: activeAccount.address,
        to: transferTx.to,
        value: transferTx.value,
        data: transferTx.data,
      },
    })
      .then((result) => {
        const typed = result as GetGasResponse | undefined;
        if (!cancelled && typed?.estimate && typed.tiers) setGasQuote(typed);
      })
      .catch(() => { /* production stays blocked without an authoritative quote */ })
      .finally(() => {
        if (!cancelled) setGasLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    step,
    transferTx?.to,
    transferTx?.value,
    transferTx?.data,
    activeAccount?.address,
    send,
  ]);

  /**
   * Cancel any existing draft when the form is edited — otherwise the
   * draft's nonce would become stale and broadcast could fail.
   */
  const cancelDraftIfAny = useCallback(async () => {
    const current = preparedTxRef.current;
    if (!current) return;
    // Clear local authority before awaiting the background so a double click
    // cannot execute a draft while cancellation is in flight.
    preparedTxRef.current = null;
    setPreparedTx(null);
    setPolicyVerdict(null);
    try {
      await send("cancel-tx", { draftId: current.draftId });
    } catch { /* background expiry/restart already makes the draft unusable */ }
  }, [send]);

  // Any transaction-input or fee-tier change after prepare invalidates the
  // reviewed draft. A refreshed network quote deliberately is not part of the
  // fingerprint: once prepared, the background-returned tuple is authoritative.
  useEffect(() => {
    const current = preparedTxRef.current;
    if (
      !current ||
      (current.formFingerprint === formFingerprint && current.gasSpeed === gasSpeed)
    ) {
      return;
    }
    void cancelDraftIfAny().finally(() => setStep("form"));
  }, [cancelDraftIfAny, formFingerprint, gasSpeed]);

  // Closing/navigating away from the send surface releases the nonce and
  // velocity reservation instead of leaving a live draft until TTL expiry.
  useEffect(() => () => {
    const current = preparedTxRef.current;
    if (!current) return;
    preparedTxRef.current = null;
    void send("cancel-tx", { draftId: current.draftId }).catch(() => {});
  }, [send]);

  /**
   * Step 1: Click "Review" → call prepare-tx to get a draftId + full
   * ApprovalDetail. No approval queue entry is created; the UI renders
   * confirm inline. This is the fix for GAP C (send.tsx deadlock).
   */
  const handleReview = async () => {
    if (!activeAccount || !canReview || !transferTx || !selectedGasParameters) return;
    const reviewedFormFingerprint = formFingerprint;
    const reviewedGasSpeed = gasSpeed;
    const selectedGasSnapshot = { ...selectedGasParameters };
    setSendError(null);
    setIsPreparing(true);
    let returnedDraftId: string | undefined;
    try {
      const result = (await send("prepare-tx", {
        from: activeAccount.address,
        to: transferTx.to,
        value: transferTx.value,
        data: transferTx.data,
        ...selectedGasSnapshot,
      })) as {
        draftId?: string;
        detail?: ApprovalDetail;
        requiresReview?: boolean;
        policy?: { outcome: string; warnings: string[] };
        error?: { message: string };
      };
      if ((result as { error?: { message: string } }).error) {
        throw new Error((result as { error: { message: string } }).error.message);
      }
      if (!result.draftId) {
        throw new Error("prepare-tx returned no draftId");
      }
      returnedDraftId = result.draftId;
      const detail = validatePreparedTxDetail(result.detail);
      const prepared = Object.freeze({
        draftId: result.draftId,
        detail,
        formFingerprint: reviewedFormFingerprint,
        gasSpeed: reviewedGasSpeed,
      });
      preparedTxRef.current = prepared;
      setPreparedTx(prepared);
      setPolicyVerdict(result.policy ?? null);
      setStep("review");
    } catch (error) {
      if (returnedDraftId) {
        try {
          await send("cancel-tx", { draftId: returnedDraftId });
        } catch { /* invalid/expired draft is already unusable */ }
      }
      setSendError(error instanceof Error ? error.message : "Failed to prepare transaction");
    } finally {
      setIsPreparing(false);
    }
  };

  /**
   * Step 2: Click "Confirm & send" → call execute-tx with the draftId.
   * The backend signs + broadcasts the previously-prepared draft and
   * returns the real tx hash. Crucially, this NEVER awaits a popup-wide
   * approval — the user already approved inline on this screen.
   */
  /* useCallback — the perf-critical path here is live-gas polling (every
   * few seconds during review). Without stable refs, each poll re-renders
   * every child that receives these handlers. With them, only the gas
   * badge actually updates. */
  const handleConfirmSend = useCallback(async () => {
    const prepared = preparedTxRef.current;
    if (!prepared) {
      setSendError("No draft to execute");
      haptics.error();
      audio.playError();
      return;
    }
    setStep("sending");
    setSendError(null);
    // Heavy impact haptic at the moment the user commits money —
    // mirrors the physical "push button" metaphor. Users report this
    // is what makes confirmation feel "weighty" rather than casual.
    haptics.impact("heavy");
    try {
      // Claim locally before the message crosses the bridge: execute is
      // one-shot and the confirmation cannot race a second click/cancel.
      preparedTxRef.current = null;
      const result = (await send("execute-tx", { draftId: prepared.draftId })) as { hash?: string; error?: { message: string } };
      if (result.error) throw new Error(result.error.message);
      if (!result.hash) throw new Error("execute-tx returned no hash");
      setTxHash(result.hash);
      setPreparedTx(null);
      setStep("sent");
      // Success chime + celebratory haptic pattern on sent state render.
      haptics.success();
      audio.playSuccess();
    } catch (error) {
      try {
        await send("cancel-tx", { draftId: prepared.draftId });
      } catch { /* execute may already have consumed the one-shot draft */ }
      setPreparedTx(null);
      setSendError(error instanceof Error ? error.message : "Transaction failed");
      // execute-tx claims a draft before signing, so any failure requires a
      // fresh prepare/review rather than offering a stale retry button.
      setStep("form");
      haptics.error();
      audio.playError();
    }
  }, [haptics, audio, send]);

  const handlePaste = useCallback(async () => {
    try {
      const txt = await navigator.clipboard.readText();
      if (txt) setToAddress(txt.trim());
    } catch { /* clipboard permission denied — ignore */ }
  }, []);

  /* ══════════ SENT ══════════ */
  if (step === "sent") {
    const explorerTransactionUrl = txHash && activeExplorerBaseUrl
      ? `${activeExplorerBaseUrl.replace(/\/$/, "")}/tx/${encodeURIComponent(txHash)}`
      : null;
    return (
      <div className="view-padded" style={{ position: "relative" }}>
        {/* Confetti burst on first-success — plays once per mount so
         * it only fires on the initial transition to "sent". */}
        <Confetti count={48} originY={0.35} />
        <button className="acc-back snd-top-back" onClick={goBack} type="button">
          <ArrowLeft size={14} strokeWidth={2.3} />
          <span>Done</span>
        </button>

        <div className="snd-sent">
          <div className="snd-sent-burst" aria-hidden="true">
            <SuccessMorph size={56} />
          </div>
          <h2 className="snd-sent-title">Transaction submitted</h2>
          <p className="snd-sent-sub">
            Your {amount} {selectedToken} transfer has been signed and broadcast.
          </p>
          {txHash && (
            <div className="snd-sent-hash">{txHash}</div>
          )}
          {explorerTransactionUrl && (
            <a
              className="snd-sent-explore"
              href={explorerTransactionUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={12} strokeWidth={2.4} />
              View on Explorer
            </a>
          )}
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
    if (!preparedTx) {
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
            <h2 className="snd-status-title">Prepared transaction unavailable</h2>
            <p className="snd-status-sub">Return to the form and prepare the transaction again.</p>
          </div>
        </div>
      );
    }
    const reviewedFees = preparedTx.detail;
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
            <span className="v" data-testid="review-estimated-fee">
              {formatInteger(reviewedFees.estimatedFee)} wei<br />
              <span className="muted" style={{ fontSize: 10.5, fontWeight: 500 }}>
                {reviewedFees.estimatedFee} · {preparedTx.gasSpeed} quote locked at review
              </span>
            </span>
          </div>
          <div className="snd-review-row">
            <span className="k">Gas limit</span>
            <span className="v mono" data-testid="review-gas-limit">
              {formatInteger(reviewedFees.gasLimit)} gas<br />
              <span className="muted">{reviewedFees.gasLimit}</span>
            </span>
          </div>
          <div className="snd-review-row">
            <span className="k">Max fee per gas</span>
            <span className="v mono" data-testid="review-max-fee-per-gas">
              {formatGwei(reviewedFees.maxFeePerGas)}<br />
              <span className="muted">{reviewedFees.maxFeePerGas}</span>
            </span>
          </div>
          <div className="snd-review-row">
            <span className="k">Priority fee per gas</span>
            <span className="v mono" data-testid="review-priority-fee-per-gas">
              {formatGwei(reviewedFees.maxPriorityFeePerGas)}<br />
              <span className="muted">{reviewedFees.maxPriorityFeePerGas}</span>
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
              {BigInt(reviewedFees.estimatedFee) > 0n && (
                <> + {formatInteger(reviewedFees.estimatedFee)} wei maximum fee</>
              )}
            </span>
          </div>
        </div>

        {policyVerdict && policyVerdict.warnings.length > 0 && (
          <div
            className="snd-hint"
            role="note"
            aria-label="Policy notices"
            style={{ marginTop: 10, flexDirection: "column", alignItems: "flex-start", gap: 4 }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 700 }}>
              <AlertTriangle size={12} strokeWidth={2.4} /> Policy
              {policyVerdict.outcome !== "allow" && ` · ${policyVerdict.outcome}`}
            </span>
            {policyVerdict.warnings.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
        )}

        {sendError && (
          <ErrorShake trigger={sendError}>
            <div className="snd-hint error" style={{ marginTop: 10 }}>
              <AlertTriangle size={12} strokeWidth={2.4} /> {sendError}
            </div>
          </ErrorShake>
        )}

        <div className="snd-actions-pair">
          <button
            className="snd-secondary-btn"
            onClick={async () => {
              await cancelDraftIfAny();
              setStep("form");
            }}
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
          {token ? ` · ≈ $${(token.balanceNum * token.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ""}
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
          placeholder="0x…"
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
            /* The amount input needs a PARSEABLE number — the display
             * string is locale-formatted and parseFloat truncates it. */
            onClick={() => setAmount(token?.balanceInputValue ?? "0")}
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
              onClick={() => { setSelectedAssetKey(t.token.address.toLowerCase()); setShowTokens(false); }}
              type="button"
              role="option"
              aria-selected={t.token.address.toLowerCase() === selectedAssetKey}
            >
              <TokenLogo symbol={t.token.symbol} size={24} color={t.token.logoColor} />
              <strong>{t.token.symbol}</strong>
              <span className="bal">{t.balanceFormatted}</span>
            </button>
          ))}
        </div>
      )}

      {amount && parsedAmount.error && (
        <span className="snd-hint error">
          <AlertTriangle size={12} strokeWidth={2.4} /> {parsedAmount.error}
        </span>
      )}

      {amount && !parsedAmount.error && !hasBalance && (
        <span className="snd-hint error">
          <AlertTriangle size={12} strokeWidth={2.4} /> Insufficient balance
        </span>
      )}

      {/* ─── Gas speed ─── */}
      <span className="snd-label">
        <Fuel size={10} strokeWidth={2.6} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
        Network fee
      </span>
      {!gasQuote ? (
        <span className="snd-hint error">
          <AlertTriangle size={12} strokeWidth={2.4} /> Enter a valid recipient and wait for a live fee quote before sending.
        </span>
      ) : (
        <div className="snd-gas-row">
          {(["slow", "standard", "fast"] as GasSpeed[]).map((speed) => {
            const tier = gasQuote.tiers?.[speed];
            if (!tier) return null;
            return (
              <button
                key={speed}
                className={`snd-gas-chip ${gasSpeed === speed ? "active" : ""}`}
                onClick={() => setGasSpeed(speed)}
                type="button"
                aria-pressed={gasSpeed === speed}
              >
                <span className="g-label">{tier.label ?? speed}</span>
                <span className="g-cost">{tier.maxFeePerGas ?? "—"}</span>
                <span className="g-time">{tier.speed ?? "—"}</span>
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
        {isPreparing ? "Preparing transaction…" : "Review transaction"}
      </button>
    </div>
  );
}
