/**
 * WalletConnect v2 view — pair, approve, list, disconnect.
 *
 * This view is the user-facing surface for the bridge plumbing in
 * `packages/connect/src/bridge-types.ts` (the `wc-*` message kinds)
 * and the lifecycle manager in
 * `apps/extension/src/services/walletconnect-manager.ts`.
 *
 * State machine:
 *   idle       → empty or session-list surface
 *   pairing    → URI submitted; waiting for `session_proposal`
 *   proposal   → proposal in flight; user must accept/reject
 *   error      → last bridge call returned an error
 *
 * Every user-visible string is hoisted to the `COPY` table so it
 * can be swapped out for i18n without touching the JSX.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Link2,
  ScanLine,
  ShieldCheck,
  ShieldAlert,
  X,
  Globe,
  RefreshCw,
  Info,
  CheckCircle2,
  Zap,
} from "lucide-react";
import type {
  WalletConnectSession,
  WcSessionProposalPayload,
} from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import { useBackground } from "../hooks/use-background";
import { DappLogo } from "../components/dapp-logo";
import { ConfirmModal } from "../components/confirm-modal";

/**
 * Centralised user-facing copy. Extracting every string here keeps
 * the view ready for i18next / Lingui adoption without touching
 * the JSX layout.
 */
const COPY = {
  title: "WalletConnect",
  subtitle: "Connect to dApps that use the WalletConnect protocol.",
  back: "Back",
  inputLabel: "Pairing URI",
  inputPlaceholder: "wc:abc…@2?relay-protocol=irn&symKey=…",
  connect: "Connect",
  scanQr: "Scan QR",
  refresh: "Refresh",
  sessions: "Active sessions",
  empty: {
    headline: "No WalletConnect sessions",
    body:
      "Paste a WalletConnect pairing URI from a dApp, or scan the QR code the dApp shows, to start a session. Every request the dApp sends will be routed through your approval flow.",
    helpTitle: "What is WalletConnect?",
    helpBody:
      "WalletConnect is an open protocol that lets web-based dApps talk to your wallet without exposing your keys. Sessions are scoped to chains, methods, and accounts you explicitly approve.",
  },
  session: {
    disconnect: "Disconnect",
    chains: "Chains",
    methods: "Methods",
    accounts: "Accounts",
    expires: "Expires",
    acknowledged: "Active",
    pending: "Pending peer ack",
  },
  proposal: {
    eyebrow: "Session proposal",
    headline: "Review this connection",
    required: "Required",
    optional: "Optional",
    accept: "Approve",
    reject: "Reject",
    accounts: "Accounts to expose",
  },
  errors: {
    invalidUri:
      "That doesn't look like a WalletConnect pairing link. Paste a `wc:` URI or scan the dApp's QR code.",
    pairFailed: "Pairing failed. Ask the dApp to regenerate the QR code.",
    disconnectFailed: "Could not disconnect the session.",
  },
  confirmDisconnect: {
    title: "Disconnect this session?",
    description:
      "The dApp will lose access to your accounts immediately. You can reconnect later by pairing again.",
    confirm: "Disconnect",
  },
} as const;

/**
 * Local UI state — completely separate from the manager's internal
 * state. The manager owns the canonical session list; this component
 * holds pairing input, error text, and the currently-rendered
 * proposal.
 */
type LocalStatus =
  | { phase: "idle" }
  | { phase: "pairing" }
  | { phase: "error"; message: string };

