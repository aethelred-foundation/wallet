/**
 * WalletConnect v2 session-manager scaffold.
 *
 * @remarks
 * This file defines the lifecycle surface the rest of the extension
 * already depends on (bridge messages, popup view, audit hooks,
 * session registry). The *wire* to `@walletconnect/web3wallet` is
 * NOT plugged in yet — that dependency ships a sizeable transitive
 * tree (`@walletconnect/core`, `@walletconnect/relay-auth`,
 * ethers-shim, pino, etc.) worth a dedicated security review + bundle
 * audit before we accept it into a Manifest V3 service worker.
 *
 * The stub below:
 *   1. Is fully typed and behaves correctly when called (no throws,
 *      promises always settle).
 *   2. Logs every operation under the `[walletconnect-manager]`
 *      prefix so the integration surface is visible in dev builds.
 *   3. Returns empty session lists / resolves with safe defaults.
 *   4. Preserves the *exact* API surface the real SDK integration
 *      will need — dropping the real client in is tracked via the
 *      grouped `@todo` tags below.
 *
 * When the SDK lands, the integration sequence is:
 *   a. In {@link WalletConnectManager.init}, construct a `Web3Wallet`
 *      (or `WalletKit`) instance via its async factory.
 *   b. Wire `client.on("session_proposal", …)` → `config.onProposal`.
 *   c. Wire `client.on("session_request", …)` → `config.onRequest`.
 *   d. Wire `client.on("session_delete", …)` → `config.onSessionExpire`.
 *   e. Implement the call sites documented in the class-level `@todo`
 *      tags.
 *
 * Until then: every public method is safe to call, and the UI can
 * build against this exact surface.
 */

import type {
  WalletConnectApprovedNamespace,
  WalletConnectPeerMetadata,
  WalletConnectProposalDecision,
  WalletConnectRequestDecision,
  WalletConnectSession,
  WalletConnectSessionProposal,
  WalletConnectSessionRequest,
} from "@aethelred/wallet-connect";
import { parseWalletConnectUri } from "@aethelred/wallet-connect";

/**
 * Tag every console message coming out of this module so it's
 * greppable during extension debugging.
 */
const LOG_PREFIX = "[walletconnect-manager]";

/**
 * Lightweight logger that prefixes every call. Centralised so the
 * real SDK integration can swap in a structured logger (pino, etc.)
 * without touching every call site.
 */
const logger = {
  info: (message: string, ...rest: unknown[]): void => {
    console.info(LOG_PREFIX, message, ...rest);
  },
  warn: (message: string, ...rest: unknown[]): void => {
    console.warn(LOG_PREFIX, message, ...rest);
  },
  error: (message: string, ...rest: unknown[]): void => {
    console.error(LOG_PREFIX, message, ...rest);
  },
};

/**
 * Audit hook signature the manager calls on every session-lifecycle
 * event. The real implementation injected from the service worker
 * forwards into `AuditCapture.record`; the default no-ops so unit
 * tests and dev builds don't need to supply one.
 *
 * Event kinds intentionally mirror
 * {@link import("@aethelred/wallet-audit").AuditEventKind}'s
 * session-scoped subset so the audit log can be queried uniformly.
 */
type WalletConnectAuditEvent =
  | {
      kind: "session-created";
      topic: string;
      peer: WalletConnectPeerMetadata;
      namespaces: Record<string, WalletConnectApprovedNamespace>;
    }
  | {
      kind: "session-revoked";
      topic: string;
      reason?: string;
    }
  | {
      kind: "request-received";
      topic: string;
      method: string;
      chainId: string;
    }
  | {
      kind: "approval-requested";
      topic: string;
      proposalId: number;
      peer: WalletConnectPeerMetadata;
    }
  | {
      kind: "approval-decided";
      topic: string;
      proposalId: number;
      decision: "approved" | "rejected";
    };

/**
 * Configuration passed to the manager at construction time. Every
 * callback is required; the manager NEVER inspects the signer, key
 * store, or policy engine directly — those sit behind `onRequest`
 * and `onProposal`.
 */
