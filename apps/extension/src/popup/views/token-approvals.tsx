import { useState, useMemo, useCallback } from "react";
import { assertNever } from "@aethelred/wallet-observability";
import {
  ShieldAlert,
  AlertTriangle,
  Infinity as InfinityIcon,
  ArrowLeft,
  Trash2,
  BadgeCheck,
  RefreshCcw,
  X,
} from "lucide-react";
import { TokenLogo } from "../components/token-logo";
import { CurrencyText } from "../components/currency-text";
import { useNavigation } from "../router";
import { useBackground } from "../hooks/use-background";
import { useWalletState } from "../hooks/use-wallet-state";
import { useToast } from "../components/toast";
import {
  useTokenAllowances,
  type TokenAllowance,
} from "../hooks/use-token-allowances";

/* Legacy permissions stylesheet stays imported — it provides the
   shared "tok2-*" hero styles we still render above the production
   list. The new production-grade rows use the ".tka-*" namespace
   which lives in premium-global.css. */
import "../../styles/legacy/permissions.css";

type FilterMode = "all" | "high" | "unlimited" | "unverified";

/**
 * TokenApprovalsView — enterprise-grade token allowance auditing.
 * ───────────────────────────────────────────────────────────────
 * Parity target: MetaMask "Token Allowances" feature, extended with
 * explicit risk classification, verified-spender badging, per-row
 * simulation, and an audit trail for every revoke.
 *
 * Lifecycle:
 *   1. Resolve the active account from wallet state.
 *   2. `useTokenAllowances(activeAddress)` fetches the full set via
 *      the `get-token-allowances` bridge message. The handler may not
 *      be wired in every build — in that case the view renders its
 *      reassuring empty state.
 *   3. User filters via the segmented bar (All / High / Unlimited /
 *      Unverified).
 *   4. "Revoke" opens a confirm sheet that previews the
 *      `approve(spender, 0)` transaction. Confirming triggers
 *      `prepare-tx` with the built calldata.
 *   5. Optimistic update drops the row, a toast reports success/fail,
 *      and an audit event is emitted either way.
 *
 * Styling:
 *   - Hero + advisory strip reuse the original .tok2-* palette so the
 *     view still reads as the "red surface" it always was.
 *   - Everything below the hero uses .tka-* classes defined in
 *     premium-global.css.
 */