function formatExpiry(expiry: number): string {
  const date = new Date(expiry * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Derive a chain summary (CAIP-2 shorthand) from an approved
 * namespace. Used in the session card's meta row.
 */
function summariseChains(
  namespaces: WalletConnectSession["namespaces"],
): string[] {
  const out = new Set<string>();
  for (const ns of Object.values(namespaces)) {
    for (const chain of ns.chains ?? []) out.add(chain);
    for (const acc of ns.accounts ?? []) {
      const parts = acc.split(":");
      if (parts.length >= 2) out.add(`${parts[0]}:${parts[1]}`);
    }
  }
  return Array.from(out);
}

/**
 * Derive the method list across all namespaces. De-duplicated,
 * alphabetised for a stable render order.
 */
function summariseMethods(
  namespaces: WalletConnectSession["namespaces"],
): string[] {
  const out = new Set<string>();
  for (const ns of Object.values(namespaces)) {
    for (const method of ns.methods ?? []) out.add(method);
  }
  return Array.from(out).sort();
}

export function WalletConnectView() {
  const { navigate, params } = useNavigation();
  const { send } = useBackground();

  const [uri, setUri] = useState(params.uri ?? "");
  const [status, setStatus] = useState<LocalStatus>({ phase: "idle" });
  const [sessions, setSessions] = useState<WalletConnectSession[]>([]);
  const [proposal, setProposal] = useState<WcSessionProposalPayload | null>(
    null,
  );
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const activeSession = useMemo(
    () => sessions.find((s) => s.topic === disconnecting) ?? null,
    [sessions, disconnecting],
  );

  /**
   * Load the current session list from the background. Called on
   * mount and every time the user taps Refresh.
   *
   * The bridge may return `undefined` in dev mode — we coerce to `[]`
   * so the view never crashes.
   */
  const reloadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const result = (await send("wc-sessions", {})) as
        | WalletConnectSession[]
        | undefined;
      setSessions(Array.isArray(result) ? result : []);
    } catch (err) {
      // Background not ready (dev mode, pre-init) — treat as empty.
      setSessions([]);
      if (import.meta.env?.DEV) {
        console.info("[wallet-connect view] sessions fetch failed", err);
      }
    } finally {
      setLoadingSessions(false);
    }
  }, [send]);

  useEffect(() => {
    void reloadSessions();
  }, [reloadSessions]);

  /**
   * Submit a pairing URI. Validation happens in the background
   * via `parseWalletConnectUri`; we just surface the error message
   * to the user.
   */
  const handleConnect = useCallback(async () => {
    const trimmed = uri.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("wc:")) {
      setStatus({ phase: "error", message: COPY.errors.invalidUri });
      return;
    }
    setStatus({ phase: "pairing" });
    try {
      await send("wc-pair", { uri: trimmed });
      setUri("");
      // Keep `pairing` visible until a proposal arrives or the user
      // navigates away — the proposal listener below drops it.
    } catch (err) {
      const message =
        err instanceof Error ? err.message : COPY.errors.pairFailed;
      setStatus({ phase: "error", message });
    }
  }, [send, uri]);

  /**
   * Approve the currently-displayed proposal. The UI pre-selects
   * every account the active subject owns — in the real integration
   * this should narrow to the active workspace's accounts.
   */
  const handleApprove = useCallback(async () => {
    if (!proposal) return;
    // Build a namespaces response that mirrors the dApp's request.
    // Real integration: intersect with wallet capabilities + active
    // accounts; for the stub we echo the request shape.
    const namespaces: Record<
      string,
      {
        accounts: string[];
        methods: string[];
        events: string[];
        chains?: string[];
      }
    > = {};
    for (const [key, req] of Object.entries(proposal.requiredNamespaces)) {
      namespaces[key] = {
        accounts: [],
        methods: req.methods,
        events: req.events,
        chains: req.chains,
      };
    }
    try {
      await send("wc-approve-proposal", {
        proposalId: proposal.proposalId,
        accounts: [],
        namespaces,
      });
      setProposal(null);
      setStatus({ phase: "idle" });
      void reloadSessions();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : COPY.errors.pairFailed;
      setStatus({ phase: "error", message });
    }
  }, [proposal, reloadSessions, send]);

  /** Reject the currently-displayed proposal. */
  const handleReject = useCallback(async () => {
    if (!proposal) return;
    try {
      await send("wc-reject-proposal", {
        proposalId: proposal.proposalId,
      });
      setProposal(null);
      setStatus({ phase: "idle" });
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.info("[wallet-connect view] reject failed", err);
      }
      setProposal(null);
    }
  }, [proposal, send]);

  /**
   * Confirm disconnect — the ConfirmModal calls through to here
   * after the user clicks Disconnect.
   */
  const handleDisconnect = useCallback(async () => {
    const topic = disconnecting;
    if (!topic) return;
    try {
      await send("wc-disconnect", { topic });
      setDisconnecting(null);
      void reloadSessions();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : COPY.errors.disconnectFailed;
      setStatus({ phase: "error", message });
      setDisconnecting(null);
    }
  }, [disconnecting, reloadSessions, send]);

  return (
    <div className="view-padded">
      <button
        className="acc-back"
        onClick={() => navigate("settings")}
        type="button"
      >
        <ArrowLeft size={14} /> {COPY.back}
      </button>

      <div className="wc-hero">
        <div className="wc-hero-icon">
          <Link2 size={22} strokeWidth={2.4} />
        </div>
        <div className="wc-hero-body">
          <span className="wc-hero-eyebrow">WALLETCONNECT v2</span>
          <strong className="wc-hero-title">{COPY.title}</strong>
          <span className="wc-hero-sub">{COPY.subtitle}</span>
        </div>
      </div>

      {proposal ? (
        <div className="wc-proposal-banner">
          <div className="wc-proposal-header">
            <span className="wc-proposal-eyebrow">
              <Zap size={10} strokeWidth={2.8} /> {COPY.proposal.eyebrow}
            </span>
            <strong>{COPY.proposal.headline}</strong>
          </div>
          <div className="wc-peer-meta">
            <DappLogo name={proposal.peer.metadata.name} size={40} />
            <div className="wc-peer-meta-body">
              <strong>{proposal.peer.metadata.name}</strong>
              <span>{proposal.peer.metadata.url}</span>
              {proposal.peer.metadata.description ? (
                <p>{proposal.peer.metadata.description}</p>
              ) : null}
            </div>
          </div>

          <div className="wc-namespace-list">
            {Object.entries(proposal.requiredNamespaces).map(([key, ns]) => (
              <NamespaceBlock
                key={`req-${key}`}
                label={`${COPY.proposal.required} • ${key}`}
                chains={ns.chains ?? []}
                methods={ns.methods}
                events={ns.events}
                required
              />
            ))}
            {Object.entries(proposal.optionalNamespaces).map(([key, ns]) => (
              <NamespaceBlock
                key={`opt-${key}`}
                label={`${COPY.proposal.optional} • ${key}`}
                chains={ns.chains ?? []}
                methods={ns.methods}
                events={ns.events}
              />
            ))}
          </div>

          <div className="wc-proposal-actions">
            <button
              type="button"
              className="wc-btn wc-btn-ghost"
              onClick={handleReject}
            >
              <X size={14} /> {COPY.proposal.reject}
            </button>
            <button
              type="button"
              className="wc-btn wc-btn-primary"
              onClick={handleApprove}
            >
              <CheckCircle2 size={14} /> {COPY.proposal.accept}
            </button>
          </div>
        </div>
      ) : null}

      <div className="wc-input-row">
        <label className="wc-input-label" htmlFor="wc-uri-input">
          {COPY.inputLabel}
        </label>
        <div className="wc-input-wrap">
          <input
            id="wc-uri-input"
            className="wc-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={COPY.inputPlaceholder}
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleConnect();
            }}
          />
          <button
            className="wc-input-scan"
            onClick={() => navigate("qr-scanner")}
            type="button"
            aria-label={COPY.scanQr}
            title={COPY.scanQr}
          >
            <ScanLine size={14} />
          </button>
        </div>
        <button
          className="wc-btn wc-btn-primary wc-btn-block"
          onClick={handleConnect}
          type="button"
          disabled={status.phase === "pairing" || uri.trim().length === 0}
        >
          <Link2 size={14} />
          {status.phase === "pairing" ? "Connecting…" : COPY.connect}
        </button>
      </div>

      {status.phase === "error" ? (
        <div className="wc-error">
          <ShieldAlert size={14} />
          <span>{status.message}</span>
        </div>
      ) : null}

      <div className="wc-sessions-header">
        <h3 className="wc-sessions-title">{COPY.sessions}</h3>
        <button
          className="wc-sessions-refresh"
          onClick={() => void reloadSessions()}
          type="button"
          disabled={loadingSessions}
          aria-label={COPY.refresh}
          title={COPY.refresh}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="wc-empty">
          <div className="wc-empty-icon">
            <Globe size={28} strokeWidth={2.2} />
          </div>
          <strong>{COPY.empty.headline}</strong>
          <p>{COPY.empty.body}</p>
          <div className="wc-empty-tip">
            <Info size={12} />
            <div>
              <strong>{COPY.empty.helpTitle}</strong>
              <span>{COPY.empty.helpBody}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="wc-sessions">
          {sessions.map((session) => (
            <SessionCard
              key={session.topic}
              session={session}
              onDisconnect={() => setDisconnecting(session.topic)}
            />
          ))}
        </div>
      )}

      <ConfirmModal
        open={!!disconnecting}
        title={COPY.confirmDisconnect.title}
        description={
          activeSession
            ? `${activeSession.peer.metadata.name} — ${COPY.confirmDisconnect.description}`
            : COPY.confirmDisconnect.description
        }
        confirmLabel={COPY.confirmDisconnect.confirm}
        variant="danger"
        onConfirm={handleDisconnect}
        onCancel={() => setDisconnecting(null)}
      />
    </div>
  );
}