interface WalletConnectManagerConfig {
  /**
   * Project id from WalletConnect Cloud. Required by the real SDK;
   * the stub accepts any non-empty string (including placeholders)
   * so dev builds aren't blocked on secrets rotation.
   */
  projectId: string;
  /** Metadata the wallet publishes to dApps during pairing. */
  walletMetadata: WalletConnectPeerMetadata;
  /**
   * Hand a session proposal off to the UI. The UI must call back
   * with either `{ approved: true, accounts, namespaces }` or
   * `{ approved: false }` — timing out is equivalent to `false`.
   */
  onProposal: (
    proposal: WalletConnectSessionProposal,
  ) => Promise<WalletConnectProposalDecision>;
  /**
   * Hand an incoming RPC request to the approval pipeline. This is
   * the CRITICAL hook: every WalletConnect RPC MUST traverse the
   * existing policy / workflow flow, never a direct path to the
   * signer. Return `{ result }` on success or `{ error }` on failure.
   */
  onRequest: (
    request: WalletConnectSessionRequest,
  ) => Promise<WalletConnectRequestDecision>;
  /**
   * Fired when a session expires (TTL elapsed, peer disconnected,
   * or the user revoked in-wallet). The supplied topic is the one
   * that was removed; consumers should drop any cached session
   * pointers to it.
   */
  onSessionExpire: (topic: string) => void;
  /**
   * Optional audit sink. When supplied, the manager records a
   * lifecycle event on every session-scope transition; when omitted,
   * audit is a no-op (useful for unit tests).
   */
  onAudit?: (event: WalletConnectAuditEvent) => void;
}

/**
 * The lifecycle-manager surface the rest of the extension depends on.
 *
 * Contract notes:
 *   - `init()` is idempotent and safe to call multiple times.
 *   - Every method returns a Promise that *always* settles; errors
 *     surface as rejections (never thrown synchronously).
 *   - `onSessionsChanged` is a push-based snapshot: subscribers get
 *     the full session list every time anything changes.
 *   - `getActiveSessions()` returns a defensive copy; mutating the
 *     returned array does NOT mutate the manager's internal state.
 *
 * @todo GH-ISSUE(walletconnect-sdk-bootstrap): wire the real SDK
 *   lifecycle. `init()` must construct a `Web3Wallet` via
 *   `Web3Wallet.init({ core: new Core({ projectId }), metadata })`,
 *   attach event subscribers (`session_proposal`, `session_request`,
 *   `session_delete`) and persist the returned client in
 *   `this.client` (currently `unknown = null`). The field type
 *   should widen to `IWeb3Wallet` when the SDK lands.
 *
 * @todo GH-ISSUE(walletconnect-sdk-pairing): wire pair + proposal
 *   lifecycle. `pair(uri)` must call
 *   `this.client.core.pairing.pair({ uri })`. `approveProposal` must
 *   call `this.client.approveSession({ id, namespaces })`, translate
 *   the returned active session into {@link WalletConnectSession},
 *   and emit `notifySessionsChanged`. `rejectProposal` must call
 *   `this.client.rejectSession({ id, reason })` with the SDK error
 *   shape `{ code: 5000, message }`.
 *
 * @todo GH-ISSUE(walletconnect-sdk-requests): wire RPC bridge.
 *   `respondToRequest(id, response)` must map to
 *   `this.client.respondSessionRequest({ topic, response })` — the
 *   topic is resolved from the pending-requests index. Responses are
 *   JSON-RPC 2.0 shapes (`{ id, jsonrpc: "2.0", result|error }`).
 *
 * @todo GH-ISSUE(walletconnect-sdk-sessions): wire session teardown
 *   + live snapshot. `disconnectSession(topic)` must call
 *   `this.client.disconnectSession({ topic, reason })` with
 *   `{ code: 6000, message: "User disconnected." }`.
 *   `getActiveSessions()` should pull live state from
 *   `this.client.getActiveSessions()` and adapt each SDK
 *   `SessionTypes.Struct` into our local shape.
 */
