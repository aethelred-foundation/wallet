import { useState, useEffect, useMemo } from "react";
import {
  ScrollText, Download, Shield, CheckCircle2, Clock, Key,
  Globe, Lock, Fingerprint, ArrowDownCircle, Link2,
} from "lucide-react";
import type { AuditEventKind } from "@aethelred/wallet-audit";
import { useBackground } from "../hooks/use-background";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";

interface AuditEntry {
  id: string;
  seq: number;
  kind: AuditEventKind;
  title: string;
  detail: string;
  timestamp: number;
  hash: string;
  prevHash: string;
}

interface AuditIntegrityResult {
  status: "verified" | "failed" | "empty" | "unavailable";
  eventCount: number;
  lastSequence: number | null;
  checkedAt: number | null;
  message: string;
}

const UNAVAILABLE_INTEGRITY: AuditIntegrityResult = {
  status: "unavailable",
  eventCount: 0,
  lastSequence: null,
  checkedAt: null,
  message: "The background service did not provide an authoritative integrity result.",
};

const DEMO_EVENTS: AuditEntry[] = [
  { id: "e1", seq: 1, kind: "wallet-initialized", title: "Wallet initialized", detail: "Trust kernel activated, master key derived via PBKDF2 (600k iterations)", timestamp: Date.now() - 7200000, hash: "a3f8c2...d91e", prevHash: "000000...0000" },
  { id: "e2", seq: 2, kind: "key-generated",      title: "Key generated",     detail: "secp256k1 key slot created, BIP-39 mnemonic backed up", timestamp: Date.now() - 7100000, hash: "b7e1a4...c3f2", prevHash: "a3f8c2...d91e" },
  { id: "e3", seq: 3, kind: "account-created",    title: "Account created",   detail: "Ops EVM signer (0xae7e...ef10) linked to key slot", timestamp: Date.now() - 7000000, hash: "c9d2b5...e4a3", prevHash: "b7e1a4...c3f2" },
  { id: "e4", seq: 4, kind: "session-created",    title: "Session created",   detail: "Cruzible Treasury Console connected from cruzible.aethelred.org", timestamp: Date.now() - 3600000, hash: "d1f3c6...b5d4", prevHash: "c9d2b5...e4a3" },
  { id: "e5", seq: 5, kind: "request-received",   title: "Intent received",   detail: "sign-transaction from Aethelred Governance Console", timestamp: Date.now() - 1800000, hash: "e4a7d8...c6e5", prevHash: "d1f3c6...b5d4" },
  { id: "e6", seq: 6, kind: "policy-evaluated",   title: "Policy evaluated",  detail: "Outcome: approval-required (enterprise mode, tx signing rule)", timestamp: Date.now() - 1799000, hash: "f5b8e9...d7f6", prevHash: "e4a7d8...c6e5" },
  { id: "e7", seq: 7, kind: "approval-requested", title: "Approval requested", detail: "Treasury transfer review: 250,000 AEL to Operations Vault", timestamp: Date.now() - 1798000, hash: "a6c9f0...e8a7", prevHash: "f5b8e9...d7f6" },
  { id: "e8", seq: 8, kind: "lock-state-changed", title: "Auto-locked",       detail: "Wallet locked after 5-minute idle timeout", timestamp: Date.now() - 900000, hash: "b7d0a1...f9b8", prevHash: "a6c9f0...e8a7" },
  { id: "e9", seq: 9, kind: "lock-state-changed", title: "Unlocked",          detail: "Wallet unlocked via password authentication", timestamp: Date.now() - 600000, hash: "c8e1b2...a0c9", prevHash: "b7d0a1...f9b8" },
];

/* ─── Event kind → icon, color, and semantic group ───────────────── *
 * Grouping the 10 raw event kinds into 4 user-facing categories keeps
 * the filter chips scannable. The color mapping uses iOS Settings
 * convention (green=security/action, purple=keys, blue=network,
 * amber=pending review, gray=state). */
type FilterGroup = "security" | "session" | "policy" | "signing";

const KIND_META: Record<string, { icon: typeof Clock; color: string; group: FilterGroup }> = {
  "wallet-initialized": { icon: Shield,       color: "#34c759", group: "security" },
  "key-generated":      { icon: Key,          color: "#8b5cf6", group: "security" },
  "account-created":    { icon: Fingerprint,  color: "#8b5cf6", group: "security" },
  "lock-state-changed": { icon: Lock,         color: "#8e8e93", group: "security" },
  // Both export outcomes sit under Security: a refused export is what a
  // failed attempt to lift a key looks like, and belongs beside the success.
  "private-key-exported":       { icon: Key,  color: "#ff3b30", group: "security" },
  "private-key-export-refused": { icon: Key,  color: "#ff9f0a", group: "security" },
  "session-created":    { icon: Globe,        color: "#0ea5e9", group: "session"  },
  "request-received":   { icon: ArrowDownCircle, color: "#0ea5e9", group: "session" },
  "policy-evaluated":   { icon: Shield,       color: "#ff9f0a", group: "policy"   },
  "approval-requested": { icon: ScrollText,   color: "#ff9f0a", group: "policy"   },
  "approval-decided":   { icon: CheckCircle2, color: "#34c759", group: "policy"   },
  "signing-executed":   { icon: Key,          color: "#34c759", group: "signing"  },
};