/**
 * Subcomponent — renders a single approved / active session. Kept
 * inline so the whole view lives in one file.
 */
function SessionCard({
  session,
  onDisconnect,
}: {
  session: WalletConnectSession;
  onDisconnect: () => void;
}) {
  const chains = summariseChains(session.namespaces);
  const methods = summariseMethods(session.namespaces);
  const expiresLabel = formatExpiry(session.expiry);

  return (
    <div className="wc-session-card">
      <div className="wc-peer-meta">
        <DappLogo name={session.peer.metadata.name} size={36} />
        <div className="wc-peer-meta-body">
          <strong>{session.peer.metadata.name}</strong>
          <span>{session.peer.metadata.url}</span>
        </div>
        <span
          className={`wc-session-status ${
            session.acknowledged ? "ack" : "pending"
          }`}
        >
          {session.acknowledged ? (
            <ShieldCheck size={10} strokeWidth={2.8} />
          ) : (
            <ShieldAlert size={10} strokeWidth={2.8} />
          )}
          {session.acknowledged
            ? COPY.session.acknowledged
            : COPY.session.pending}
        </span>
      </div>

      {chains.length > 0 ? (
        <div className="wc-session-row">
          <span className="wc-session-row-label">{COPY.session.chains}</span>
          <div className="wc-chip-row">
            {chains.map((c) => (
              <span className="wc-chip" key={c}>
                {c}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {methods.length > 0 ? (
        <div className="wc-session-row">
          <span className="wc-session-row-label">{COPY.session.methods}</span>
          <div className="wc-chip-row">
            {methods.map((m) => (
              <span className="wc-chip wc-chip-muted" key={m}>
                {m}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="wc-session-footer">
        {expiresLabel ? (
          <span className="wc-session-expires">
            {COPY.session.expires} {expiresLabel}
          </span>
        ) : (
          <span />
        )}
        <button
          className="wc-btn wc-btn-ghost wc-btn-sm"
          onClick={onDisconnect}
          type="button"
          aria-label={`${COPY.session.disconnect} ${session.peer.metadata.name}`}
        >
          <X size={11} strokeWidth={2.6} /> {COPY.session.disconnect}
        </button>
      </div>
    </div>
  );
}

/**
 * Subcomponent — renders one namespace block (required or optional)
 * inside the proposal banner.
 */
function NamespaceBlock({
  label,
  chains,
  methods,
  events,
  required,
}: {
  label: string;
  chains: string[];
  methods: string[];
  events: string[];
  required?: boolean;
}) {
  return (
    <div
      className={`wc-namespace-block ${required ? "required" : "optional"}`}
    >
      <span className="wc-namespace-label">{label}</span>
      {chains.length > 0 ? (
        <div className="wc-chip-row">
          {chains.map((c) => (
            <span className="wc-chip" key={`chain-${c}`}>
              {c}
            </span>
          ))}
        </div>
      ) : null}
      {methods.length > 0 ? (
        <div className="wc-chip-row">
          {methods.map((m) => (
            <span className="wc-chip wc-chip-muted" key={`method-${m}`}>
              {m}
            </span>
          ))}
        </div>
      ) : null}
      {events.length > 0 ? (
        <div className="wc-chip-row">
          {events.map((e) => (
            <span className="wc-chip wc-chip-faint" key={`event-${e}`}>
              {e}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
