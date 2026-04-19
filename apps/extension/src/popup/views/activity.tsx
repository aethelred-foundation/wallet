import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Clock, ArrowUpRight, ArrowDownLeft, Key, Globe, Lock, Unlock,
  ShieldCheck, RefreshCw, Zap, ArrowLeft, FastForward, X as XIcon,
} from "lucide-react";
import type { AuditEventKind } from "@aethelred/wallet-audit";
import type { PendingTxSummary, TxReplacementResult } from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import { useBackground } from "../hooks/use-background";
import { useToast } from "../components/toast";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";
import "../../styles/legacy/activity-swap.css";

/* ─── Event kind → icon + color tile ──────────────────────────────
   Each audit kind maps to an icon and a semantic color for its
   timeline tile. Colors follow iOS conventions: blue for session/
   network, purple for signing/keys, green for received/unlock, red
   for sent, amber for policy review. ───────────────────────────── */
interface KindMeta { icon: typeof Clock; color: string; group: FilterGroup }

type FilterGroup = "session" | "signing" | "received" | "sent" | "policy";

const KIND_META: Partial<Record<AuditEventKind, KindMeta>> = {
  "request-received":    { icon: Globe,       color: "#0ea5e9", group: "session"  },
  "policy-evaluated":    { icon: ShieldCheck, color: "#ff9f0a", group: "policy"   },
  "signing-executed":    { icon: Key,         color: "#8b5cf6", group: "signing"  },
  "lock-state-changed":  { icon: Lock,        color: "#8e8e93", group: "session"  },
  "wallet-initialized":  { icon: Unlock,      color: "#34c759", group: "session"  },
  "session-created":     { icon: Globe,       color: "#0ea5e9", group: "session"  },
  "account-created":     { icon: Key,         color: "#8b5cf6", group: "signing"  },
};

interface ActivityEvent {
  id: string;
  kind: AuditEventKind;
  title: string;
  detail: string;
  timestamp: number;
  direction?: "sent" | "received";
}

/* Demo activity for dev mode (preserved from original) */
const DEMO_ACTIVITY: ActivityEvent[] = [
  {
    id: "1",
    kind: "wallet-initialized",
    title: "Wallet initialized",
    detail: "Trust kernel and policy engine activated",
    timestamp: Date.now() - 3600000,
  },
  {
    id: "2",
    kind: "account-created",
    title: "Account created",
    detail: "Ops EVM signer (0xae7e...ef10)",
    timestamp: Date.now() - 3500000,
  },
  {
    id: "3",
    kind: "session-created",
    title: "Session created",
    detail: "Cruzible Treasury Console connected",
    timestamp: Date.now() - 2400000,
  },
  {
    id: "4",
    kind: "request-received",
    title: "Intent received",
    detail: "sign-transaction from Governance Console",
    timestamp: Date.now() - 1200000,
  },
  {
    id: "5",
    kind: "policy-evaluated",
    title: "Policy evaluated",
    detail: "Outcome: approval-required (enterprise mode)",
    timestamp: Date.now() - 1199000,
  },
];

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const FILTERS: Array<{ id: FilterGroup | "all"; label: string }> = [
  { id: "all",      label: "All"      },
  { id: "sent",     label: "Sent"     },
  { id: "received", label: "Received" },
  { id: "signing",  label: "Signed"   },
  { id: "session",  label: "Sessions" },
];

/* ─── Pending-tx helpers ──────────────────────────────────────
   Short-hand formatters shared by the "Pending" section and the
   replacement confirm sheet. Everything stays string-based because
   bridge payloads arrive as decimal strings (the background flattens
   bigints before crossing the messaging boundary). ───────────── */

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function pendingDurationLabel(submittedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - submittedAt) / 1000));
  if (seconds < 60) return `pending for ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `pending for ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `pending for ${hours}h`;
}

/** Convert a decimal-string wei value to a short human-readable
 *  gwei label with up to 2 decimals. Uses BigInt to avoid precision
 *  loss at wei scale. */
function gweiLabel(weiDecimal?: string): string {
  if (!weiDecimal) return "—";
  try {
    const wei = BigInt(weiDecimal);
    const gweiInt = wei / 1_000_000_000n;
    const remainder = wei % 1_000_000_000n;
    if (remainder === 0n) return `${gweiInt} gwei`;
    // 2-decimal gwei formatting
    const frac = Number(remainder) / 1_000_000_000;
    return `${(Number(gweiInt) + frac).toFixed(2)} gwei`;
  } catch {
    return "—";
  }
}