const GROUPS: Array<{ id: FilterGroup; label: string }> = [
  { id: "security", label: "Security" },
  { id: "session",  label: "Sessions" },
  { id: "policy",   label: "Policy"   },
  { id: "signing",  label: "Signing"  },
];

/* ─── Time formatting ─────────────────────────────────────────────── *
 * Relative time for quick scanning ("23m ago") and absolute for
 * compliance reference ("10:45"). Combined per event in the UI. */
function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1)  return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24)  return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}
function formatAbsolute(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function AuditLogView() {
  const { send } = useBackground();
  const [filter, setFilter] = useState<FilterGroup | "all">("all");
  const [showHashes, setShowHashes] = useState(false);
  const [events, setEvents] = useState<AuditEntry[]>(IS_PRODUCTION_BUILD ? [] : DEMO_EVENTS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<AuditIntegrityResult>(UNAVAILABLE_INTEGRITY);

  useEffect(() => {
    /**
     * Serialized shape of an audit event as it crosses the background →
     * popup bridge. Mirrors `AuditEvent` from `@aethelred/wallet-audit`,
     * but we type it locally to avoid importing the package just for a
     * display adapter. Fields are optional so forward-compatible
     * additions don't crash the popup.
     */
    interface RawAuditEvent {
      id: string;
      sequenceNumber: number;
      kind: AuditEventKind;
      title?: string;
      detail?: unknown;
      timestamp: number;
      eventHash?: string;
      previousHash?: string;
    }
    send("get-audit-events", { limit: 100, includeIntegrity: true })
      .then((result) => {
        const envelope = result && typeof result === "object" && !Array.isArray(result)
          ? result as { events?: unknown; integrity?: unknown }
          : null;
        const rawEvents = envelope?.events;
        if (Array.isArray(rawEvents)) {
          setEvents((rawEvents as RawAuditEvent[]).map((e) => ({
            id: e.id,
            seq: e.sequenceNumber,
            kind: e.kind,
            title: e.kind.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
            detail: JSON.stringify(e.detail).slice(0, 100),
            timestamp: e.timestamp,
            /* The old version was `e.eventHash?.slice(0, 12) + "..." ?? "—"`.
             * Operator precedence evaluated that as
             * `(e.eventHash?.slice() + "...") ?? "—"` — and the string
             * concat on the left always produces a string (even
             * "undefined..."), so the `??` right operand was dead code.
             * Use a plain ternary so "—" actually appears for nullish inputs. */
            hash: e.eventHash ? e.eventHash.slice(0, 12) + "..." : "—",
            prevHash: e.previousHash ? e.previousHash.slice(0, 12) + "..." : "—",
          })));

          const rawIntegrity = envelope?.integrity;
          if (
            rawIntegrity &&
            typeof rawIntegrity === "object" &&
            ["verified", "failed", "empty", "unavailable"].includes(
              String((rawIntegrity as { status?: unknown }).status),
            )
          ) {
            setIntegrity(rawIntegrity as AuditIntegrityResult);
          } else {
            setIntegrity(UNAVAILABLE_INTEGRITY);
          }
          setLoadError(null);
          return;
        }

        if (IS_PRODUCTION_BUILD) {
          setEvents([]);
          setLoadError("Audit trail unavailable right now");
          setIntegrity(UNAVAILABLE_INTEGRITY);
        } else {
          setEvents(DEMO_EVENTS);
          setLoadError(null);
          setIntegrity(UNAVAILABLE_INTEGRITY);
        }
      })
      .catch(() => {
        if (IS_PRODUCTION_BUILD) {
          setEvents([]);
          setLoadError("Audit trail unavailable right now");
          setIntegrity(UNAVAILABLE_INTEGRITY);
        } else {
          setEvents(DEMO_EVENTS);
          setLoadError(null);
          setIntegrity(UNAVAILABLE_INTEGRITY);
        }
      });
  }, []);

  /* Newest-first view ordering. The underlying hash chain still
     references the previous event (seq N-1 via prevHash), so
     verifying integrity just requires walking the list downward —
     reversed only for display convenience. */
  const eventsByRecency = useMemo(() => {
    return [...events].sort((a, b) => b.timestamp - a.timestamp);
  }, [events]);

  /* Compute per-group counts for the filter chip labels. */
  const groupCounts = useMemo(() => {
    const counts: Record<FilterGroup, number> = { security: 0, session: 0, policy: 0, signing: 0 };
    for (const e of events) {
      const g = KIND_META[e.kind]?.group;
      if (g) counts[g]++;
    }
    return counts;
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (filter === "all") return eventsByRecency;
    return eventsByRecency.filter(e => KIND_META[e.kind]?.group === filter);
  }, [eventsByRecency, filter]);

  /* Time range covered by the log (for hero subtitle). */
  const timeRange = useMemo(() => {
    if (events.length === 0) return "—";
    const oldest = Math.min(...events.map(e => e.timestamp));
    return `Since ${formatRelative(oldest)}`;
  }, [events]);

  const heroTitle = `${events.length} events logged`;
  const heroSub = loadError
    ? "Demo entries are hidden because the background service did not return audit data."
    : events.length === 0
      ? "No audit events yet"
      : timeRange;
  const chainTitle = loadError
    ? "Audit verification unavailable"
    : integrity.status === "verified"
      ? "SHA-256 chain verified"
      : integrity.status === "failed"
        ? "Audit chain integrity failure"
        : integrity.status === "empty"
          ? "Audit chain not verified"
          : "Audit verification unavailable";
  const chainSubtitle = loadError
    ? "The background audit service could not be reached."
    : integrity.message;
  const emptyTitle = loadError ? "Audit trail unavailable" : "No audit events yet";
  const emptyDescription = loadError
    ? "The wallet background service did not return audit entries, so demo data is hidden in production."
    : "Recent audit events will appear here once the wallet records them.";

  const handleExport = () => {
    const data = JSON.stringify({ version: "1.0.0", events, exportedAt: Date.now() }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aethelred-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="view-padded">
      {/* ═════ Hero — compliance trail status ═════ */}
      <div className="rp-hero">
        <div className="rp-hero-top">
          <div className="rp-hero-icon">
            <ScrollText size={18} strokeWidth={2.3} />
          </div>
          <div className="rp-hero-title-block">
            <span className="rp-hero-label">COMPLIANCE TRAIL</span>
            <strong className="rp-hero-title">
              {heroTitle}
            </strong>
            <span className="rp-hero-sub">{heroSub}</span>
          </div>
          <button className="rp-export-btn" onClick={handleExport} type="button" aria-label="Export audit log">
            <Download size={14} strokeWidth={2.3} />
          </button>
        </div>

        <div className="rp-chain-status">
          <div className="rp-chain-icon">
            <Shield size={13} strokeWidth={2.6} />
          </div>
          <div className="rp-chain-body">
            <strong>{chainTitle}</strong>
            <span>{chainSubtitle}</span>
          </div>
          <button
            className={`rp-hash-toggle ${showHashes ? "on" : ""}`}
            onClick={() => setShowHashes(!showHashes)}
            type="button"
            aria-label="Toggle cryptographic proof"
            title={showHashes ? "Hide cryptographic proof" : "Show cryptographic proof"}
          >
            <Link2 size={11} strokeWidth={2.6} />
          </button>
        </div>
      </div>

      {/* ═════ Filter chips ═════ */}
      <div className="rp-filters">
        <button
          className={`rp-filter ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
          type="button"
        >
          All <span className="rp-filter-count">{events.length}</span>
        </button>
        {GROUPS.map(g => (
          <button
            key={g.id}
            className={`rp-filter ${filter === g.id ? "active" : ""}`}
            onClick={() => setFilter(g.id)}
            type="button"
          >
            {g.label} <span className="rp-filter-count">{groupCounts[g.id]}</span>
          </button>
        ))}
      </div>

      {/* ═════ Event timeline ═════ */}
      <div className="rp-section-label">Recent Activity</div>

      {filteredEvents.length === 0 ? (
        <div className="rp-empty">
          <Clock size={20} />
          <strong>{emptyTitle}</strong>
          <span>{emptyDescription}</span>
        </div>
      ) : (
        <div className="rp-timeline">
          {filteredEvents.map((event, i) => {
            const meta = KIND_META[event.kind] ?? { icon: Clock, color: "#8e8e93", group: "security" as const };
            const Icon = meta.icon;
            const isLast = i === filteredEvents.length - 1;
            return (
              <div className="rp-event" key={event.id}>
                <div className="rp-event-rail">
                  <div
                    className="rp-event-tile"
                    style={{
                      background: `linear-gradient(135deg, ${meta.color} 0%, ${meta.color}c0 100%)`,
                      boxShadow: `0 3px 10px ${meta.color}40`,
                    }}
                  >
                    <Icon size={13} strokeWidth={2.3} />
                  </div>
                  {!isLast && <div className="rp-event-line" />}
                </div>

                <div className="rp-event-card">
                  <div className="rp-event-header">
                    <strong>{event.title}</strong>
                    <span className="rp-event-time">
                      {formatRelative(event.timestamp)}
                      <span className="rp-event-time-abs">{formatAbsolute(event.timestamp)}</span>
                    </span>
                  </div>
                  <p className="rp-event-detail">{event.detail}</p>

                  {showHashes && (
                    <div className="rp-event-hash">
                      <div className="rp-hash-row">
                        <span className="rp-hash-label">#{event.seq}</span>
                        <code>{event.hash}</code>
                      </div>
                      <div className="rp-hash-row prev">
                        <span className="rp-hash-label">prev</span>
                        <code>{event.prevHash}</code>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