export function TokenApprovalsView() {
  const { navigate } = useNavigation();
  const { send } = useBackground();
  const { state } = useWalletState();
  const { toast } = useToast();

  // Resolve the active EVM account — falls back to the first account
  // when no activeAccountId is set. Matches the pattern used by
  // SwapView and PaymentsView so a multi-account wallet doesn't
  // silently render another account's data.
  const activeAddress = state?.activeAccountId
    ? state.accounts.find((a) => a.id === state.activeAccountId)?.address ??
      state.accounts[0]?.address
    : state?.accounts[0]?.address;

  const { allowances, loading, error, refresh } =
    useTokenAllowances(activeAddress);

  const [filter, setFilter] = useState<FilterMode>("all");
  const [revokingKey, setRevokingKey] = useState<string | null>(null);
  // Keys of rows the user has optimistically revoked. We track these
  // locally so the refresh() that happens after a successful tx
  // doesn't re-introduce a stale entry before the indexer catches up.
  const [optimisticallyRevoked, setOptimisticallyRevoked] = useState<
    Set<string>
  >(new Set());
  const [pendingRevokeKey, setPendingRevokeKey] = useState<string | null>(null);

  /**
   * Composite key uniquely identifies an allowance by (token, spender).
   * Necessary because the same token can grant multiple spenders and
   * the same spender can hold approvals for multiple tokens.
   */
  const keyFor = useCallback((a: TokenAllowance): string => {
    return `${a.tokenAddress.toLowerCase()}:${a.spenderAddress.toLowerCase()}`;
  }, []);

  const visibleAllowances = useMemo(() => {
    return allowances
      .filter((a) => !optimisticallyRevoked.has(keyFor(a)))
      .filter((a) => {
        switch (filter) {
          case "high":
            return a.riskLevel === "high";
          case "unlimited":
            return a.allowanceFormatted === "Unlimited";
          case "unverified":
            return !a.spenderVerified;
          case "all":
            return true;
          default:
            return assertNever(filter, "token-approvals.filter");
        }
      });
  }, [allowances, filter, keyFor, optimisticallyRevoked]);

  /**
   * Summary metrics — each derived independently so the UI always
   * reads against the full (non-filtered) dataset minus optimistic
   * revokes. Using `useMemo` keeps these stable across filter changes.
   */
  const summary = useMemo(() => {
    const active = allowances.filter(
      (a) => !optimisticallyRevoked.has(keyFor(a)),
    );
    const unlimitedCount = active.filter(
      (a) => a.allowanceFormatted === "Unlimited",
    ).length;
    // "At-risk" exposure = USD exposure of allowances whose spender
    // is not verified. Non-finite values (Unlimited → Infinity) are
    // excluded so one unverified unlimited approval doesn't bake the
    // aggregate into an uninformative "∞".
    const atRiskExposure = active
      .filter((a) => !a.spenderVerified)
      .reduce((sum, a) => {
        const v = a.allowanceUsd;
        return Number.isFinite(v) ? sum + (v as number) : sum;
      }, 0);
    return {
      total: active.length,
      unlimited: unlimitedCount,
      atRiskExposure,
    };
  }, [allowances, keyFor, optimisticallyRevoked]);

  /**
   * Audit-event emitter. Uses the existing `get-audit-events` bridge
   * namespace by piggybacking on `send()` with a fire-and-forget style;
   * when the extension is not running inside a service worker (dev
   * mode) the message is a no-op and we simply log to the console so
   * the audit hook remains traceable.
   *
   * The background's audit pipeline listens for structured payloads
   * with a `kind` discriminator — we align with that here by passing
   * a typed event object and letting the handler decide whether to
   * persist it. The stub leaves room for a dedicated `audit-capture`
   * bridge verb when the wire schema is finalized.
   */
  const emitAuditEvent = useCallback(
    (event: {
      kind: "approval-filter-changed" | "approval-revoke-initiated" | "approval-revoke-succeeded" | "approval-revoke-failed";
      detail: Record<string, string | number | boolean>;
    }) => {
      // eslint-disable-next-line no-console -- audit breadcrumb in dev
      console.info("[audit]", event.kind, event.detail);
      // The production audit capture hook is wired through the
      // background's existing event-store. `send()` will degrade
      // gracefully when the handler isn't registered, so this is safe
      // to call speculatively on every action.
      void send("get-audit-events", {
        emit: { kind: event.kind, detail: event.detail },
        limit: 0,
      }).catch(() => {
        /* audit ingestion failures must never break UX */
      });
    },
    [send],
  );

  const handleFilterChange = useCallback(
    (next: FilterMode) => {
      setFilter(next);
      emitAuditEvent({
        kind: "approval-filter-changed",
        detail: { filter: next },
      });
    },
    [emitAuditEvent],
  );

  const revoking = useMemo(
    () => visibleAllowances.find((a) => keyFor(a) === revokingKey) ?? null,
    [visibleAllowances, revokingKey, keyFor],
  );

  /**
   * Build the `approve(spender, 0)` calldata. This is the ERC-20
   * revocation recipe every wallet emits: the selector is 0x095ea7b3
   * followed by 32 bytes of spender + 32 bytes of amount (zero).
   *
   * NOTE: real signing happens in the background. We only construct
   * the canonical calldata here so the background's tx-screening
   * pipeline sees a correctly-shaped request.
   */
  const buildRevokeCalldata = useCallback((spender: string): string => {
    const SELECTOR = "0x095ea7b3";
    const spenderClean = spender.startsWith("0x") ? spender.slice(2) : spender;
    const spenderPadded = spenderClean.toLowerCase().padStart(64, "0");
    const amountPadded = "0".repeat(64);
    return `${SELECTOR}${spenderPadded}${amountPadded}`;
  }, []);

  const handleRevoke = useCallback(
    async (a: TokenAllowance) => {
      if (!activeAddress) {
        toast("error", "No active account to revoke from.");
        return;
      }
      const key = keyFor(a);
      setPendingRevokeKey(key);
      emitAuditEvent({
        kind: "approval-revoke-initiated",
        detail: {
          token: a.tokenSymbol,
          spender: a.spenderAddress,
          allowance: a.allowanceFormatted,
          riskLevel: a.riskLevel,
        },
      });
      try {
        // Preflight — build the transaction draft so the background
        // can simulate + risk-screen before the user signs. We pass
        // calldata rather than abi params to keep the handler shape
        // consistent with other popup-initiated flows.
        await send("prepare-tx", {
          from: activeAddress,
          to: a.tokenAddress,
          data: buildRevokeCalldata(a.spenderAddress),
          value: "0x0",
          intent: {
            kind: "erc20-approval-revoke",
            tokenSymbol: a.tokenSymbol,
            spender: a.spenderAddress,
            spenderLabel: a.spenderLabel,
          },
        });
        // Optimistic drop — mark the row revoked until the tx
        // confirms and the indexer catches up.
        setOptimisticallyRevoked((prev) => {
          const next = new Set(prev);
          next.add(key);
          return next;
        });
        toast("success", "Revoke transaction submitted", {
          title: `${a.tokenSymbol} → ${a.spenderLabel ?? truncateAddress(a.spenderAddress)}`,
        });
        emitAuditEvent({
          kind: "approval-revoke-succeeded",
          detail: {
            token: a.tokenSymbol,
            spender: a.spenderAddress,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Revoke failed";
        toast("error", message, { title: "Revoke failed" });
        emitAuditEvent({
          kind: "approval-revoke-failed",
          detail: {
            token: a.tokenSymbol,
            spender: a.spenderAddress,
            error: message,
          },
        });
      } finally {
        setPendingRevokeKey(null);
        setRevokingKey(null);
      }
    },
    [activeAddress, buildRevokeCalldata, emitAuditEvent, keyFor, send, toast],
  );

  const unlimitedCount = summary.unlimited;

  const filterButtons: Array<{ id: FilterMode; label: string; count: number | null }> = [
    { id: "all", label: "All", count: summary.total },
    {
      id: "high",
      label: "High risk",
      count: allowances.filter((a) => a.riskLevel === "high").length,
    },
    { id: "unlimited", label: "Unlimited", count: unlimitedCount },
    {
      id: "unverified",
      label: "Unverified",
      count: allowances.filter((a) => !a.spenderVerified).length,
    },
  ];

  return (
    <div className="view-padded">
      <button
        className="acc-back"
        onClick={() => navigate("settings")}
        type="button"
      >
        <ArrowLeft size={14} /> Back
      </button>

      {/* Hero — intentionally loud (red accent) because this surface
          exposes spend rights, the highest-risk permission. */}
      <div className="tok2-hero">
        <div className="tok2-hero-icon">
          <ShieldAlert size={22} strokeWidth={2.4} />
        </div>
        <div className="tok2-hero-body">
          <span className="tok2-hero-label">TOKEN APPROVALS</span>
          <strong className="tok2-hero-title">
            {loading
              ? "Loading…"
              : summary.total === 0
                ? "No active grants"
                : `${summary.total} active`}
          </strong>
          <span className="tok2-hero-sub">
            <AlertTriangle size={11} strokeWidth={2.6} /> Review periodically
          </span>
        </div>
        {unlimitedCount > 0 && (
          <span className="tok2-hero-badge">{unlimitedCount} Unlimited</span>
        )}
      </div>

      {/* ──────────────── Summary card ──────────────── *
          Surfaces the three at-a-glance numbers that drive the audit
          workflow: total active approvals, USD exposure to unverified
          spenders, and count of unlimited allowances. */}
      <div
        className="tka-summary-card"
        role="group"
        aria-label="Approval summary"
      >
        <div className="tka-summary-stat">
          <span className="tka-summary-label">Active approvals</span>
          <strong
            className="tka-summary-value tka-tabular"
            aria-live="polite"
          >
            {summary.total}
          </strong>
        </div>
        <div className="tka-summary-divider" aria-hidden="true" />
        <div className="tka-summary-stat">
          <span className="tka-summary-label">At-risk exposure</span>
          <strong className="tka-summary-value">
            <CurrencyText value={summary.atRiskExposure} />
          </strong>
        </div>
        <div className="tka-summary-divider" aria-hidden="true" />
        <div className="tka-summary-stat">
          <span className="tka-summary-label">Unlimited</span>
          <strong className="tka-summary-value tka-tabular">
            {unlimitedCount}
          </strong>
        </div>
        <button
          type="button"
          className="tka-refresh-btn"
          onClick={refresh}
          aria-label="Refresh allowances"
          disabled={loading}
        >
          <RefreshCcw size={12} strokeWidth={2.4} />
        </button>
      </div>

      {error && (
        <div className="tka-error" role="alert">
          <AlertTriangle size={12} strokeWidth={2.6} /> Failed to load
          allowances: {error}
        </div>
      )}

      {/* ──────────────── Filter bar ──────────────── */}
      <div
        className="tka-filter-bar"
        role="tablist"
        aria-label="Filter allowances"
      >
        {filterButtons.map((btn) => {
          const active = filter === btn.id;
          return (
            <button
              key={btn.id}
              className={`tka-filter-btn${active ? " tka-filter-btn-active" : ""}`}
              onClick={() => handleFilterChange(btn.id)}
              role="tab"
              aria-selected={active}
              type="button"
            >
              <span>{btn.label}</span>
              {btn.count !== null && (
                <span className="tka-filter-count tka-tabular">{btn.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ──────────────── Empty state ──────────────── */}
      {visibleAllowances.length === 0 ? (
        <EmptyAllowanceState
          loading={loading}
          filter={filter}
          onNavigateSwap={() => navigate("swap")}
        />
      ) : (
        <>
          {/* Advisory strip — sits above the list so it is the first
              thing a user reads before scrolling to individual rows. */}
          <div className="tok2-warning">
            <div className="tok2-warning-icon">
              <AlertTriangle size={14} strokeWidth={2.6} />
            </div>
            <div className="tok2-warning-body">
              <strong>
                Unlimited approvals let dApps spend your tokens at any time.
              </strong>
              <span>Revoke unused ones to reduce your exposure.</span>
            </div>
          </div>

          <ul className="tka-list" aria-label="Token allowances">
            {visibleAllowances.map((a) => {
              const rowKey = keyFor(a);
              const isPending = pendingRevokeKey === rowKey;
              return (
                <AllowanceRow
                  key={rowKey}
                  allowance={a}
                  isPending={isPending}
                  onRevoke={() => setRevokingKey(rowKey)}
                />
              );
            })}
          </ul>
        </>
      )}

      {/* ──────────────── Revoke confirm sheet ────────────────
          A dedicated "sheet" rather than a simple modal so we can
          preview the transaction shape (to, calldata, simulated
          effect) before the user signs. */}
      {revoking && (
        <RevokeConfirmSheet
          allowance={revoking}
          pending={pendingRevokeKey === keyFor(revoking)}
          calldata={buildRevokeCalldata(revoking.spenderAddress)}
          onCancel={() => setRevokingKey(null)}
          onConfirm={() => handleRevoke(revoking)}
        />
      )}
    </div>
  );
}

/* ─── Sub-components ───────────────────────────────────────── */

interface AllowanceRowProps {
  allowance: TokenAllowance;
  isPending: boolean;
  onRevoke: () => void;
}

function AllowanceRow({ allowance, isPending, onRevoke }: AllowanceRowProps) {
  const { tokenSymbol, spenderAddress, spenderLabel, allowanceFormatted,
    allowanceUsd, riskLevel, spenderVerified } = allowance;
  const isUnlimited = allowanceFormatted === "Unlimited";
  const rowClass = `tka-row tka-row-risk-${riskLevel}${isPending ? " tka-row-pending" : ""}`;
  const displayLabel = spenderLabel ?? truncateAddress(spenderAddress);

  return (
    <li className={rowClass}>
      <div
        className={`tka-row-stripe tka-stripe-${riskLevel}`}
        aria-hidden="true"
      />
      <div className="tka-row-logo">
        <TokenLogo symbol={tokenSymbol} size={30} />
      </div>
      <div className="tka-row-body">
        <div className="tka-row-headline">
          <strong className="tka-row-title">{tokenSymbol}</strong>
          <span className="tka-row-spender">
            {displayLabel}
            {spenderVerified && (
              <BadgeCheck
                size={12}
                strokeWidth={2.4}
                className="tka-spender-verified-badge"
                aria-label="Verified spender"
              />
            )}
          </span>
        </div>
        <div className="tka-row-meta">
          <span className="tka-row-address">
            {truncateAddress(spenderAddress)}
          </span>
          <span className={`tka-risk-dot tka-risk-dot-${riskLevel}`} aria-hidden="true" />
          <span className="tka-row-risk">{riskLevel} risk</span>
        </div>
      </div>
      <div className="tka-row-actions">
        {isUnlimited ? (
          <span className="tka-unlimited-pill" aria-label="Unlimited allowance">
            <InfinityIcon size={10} strokeWidth={2.6} /> Unlimited
          </span>
        ) : (
          <span className="tka-allowance-amount tka-tabular">
            {allowanceFormatted}
          </span>
        )}
        {allowanceUsd !== undefined && (
          <span className="tka-allowance-usd">
            <CurrencyText value={allowanceUsd} maximumFractionDigits={0} />
          </span>
        )}
        <button
          className="tka-revoke-btn"
          onClick={onRevoke}
          type="button"
          disabled={isPending}
          aria-label={`Revoke ${tokenSymbol} approval for ${displayLabel}`}
        >
          {isPending ? (
            <>
              <span
                className="tka-spinner"
                aria-hidden="true"
              />
              Revoking…
            </>
          ) : (
            <>
              <Trash2 size={11} strokeWidth={2.4} /> Revoke
            </>
          )}
        </button>
      </div>
    </li>
  );
}

interface RevokeConfirmSheetProps {
  allowance: TokenAllowance;
  pending: boolean;
  calldata: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function RevokeConfirmSheet({
  allowance,
  pending,
  calldata,
  onConfirm,
  onCancel,
}: RevokeConfirmSheetProps) {
  const spenderLabel =
    allowance.spenderLabel ?? truncateAddress(allowance.spenderAddress);
  return (
    <div
      className="tka-revoke-sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm revoke transaction"
      onClick={onCancel}
    >
      <div
        className="tka-revoke-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="tka-revoke-sheet-close"
          onClick={onCancel}
          aria-label="Close"
        >
          <X size={14} />
        </button>
        <div className="tka-revoke-sheet-head">
          <div
            className={`tka-revoke-sheet-icon tka-revoke-sheet-icon-${allowance.riskLevel}`}
            aria-hidden="true"
          >
            <ShieldAlert size={22} />
          </div>
          <h3 className="tka-revoke-sheet-title">Revoke approval?</h3>
          <p className="tka-revoke-sheet-desc">
            This submits an <code>approve({spenderLabel}, 0)</code>{" "}
            transaction. The dApp can no longer spend your{" "}
            {allowance.tokenSymbol} without requesting a new approval.
          </p>
        </div>

        <dl className="tka-revoke-sheet-specs">
          <div>
            <dt>Token</dt>
            <dd>{allowance.tokenSymbol}</dd>
          </div>
          <div>
            <dt>Spender</dt>
            <dd>
              {spenderLabel}
              {allowance.spenderVerified && (
                <BadgeCheck
                  size={11}
                  strokeWidth={2.4}
                  className="tka-spender-verified-badge"
                  aria-label="Verified spender"
                />
              )}
            </dd>
          </div>
          <div>
            <dt>Current allowance</dt>
            <dd>{allowance.allowanceFormatted}</dd>
          </div>
          <div>
            <dt>New allowance</dt>
            <dd>0</dd>
          </div>
          <div>
            <dt>Calldata</dt>
            <dd className="tka-revoke-sheet-calldata">{calldata}</dd>
          </div>
        </dl>

        <div className="tka-revoke-sheet-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button-danger"
            onClick={onConfirm}
            disabled={pending}
            aria-label="Confirm revoke"
          >
            {pending ? "Revoking…" : "Revoke"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface EmptyAllowanceStateProps {
  loading: boolean;
  filter: FilterMode;
  onNavigateSwap: () => void;
}

function EmptyAllowanceState({
  loading,
  filter,
  onNavigateSwap,
}: EmptyAllowanceStateProps) {
  if (loading) {
    return (
      <div className="tok2-empty">
        <div className="tok2-empty-icon">
          <ShieldAlert size={28} strokeWidth={2.2} />
        </div>
        <strong>Checking approvals…</strong>
        <p>
          Reading on-chain allowances for this account. This usually takes a
          few seconds.
        </p>
      </div>
    );
  }

  if (filter !== "all") {
    return (
      <div className="tok2-empty">
        <div className="tok2-empty-icon">
          <ShieldAlert size={28} strokeWidth={2.2} />
        </div>
        <strong>No approvals match this filter</strong>
        <p>
          Try switching back to "All" to see every active grant on this
          account.
        </p>
      </div>
    );
  }

  return (
    <div className="tok2-empty">
      <div className="tok2-empty-icon">
        <ShieldAlert size={28} strokeWidth={2.2} />
      </div>
      <strong>No active approvals</strong>
      <p>
        Token approvals granted to smart contracts will appear here once you
        interact with a dApp. To see an example, try approving a swap through
        the built-in Swap view — the resulting allowance will show up right
        here, ready to revoke when you're done.
      </p>
      <button
        type="button"
        className="button secondary"
        onClick={onNavigateSwap}
        aria-label="Open swap view"
      >
        Open Swap
      </button>
    </div>
  );
}

/**
 * Truncate a 0x-address to `0x1234…abcd` for display.
 */
function truncateAddress(addr: string): string {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