export class WalletConnectManager {
  private readonly config: WalletConnectManagerConfig;
  private initialized = false;
  private readonly sessions = new Map<string, WalletConnectSession>();
  private readonly proposals = new Map<number, WalletConnectSessionProposal>();
  private readonly sessionListeners = new Set<
    (sessions: WalletConnectSession[]) => void
  >();
  /**
   * Placeholder for the real SDK client handle. Typed as `unknown`
   * so the stub never accidentally reaches into SDK internals the
   * tests don't care about. Exposed via `getClient()` to keep the
   * field reachable even before the SDK is wired in — prevents
   * TS6133 (unused field) while still making the plug-in point
   * explicit.
   *
   * See `@todo GH-ISSUE(walletconnect-sdk-bootstrap)` on the class
   * for the widening plan.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private client: unknown = null;

  /**
   * Escape hatch for testing and future SDK wiring — returns the
   * underlying client handle (or `null` if init hasn't run). Consumers
   * should prefer the public lifecycle methods over reaching into
   * the client directly.
   */
  getClient(): unknown {
    return this.client;
  }

  constructor(config: WalletConnectManagerConfig) {
    if (!config.projectId || config.projectId.trim().length === 0) {
      throw new Error("WalletConnectManager: projectId is required");
    }
    this.config = config;
  }

  /**
   * Boot the underlying WalletConnect client. Safe to call more than
   * once — subsequent calls are no-ops.
   */
  async init(): Promise<void> {
    if (this.initialized) {
      logger.info("init() called but already initialized — no-op");
      return;
    }
    logger.info("init()", {
      projectId: this.config.projectId,
      walletName: this.config.walletMetadata.name,
    });
    this.initialized = true;
  }

  /**
   * Pair with a dApp using the raw `wc:` URI the user pasted or
   * scanned. The URI is parsed here defensively; malformed strings
   * reject with a clear error instead of being handed to the SDK.
   */
  async pair(uri: string): Promise<void> {
    if (!this.initialized) {
      throw new Error("WalletConnectManager.pair called before init()");
    }
    const parsed = parseWalletConnectUri(uri);
    if (!parsed) {
      const message = "Invalid WalletConnect pairing URI";
      logger.warn("pair() rejected", { reason: message });
      throw new Error(message);
    }
    logger.info("pair()", { topicHint: parsed.slice(0, 12) + "…" });
    return Promise.resolve();
  }

  /**
   * Approve a session proposal. The caller supplies the finalised
   * accounts + namespaces after the user has picked chains and
   * reviewed the method list.
   */
  async approveProposal(
    proposalId: number,
    accounts: string[],
    namespaces: Record<string, WalletConnectApprovedNamespace>,
  ): Promise<void> {
    if (!this.initialized) {
      throw new Error(
        "WalletConnectManager.approveProposal called before init()",
      );
    }
    const proposal = this.proposals.get(proposalId);
    logger.info("approveProposal()", {
      proposalId,
      accountCount: accounts.length,
      namespaceKeys: Object.keys(namespaces),
    });
    this.config.onAudit?.({
      kind: "approval-decided",
      topic: proposal?.pairingTopic ?? "unknown",
      proposalId,
      decision: "approved",
    });
    this.proposals.delete(proposalId);
    return Promise.resolve();
  }

  /**
   * Reject a session proposal. Fires an audit event and clears the
   * proposal from the in-memory queue.
   */
  async rejectProposal(proposalId: number, reason?: string): Promise<void> {
    if (!this.initialized) {
      throw new Error(
        "WalletConnectManager.rejectProposal called before init()",
      );
    }
    const proposal = this.proposals.get(proposalId);
    logger.info("rejectProposal()", { proposalId, reason });
    this.config.onAudit?.({
      kind: "approval-decided",
      topic: proposal?.pairingTopic ?? "unknown",
      proposalId,
      decision: "rejected",
    });
    this.proposals.delete(proposalId);
    return Promise.resolve();
  }

