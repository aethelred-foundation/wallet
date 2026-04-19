import { useState, useEffect, useMemo } from "react";
import {
  Clock, ArrowUpRight, ArrowDownLeft, Key, Globe, Lock, Unlock,
  ShieldCheck, RefreshCw, Zap, ArrowLeft,
} from "lucide-react";
import type { AuditEventKind } from "@aethelred/wallet-audit";
import { useNavigation } from "../router";
import { useBackground } from "../hooks/use-background";
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

export function ActivityView() {
  const { goBack } = useNavigation();
  const { send } = useBackground();
  const [events, setEvents] = useState<ActivityEvent[]>(IS_PRODUCTION_BUILD ? [] : DEMO_ACTIVITY);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterGroup | "all">("all");
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  useEffect(() => {
    fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    </div>
  );
}