/** ETH formatter for the "amount" column of a pending tx row. */
function ethLabel(weiDecimal: string): string {
  try {
    const wei = BigInt(weiDecimal);
    if (wei === 0n) return "0 ETH";
    const whole = wei / 10n ** 18n;
    const frac = wei % 10n ** 18n;
    if (frac === 0n) return `${whole} ETH`;
    const fracStr = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
    return fracStr.length > 0 ? `${whole}.${fracStr} ETH` : `${whole} ETH`;
  } catch {
    return "— ETH";
  }
}

interface ReplacementSheetState {
  kind: "speed-up" | "cancel";
  tx: PendingTxSummary;
}

export function ActivityView() {
  const { goBack } = useNavigation();
  const { send } = useBackground();
  const { toast } = useToast();
  const [events, setEvents] = useState<ActivityEvent[]>(IS_PRODUCTION_BUILD ? [] : DEMO_ACTIVITY);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterGroup | "all">("all");
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingTxs, setPendingTxs] = useState<PendingTxSummary[]>([]);
  const [sheet, setSheet] = useState<ReplacementSheetState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [replacingHashes, setReplacingHashes] = useState<Record<string, true>>({});

  const fetchEvents = () => {
    setRefreshing(true);
    setLoadError(null);
    send("get-tx-history", {})
      .then((result: unknown) => {
        if (Array.isArray(result) && result.length > 0) {
          setEvents(result.map((tx: { hash: string; type: string; asset?: string; to?: string; submittedAt?: number; timestamp?: number }) => {
            const isSent = tx.type === "send";
            return {
              id: tx.hash,
              kind: (isSent ? "signing-executed" : "request-received") as AuditEventKind,
              title: tx.type.charAt(0).toUpperCase() + tx.type.slice(1),
              detail: `${tx.asset ?? ""} · ${tx.to ?? ""}`,
              timestamp: tx.submittedAt ?? tx.timestamp ?? Date.now(),
              direction: isSent ? "sent" : "received",
            };
          }));
          return;
        }

        if (Array.isArray(result)) {
          setEvents([]);
          return;
        }

        if (IS_PRODUCTION_BUILD) {
          setEvents([]);
          setLoadError("Activity feed unavailable right now");
        } else {
          setEvents(DEMO_ACTIVITY);
        }
      })
      .catch(() => {
        if (IS_PRODUCTION_BUILD) {
          setEvents([]);
          setLoadError("Activity feed unavailable right now");
        } else {
          setEvents(DEMO_ACTIVITY);
        }
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  /* ─── Pending tx list ─────────────────────────────────────
     Fetch from the background's `tx-pending-list` bridge handler.
     We ignore the result in dev mode (use-background returns {}).
     ───────────────────────────────────────────────────────── */
  const fetchPending = useCallback(() => {
    // Defensively wrap `send` — in production it always returns a
    // Promise, but some test mocks return undefined for un-queued
    // calls, which would blow up the `.then()` chain below.
    Promise.resolve(send("tx-pending-list", {}))
      .then((result: unknown) => {
        if (Array.isArray(result)) {
          setPendingTxs(result as PendingTxSummary[]);
        }
      })
      .catch(() => {
        // Non-fatal: pending view gracefully degrades to empty.
        setPendingTxs([]);
      });
  }, [send]);

  useEffect(() => {
    fetchEvents();
    fetchPending();
    // Listen for tx-updated events fired when the receipt poller sees
    // a pending tx confirm/fail — the moment we see one, refresh the
    // Pending section so rows disappear or flip to "Replaced".
    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
      const listener = (msg: { kind?: string }) => {
        if (msg?.kind === "tx-updated") {
          fetchPending();
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      return () => chrome.runtime.onMessage.removeListener(listener);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── Speed-up / cancel confirm handlers ─────────────────
     Each handler fires the corresponding bridge message and, on
     success, sends the user into the existing `execute-tx` confirm
     flow. The background has already pushed the draft through the
     policy engine (prepare-tx) so we never bypass it here. */
  const openSheet = useCallback((kind: "speed-up" | "cancel", tx: PendingTxSummary) => {
    setSheet({ kind, tx });
  }, []);

  const closeSheet = useCallback(() => {
    if (submitting) return; // don't let a backdrop click abort a pending sign
    setSheet(null);
  }, [submitting]);

  const confirmReplacement = useCallback(async () => {
    if (!sheet) return;
    const { kind, tx } = sheet;
    setSubmitting(true);
    try {
      const bridgeKind = kind === "speed-up" ? "tx-speed-up" : "tx-cancel";
      const prep = (await send(bridgeKind, { txHash: tx.txHash })) as
        | (TxReplacementResult | null)
        | undefined;
      if (!prep?.draftId) {
        throw new Error("Background did not return a draft for the replacement");
      }
      // Hand the draft straight to `execute-tx`. This reuses the same
      // sign-and-broadcast path as a normal send, which means the
      // policy engine's second-reviewer gate still fires when the
      // active bundle requires it. We do NOT bypass policy.
      await send("execute-tx", { draftId: prep.draftId });
      // Mark the original as "Replacing…" locally — the tx-updated
      // event will clear it once the replacement confirms.
      setReplacingHashes((prev) => ({ ...prev, [tx.txHash.toLowerCase()]: true }));
      toast(
        "success",
        kind === "speed-up" ? "Speed-up transaction submitted" : "Cancel transaction submitted",
        { title: kind === "speed-up" ? "Speed up" : "Cancel" },
      );
      setSheet(null);
      fetchPending();
    } catch (err) {
      toast(
        "error",
        err instanceof Error ? err.message : "Replacement failed",
        { title: kind === "speed-up" ? "Speed up failed" : "Cancel failed" },
      );
    } finally {
      setSubmitting(false);
    }
  }, [sheet, send, toast, fetchPending]);

  /* Per-filter counts for chip badges */
  const filterCounts = useMemo(() => {
    const counts: Record<FilterGroup | "all", number> = {
      all: events.length, sent: 0, received: 0, signing: 0, session: 0, policy: 0,
    };
    for (const e of events) {
      if (e.direction === "sent") counts.sent++;
      if (e.direction === "received") counts.received++;
      const group = KIND_META[e.kind]?.group;
      if (group && group !== "policy") counts[group]++;
    }
    return counts;
  }, [events]);

  /* Filtered view — newest first */
  const filteredEvents = useMemo(() => {
    const sorted = [...events].sort((a, b) => b.timestamp - a.timestamp);
    if (filter === "all") return sorted;
    if (filter === "sent")     return sorted.filter((e) => e.direction === "sent");
    if (filter === "received") return sorted.filter((e) => e.direction === "received");
    return sorted.filter((e) => KIND_META[e.kind]?.group === filter);
  }, [events, filter]);

  const heroSubtitle = loadError
    ? loadError
    : events.length > 0
      ? `Latest ${timeAgo(Math.max(...events.map((e) => e.timestamp)))}`
      : loading
        ? "Loading recent activity…"
        : "No activity yet";

  const emptyTitle = loadError ? "Activity feed unavailable" : "No activity yet";
  const emptyDescription = loadError
    ? "The wallet background service did not return activity, so demo entries are hidden in production."
    : "Recent activity will appear here once the wallet records events.";

  return (
    <div className="view-padded">
      {/* ═════ Back link ═════ */}
      <button className="acc-back" onClick={goBack} type="button">
        <ArrowLeft size={14} />
        Back
      </button>

      {/* ═════ Hero — teal "live activity" panel ═════ */}
      {/* CRITICAL: renders from `events` state (not DEMO_ACTIVITY) — fixes dead-state bug */}
      <div className="act-hero">
        <div className="act-hero-top">
          <div className="act-hero-icon">
            <Zap size={18} strokeWidth={2.3} />
          </div>
          <div className="act-hero-body">
            <span className="act-hero-label">ACTIVITY</span>
            <strong className="act-hero-title">
              {loading ? "…" : events.length} <span>events logged</span>
            </strong>
            <span className="act-hero-sub">{heroSubtitle}</span>
          </div>
          <span className="act-live-badge">
            <span className="act-live-dot" />
            Live
          </span>
          <button
            className={`act-refresh-btn ${refreshing ? "spinning" : ""}`}
            onClick={fetchEvents}
            type="button"
            aria-label="Refresh activity"
          >
            <RefreshCw size={14} strokeWidth={2.3} />
          </button>
        </div>
      </div>

      {/* ═════ Pending transactions — fee-bump / cancel controls ═════
         Only rendered when the background surfaces one or more tracked
         pending txs. Each row exposes Speed up + Cancel buttons which
         open the replacement confirm sheet; the sheet shows old vs.
         new gas side-by-side before issuing a bridge call. Fully
         additive — when `pendingTxs` is empty the section disappears
         and the rest of the activity view behaves exactly as before.
         ──────────────────────────────────────────────────────────── */}
      {pendingTxs.length > 0 && (
        <div className="tx-pending-section" data-testid="tx-pending-section">
          <div className="tx-pending-section-header">
            <span className="tx-pending-section-title">Pending</span>
            <span className="tx-pending-section-count">{pendingTxs.length}</span>
          </div>
          {pendingTxs.map((tx) => {
            const isReplacing =
              Boolean(tx.replacedBy) || replacingHashes[tx.txHash.toLowerCase()];
            return (
              <div className="tx-pending-row" key={tx.txHash} data-testid="tx-pending-row">
                <div className="tx-pending-row-body">
                  <div className="tx-pending-row-top">
                    <ArrowUpRight size={14} strokeWidth={2.3} />
                    <strong className="tx-pending-row-to">to {shortAddr(tx.to)}</strong>
                    <span className="tx-pending-row-amount">{ethLabel(tx.value)}</span>
                  </div>
                  <div className="tx-pending-row-meta">
                    <span>nonce {tx.nonce}</span>
                    <span>·</span>
                    <span>{pendingDurationLabel(tx.submittedAt)}</span>
                    {isReplacing && (
                      <>
                        <span>·</span>
                        <span className="tx-pending-row-state">
                          {tx.replacementKind === "cancel" ? "Cancelling…" : "Replacing…"}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="tx-pending-row-actions">
                  <button
                    className="tx-action-btn tx-action-btn-speedup"
                    onClick={() => openSheet("speed-up", tx)}
                    type="button"
                    disabled={isReplacing}
                  >
                    <FastForward size={13} strokeWidth={2.3} />
                    Speed up
                  </button>
                  <button
                    className="tx-action-btn tx-action-btn-cancel"
                    onClick={() => openSheet("cancel", tx)}
                    type="button"
                    disabled={isReplacing}
                  >
                    <XIcon size={13} strokeWidth={2.3} />
                    Cancel
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═════ Filter chips ═════ */}
      <div className="act-filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`act-filter ${filter === f.id ? "active" : ""}`}
            onClick={() => setFilter(f.id)}
            type="button"
          >
            {f.label}
            <span className="act-filter-count">{filterCounts[f.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="act-section-label">Timeline</div>

      {/* ═════ Timeline ═════ */}
      {/* CRITICAL: iterates `filteredEvents` derived from `events` state — fixes the dead-state bug */}
      {filteredEvents.length === 0 ? (
        <div className="act-empty">
          <Clock size={20} />
          <strong>{emptyTitle}</strong>
          <span>{emptyDescription}</span>
        </div>
      ) : (
        <div className="act-timeline">
          {filteredEvents.map((event, i) => {
            const meta = KIND_META[event.kind] ?? { icon: Clock, color: "#8e8e93", group: "session" as const };
            /* Override icon/color by direction for send/receive transactions */
            let Icon = meta.icon;
            let color = meta.color;
            if (event.direction === "sent") {
              Icon = ArrowUpRight;
              color = "#ff3b30";
            } else if (event.direction === "received") {
              Icon = ArrowDownLeft;
              color = "#34c759";
            }
            const isLast = i === filteredEvents.length - 1;
            return (
              <div className="act-event" key={event.id}>
                <div className="act-event-rail">
                  <div
                    className="act-event-tile"
                    style={{
                      background: `linear-gradient(135deg, ${color} 0%, ${color}c0 100%)`,
                      boxShadow: `0 3px 10px ${color}40`,
                    }}
                  >
                    <Icon size={14} strokeWidth={2.3} />
                  </div>
                  {!isLast && <div className="act-event-line" />}
                </div>
                <div className="act-event-card">
                  <div className="act-event-header">
                    <strong>{event.title}</strong>
                    <span className="act-event-time">{timeAgo(event.timestamp)}</span>
                  </div>
                  <p className="act-event-detail">{event.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═════ Replacement confirm sheet ═════
         Modal-style drawer that shows old vs. new gas side-by-side
         before the user confirms a speed-up or cancel. Renders
         nothing when `sheet` is null — so the tree is identical to
         the pre-change activity view in the common case. ──────── */}
      {sheet && (
        <div
          className="tx-replacement-sheet-backdrop"
          onClick={closeSheet}
          role="presentation"
        >
          <div
            className="tx-replacement-sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={sheet.kind === "speed-up" ? "Speed up transaction" : "Cancel transaction"}
          >
            <div className="tx-replacement-sheet-header">
              <strong>
                {sheet.kind === "speed-up" ? "Speed up transaction" : "Cancel transaction"}
              </strong>
              <button
                type="button"
                className="tx-replacement-sheet-close"
                aria-label="Close"
                onClick={closeSheet}
                disabled={submitting}
              >
                <XIcon size={14} strokeWidth={2.3} />
              </button>
            </div>
            <p className="tx-replacement-sheet-blurb">
              {sheet.kind === "speed-up"
                ? `This replaces the pending transaction with a higher-fee copy on the same nonce (${sheet.tx.nonce}).`
                : `This cancels the pending transaction by issuing a zero-value self-send on nonce ${sheet.tx.nonce}.`}
            </p>
            <div className="tx-fee-diff">
              <div className="tx-fee-diff-col">
                <span className="tx-fee-diff-label">Current</span>
                {sheet.tx.type === "eip1559" ? (
                  <>
                    <div className="tx-fee-diff-row">
                      <span>Max fee</span>
                      <strong>{gweiLabel(sheet.tx.maxFeePerGas)}</strong>
                    </div>
                    <div className="tx-fee-diff-row">
                      <span>Priority</span>
                      <strong>{gweiLabel(sheet.tx.maxPriorityFeePerGas)}</strong>
                    </div>
                  </>
                ) : (
                  <div className="tx-fee-diff-row">
                    <span>Gas price</span>
                    <strong>{gweiLabel(sheet.tx.gasPrice)}</strong>
                  </div>
                )}
              </div>
              <div className="tx-fee-diff-col tx-fee-diff-col-new">
                <span className="tx-fee-diff-label">After replacement</span>
                {sheet.tx.type === "eip1559" ? (
                  <>
                    <div className="tx-fee-diff-row">
                      <span>Max fee</span>
                      <strong>
                        {gweiLabel(
                          sheet.kind === "speed-up"
                            ? sheet.tx.suggestion?.speedUp.maxFeePerGas
                            : sheet.tx.suggestion?.cancel.maxFeePerGas,
                        )}
                      </strong>
                    </div>
                    <div className="tx-fee-diff-row">
                      <span>Priority</span>
                      <strong>
                        {gweiLabel(
                          sheet.kind === "speed-up"
                            ? sheet.tx.suggestion?.speedUp.maxPriorityFeePerGas
                            : sheet.tx.suggestion?.cancel.maxPriorityFeePerGas,
                        )}
                      </strong>
                    </div>
                  </>
                ) : (
                  <div className="tx-fee-diff-row">
                    <span>Gas price</span>
                    <strong>
                      {gweiLabel(
                        sheet.kind === "speed-up"
                          ? sheet.tx.suggestion?.speedUp.gasPrice
                          : sheet.tx.suggestion?.cancel.gasPrice,
                      )}
                    </strong>
                  </div>
                )}
                {sheet.tx.suggestion?.minBumpPercent !== undefined && (
                  <div className="tx-fee-diff-bump">
                    +{sheet.tx.suggestion.minBumpPercent}% minimum bump
                  </div>
                )}
              </div>
            </div>
            {sheet.kind === "cancel" && (
              <p className="tx-replacement-sheet-cancel-note">
                Cancel replaces the original with a 0 ETH self-send. If the original already
                mines before the replacement, this will be a no-op.
              </p>
            )}
            <div className="tx-replacement-sheet-actions">
              <button
                type="button"
                className="tx-replacement-sheet-btn-secondary"
                onClick={closeSheet}
                disabled={submitting}
              >
                Back
              </button>
              <button
                type="button"
                className={
                  sheet.kind === "speed-up"
                    ? "tx-replacement-sheet-btn-primary"
                    : "tx-replacement-sheet-btn-danger"
                }
                onClick={confirmReplacement}
                disabled={submitting}
              >
                {submitting
                  ? "Submitting…"
                  : sheet.kind === "speed-up"
                    ? "Confirm speed-up"
                    : "Confirm cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