  /**
   * Respond to an RPC request the SDK handed to `onRequest`. The
   * caller decides how to shape the response; this method is purely
   * a pass-through.
   */
  async respondToRequest(
    id: number,
    response: {
      result?: unknown;
      error?: { code: number; message: string; data?: unknown };
    },
  ): Promise<void> {
    if (!this.initialized) {
      throw new Error(
        "WalletConnectManager.respondToRequest called before init()",
      );
    }
    logger.info("respondToRequest()", {
      id,
      ok: response.error === undefined,
      errorCode: response.error?.code,
    });
    return Promise.resolve();
  }

  /**
   * Disconnect an active session by topic. Fires the `onSessionExpire`
   * callback and emits a `session-revoked` audit event.
   */
  async disconnectSession(topic: string): Promise<void> {
    if (!this.initialized) {
      throw new Error(
        "WalletConnectManager.disconnectSession called before init()",
      );
    }
    logger.info("disconnectSession()", { topic });
    this.config.onAudit?.({
      kind: "session-revoked",
      topic,
    });
    const removed = this.sessions.delete(topic);
    if (removed) {
      this.notifySessionsChanged();
    }
    this.config.onSessionExpire(topic);
    return Promise.resolve();
  }

  /**
   * Snapshot of the active sessions. Returns a defensive copy.
   */
  getActiveSessions(): WalletConnectSession[] {
    return Array.from(this.sessions.values()).map((s) => ({ ...s }));
  }

  /**
   * Subscribe to session-list changes. The returned function
   * unsubscribes when called. Listeners are invoked *after* the
   * manager's internal state has been updated so `getActiveSessions()`
   * inside a listener always sees the new state.
   */
  onSessionsChanged(
    listener: (sessions: WalletConnectSession[]) => void,
  ): () => void {
    this.sessionListeners.add(listener);
    // Fire once immediately with the current snapshot so new
    // subscribers don't have to wait for the next change.
    try {
      listener(this.getActiveSessions());
    } catch (err) {
      logger.error("session listener threw during initial fire", err);
    }
    return () => {
      this.sessionListeners.delete(listener);
    };
  }

  /**
   * Internal — push the current snapshot to every subscriber.
   * Isolated so the real SDK integration has one call site to hit.
   */
  private notifySessionsChanged(): void {
    const snapshot = this.getActiveSessions();
    for (const listener of this.sessionListeners) {
      try {
        listener(snapshot);
      } catch (err) {
        logger.error("session listener threw", err);
      }
    }
  }

  /**
   * Ingestion helper for tests — lets a test harness simulate a
   * session proposal arriving without the SDK being present.
   *
   * The real SDK integration fires this from its `session_proposal`
   * event handler (see {@link WalletConnectManager.init}).
   */
  async __test_injectProposal(
    proposal: WalletConnectSessionProposal,
  ): Promise<WalletConnectProposalDecision> {
    this.proposals.set(proposal.id, proposal);
    this.config.onAudit?.({
      kind: "approval-requested",
      topic: proposal.pairingTopic,
      proposalId: proposal.id,
      peer: proposal.proposer.metadata,
    });
    return this.config.onProposal(proposal);
  }

  /**
   * Ingestion helper for tests — simulate an inbound RPC request.
   */
  async __test_injectRequest(
    request: WalletConnectSessionRequest,
  ): Promise<WalletConnectRequestDecision> {
    this.config.onAudit?.({
      kind: "request-received",
      topic: request.topic,
      method: request.params.request.method,
      chainId: request.params.chainId,
    });
    return this.config.onRequest(request);
  }

  /**
   * Ingestion helper for tests — simulate a session being settled.
   */
  __test_injectSession(session: WalletConnectSession): void {
    this.sessions.set(session.topic, session);
    this.config.onAudit?.({
      kind: "session-created",
      topic: session.topic,
      peer: session.peer.metadata,
      namespaces: session.namespaces,
    });
    this.notifySessionsChanged();
  }
}
