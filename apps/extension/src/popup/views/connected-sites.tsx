import { useState } from "react";
import {
  Globe,
  Shield,
  Clock,
  ArrowLeft,
  X,
  ShieldAlert,
} from "lucide-react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import { useBackground } from "../hooks/use-background";
import { ConfirmModal } from "../components/confirm-modal";
import { DappLogo } from "../components/dapp-logo";

/* Shared permissions stylesheet (.cst2-* classes). */
import "../../styles/legacy/permissions.css";

/**
 * ConnectedSitesView — "Apple-grade" re-skin of the active dApp
 * session list.
 *
 * Preserved contract with the background:
 *   • `state.sessions` is the source of truth
 *   • disconnect fires the dedicated `revoke-session` command
 *   • trust level, origin, and permissions come straight from
 *     `SessionSummary` — no extra wire work
 *
 * `SessionSummary.createdAt` is sourced from the durable session grant;
 * the UI never fabricates connection times.
 */
export function ConnectedSitesView({ state }: { state: AethelredWalletState }) {
  const { navigate } = useNavigation();
  const { send } = useBackground();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const handleRevoke = async () => {
    if (revoking && !revokeBusy) {
      setRevokeBusy(true);
      setRevokeError(null);
      try {
        const result = (await send("revoke-session", {
          sessionId: revoking,
        })) as { ok?: boolean } | undefined;
        if (!result?.ok) throw new Error("The wallet did not confirm session revocation");
        setRevoking(null);
      } catch (error) {
        setRevokeError(error instanceof Error ? error.message : "Failed to revoke session");
      } finally {
        setRevokeBusy(false);
      }
    }
  };

  const session = state.sessions.find((s) => s.id === revoking);
  const count = state.sessions.length;

  const relativeTime = (createdAt?: number): string => {
    if (!createdAt || !Number.isFinite(createdAt)) return "time unavailable";
    const minutes = Math.max(0, Math.floor((Date.now() - createdAt) / 60_000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newThisWeek = state.sessions.filter(
    (s) => typeof s.createdAt === "number" && s.createdAt >= oneWeekAgo,
  ).length;

  /* Normalize trust level into the three visual buckets the CSS
     knows about: first-party, partner, unverified. Anything else
     maps to unverified to keep the amber cue visible. */
  const trustClass = (level: string): "first-party" | "partner" | "unverified" =>
    level === "first-party"
      ? "first-party"
      : level === "partner"
      ? "partner"
      : "unverified";

  return (
    <div className="view-padded">
      <button className="acc-back" onClick={() => navigate("settings")} type="button">
        <ArrowLeft size={14} /> Back
      </button>

      {/* Hero — cyan accent. Information surface, not a risk signal. */}
      <div className="cst2-hero">
        <div className="cst2-hero-icon">
          <Globe size={22} strokeWidth={2.4} />
        </div>
        <div className="cst2-hero-body">
          <span className="cst2-hero-label">CONNECTED APPS</span>
          <strong className="cst2-hero-title">
            {count === 0 ? "None connected" : `${count} active`}
          </strong>
          <span className="cst2-hero-sub">
            <Shield size={11} strokeWidth={2.6} /> Manage dApp sessions
          </span>
        </div>
        {count > 0 && (
          <span className="cst2-hero-badge">
            {newThisWeek === 0
              ? "All set"
              : `${newThisWeek} new`}
          </span>
        )}
      </div>

      {count === 0 ? (
        <div className="cst2-empty">
          <div className="cst2-empty-icon">
            <Globe size={28} strokeWidth={2.2} />
          </div>
          <strong>No connected apps</strong>
          <p>When you connect to a dApp, it'll appear here. You can revoke access at any time.</p>
        </div>
      ) : (
        <div className="cst2-list">
          {state.sessions.map((s) => {
            const trust = trustClass(s.trustLevel);
            const trustLabel =
              trust === "first-party"
                ? "First-party"
                : trust === "partner"
                ? "Partner"
                : "Unverified";

            return (
              <div className="cst2-card" key={s.id}>
                <div className="cst2-card-top">
                  <div className="cst2-card-logo">
                    <DappLogo name={s.appName} size={38} />
                  </div>
                  <div className="cst2-card-title-wrap">
                    <div className="cst2-card-title-row">
                      <strong className="cst2-card-title">{s.appName}</strong>
                      <span className={`cst2-trust-badge ${trust}`}>
                        {trust === "unverified" ? (
                          <ShieldAlert size={9} strokeWidth={2.8} />
                        ) : (
                          <Shield size={9} strokeWidth={2.8} />
                        )}
                        {trustLabel}
                      </span>
                    </div>
                    <span className="cst2-origin">{s.origin}</span>
                  </div>
                </div>

                {s.permissions.length > 0 && (
                  <div className="cst2-card-meta">
                    {s.permissions.map((p) => (
                      <span className="cst2-perm-chip" key={p}>
                        {p.replace(/[-_]/g, " ")}
                      </span>
                    ))}
                  </div>
                )}

                <div className="cst2-card-footer">
                  <span className="cst2-time">
                    <Clock size={11} strokeWidth={2.4} />
                    Connected {relativeTime(s.createdAt)}
                  </span>
                  <button
                    className="cst2-disconnect"
                    onClick={() => setRevoking(s.id)}
                    type="button"
                    aria-label={`Disconnect ${s.appName}`}
                  >
                    <X size={11} strokeWidth={2.6} /> Disconnect
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {revokeError && (
        <div className="cst2-empty" role="alert">
          <ShieldAlert size={20} />
          <strong>Disconnect failed</strong>
          <p>{revokeError}</p>
        </div>
      )}

      <ConfirmModal
        open={!!revoking}
        title="Disconnect site?"
        description={`This will revoke ${session?.appName ?? "this app"}'s access to your wallet. You can reconnect later.`}
        confirmLabel={revokeBusy ? "Disconnecting…" : "Disconnect"}
        variant="danger"
        onConfirm={handleRevoke}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}
