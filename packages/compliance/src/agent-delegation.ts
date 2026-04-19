/**
 * {@link AgentDelegationManager} — session-scoped delegation primitives for
 * TEE-attested autonomous agents.
 *
 * A delegation session binds an `agentId` + `subjectId` pair to a policy
 * that declares:
 *   - which contract/selector combinations the agent may invoke
 *   - how much total USD value the agent may spend over a sliding window
 *   - whether every call requires a fresh TEE attestation (not just session
 *     open) and, if so, how stale the attestation may be
 *   - whether the session auto-revokes when the agent's measurements drift
 *
 * The manager owns the lifecycle state for every open session, records
 * per-session spend, and produces typed {@link ../tee-attestation.RevocationRecord}
 * entries that downstream audit tooling can persist verbatim.
 *
 * The manager is intentionally in-memory: wiring this up to durable storage
 * is a deployment concern (it's the same storage adapter shape as the
 * policy velocity tracker and can be dropped in via a small refactor). For
 * Moat #3 scaffolding, in-memory fidelity is sufficient to exercise every
 * policy path in unit tests.
 *
 * @packageDocumentation
 */

import { AttestationVerifier } from "./attestation-verifier";
import {
  type AttestedAgent,
  type RevocationReason,
  type RevocationRecord,
  type TeeQuote,
  DelegationError,
  constantTimeHexEqual,
} from "./tee-attestation";

/**
 * Delegation policy — the envelope that governs every operation a delegated
 * agent can perform within a session.
 *
 * Fields are documented in terms of **operator intent** because these
 * policies are surfaced to human approvers at session-open time.
 *
 * @example Spend up to $5k per day, allow one contract+selector.
 * ```ts
 * const policy: DelegationPolicy = {
 *   maxSpendUsd: 5_000,
 *   windowMs: 24 * 60 * 60 * 1000,
 *   allowedCalls: [{
 *     chainId: 1,
 *     contractAddress: "0x0000000000000000000000000000000000000001",
 *     selector: "0xa9059cbb",
 *     description: "ERC20 transfer",
 *   }],
 *   attestationPerCall: false,
 *   maxAttestationAgeMs: 600_000,
 *   autoRevokeOnDrift: true,
 * };
 * ```
 */
export interface DelegationPolicy {
  /** Max spend in USD over `windowMs`. */
  maxSpendUsd: number;
  /** Sliding spend window duration in ms. */
  windowMs: number;
  /**
   * Approved call patterns.
   *
   * Each entry matches by the tuple `(chainId, contractAddress, selector)`.
   * Contracts are compared case-insensitively; selectors MUST include their
   * leading `0x` and be 4 bytes (10 characters).
   */
  allowedCalls: Array<{
    chainId: number;
    contractAddress: `0x${string}`;
    selector: `0x${string}`;
    /** Human-readable description for approval UIs and audit logs. */
    description: string;
  }>;
  /**
   * Require a fresh attestation for EVERY operation (not just session open).
   *
   * When true, `authorizeOperation` rejects with `attestation-required`
   * unless `currentAttestation` is provided AND meets the `maxAttestationAgeMs`
   * freshness bound.
   */
  attestationPerCall: boolean;
  /**
   * Max attestation staleness for per-call checks, in ms.
   *
   * Only applied when `attestationPerCall === true`. The verifier's global
   * `maxQuoteAgeMs` still applies on top of this — the per-call bound must
   * not be LOOSER than the verifier's, but the manager does not enforce
   * that relationship; operators should configure consistent values.
   */
  maxAttestationAgeMs: number;
  /**
   * Auto-revoke on measurement drift.
   *
   * When true, a per-call attestation whose `codeHash` differs from the
   * session's opening attestation triggers an immediate revocation with
   * reason `model-drift-detected`. When false, drift returns a
   * `measurement-drift` rejection but leaves the session live (the operator
   * can choose to tolerate expected measurement churn, e.g. during a
   * canary rollout).
   */
  autoRevokeOnDrift: boolean;
}

/**
 * Live delegation session.
 *
 * Sessions are immutable after open except for:
 *   - `revoked` — populated when the session is revoked
 *
 * Spend records are stored separately so the session shape remains stable
 * for persistence.
 */
export interface DelegationSession {
  /** Stable session id. */
  id: string;
  /** Delegated agent's machine identity id. */
  agentId: string;
  /** Principal that granted the delegation. */
  subjectId: string;
  /** Policy envelope captured at open time. */
  policy: DelegationPolicy;
  /** Unix ms when the opening attestation was recorded. */
  attestedAt: number;
  /** Opening quote — used for drift comparison. */
  attestedQuote: TeeQuote;
  /** Unix ms when the session expires regardless of revocation. */
  expiresAt: number;
  /** Revocation record, populated when revoked. */
  revoked?: RevocationRecord;
}

/** Internal spend entry — kept outside DelegationSession for stability. */
interface SpendEntry {
  sessionId: string;
  /** Unix ms the operation was authorised. */
  at: number;
  /** USD value (non-negative). */
  amountUsd: number;
}

/** Opts for opening a session. */
export interface OpenSessionOpts {
  /** Agent requesting delegation. */
  agentId: string;
  /** Principal granting delegation. */
  subjectId: string;
  /** Policy envelope. */
  policy: DelegationPolicy;
  /** Attestation bundle presented at open time. */
  attested: AttestedAgent;
  /** Nonce the verifier issued at challenge time. */
  expectedNonce: `0x${string}`;
}

/** Opts for authorising a single operation inside a session. */
export interface AuthorizeOperationOpts {
  sessionId: string;
  chainId: number;
  to: `0x${string}`;
  selector: `0x${string}`;
  /** Estimated USD value the operation will spend. */
  estimatedUsd: number;
  /**
   * Fresh attestation, required when `policy.attestationPerCall === true`.
   *
   * Ignored when per-call attestation is not configured (the opening
   * attestation governs).
   */
  currentAttestation?: AttestedAgent;
  /**
   * Nonce to verify the `currentAttestation` against.
   *
   * Required whenever `currentAttestation` is provided. Tests can override
   * with the same nonce the session was opened with; production systems
   * MUST rotate nonces per challenge.
   */
  expectedNonce?: `0x${string}`;
}

/** Structured result for a successful open. */
export interface OpenSessionSuccess {
  sessionId: string;
  expiresAt: number;
}

/** Structured result for a failed open. */
export interface OpenSessionFailure {
  error: string;
}

/** Union return for {@link AgentDelegationManager.openSession}. */
export type OpenSessionResult = OpenSessionSuccess | OpenSessionFailure;

/** Authorised operation — callers may proceed. */
export interface AuthorizationAccepted {
  authorized: true;
}

/** Rejected operation — `reason` is a stable machine-readable string. */
export interface AuthorizationRejected {
  authorized: false;
  reason: string;
}

/** Union return for {@link AgentDelegationManager.authorizeOperation}. */
export type AuthorizeOperationResult =
  | AuthorizationAccepted
  | AuthorizationRejected;

/**
 * Manages TEE-attested delegation sessions.
 *
 * Thread-safety: single-threaded — suitable for wallet-service worker
 * contexts. Multi-threaded hosts MUST put a lock around the manager.
 *
 * @example
 * ```ts
 * const verifier = new AttestationVerifier({ allowedPlatforms: ["aws-nitro"] });
 * const manager = new AgentDelegationManager(verifier);
 * const opened = await manager.openSession({ agentId, subjectId, policy, attested, expectedNonce });
 * if ("error" in opened) throw new Error(opened.error);
 * const authz = await manager.authorizeOperation({ sessionId: opened.sessionId, ... });
 * ```
 */
export class AgentDelegationManager {
  private readonly verifier: AttestationVerifier;
  private readonly sessions = new Map<string, DelegationSession>();
  private readonly spend: SpendEntry[] = [];
  private readonly now: () => number;
  /** Monotonically increasing counter used in test-safe session ids. */
  private sessionCounter = 0;

  constructor(verifier: AttestationVerifier, options?: { now?: () => number }) {
    this.verifier = verifier;
    this.now = options?.now ?? (() => Date.now());
  }

  /**
   * Open a delegation session after verifying the presented attestation.
   *
   * Session expiry is computed as `attestedAt + policy.windowMs` so
   * attestations shorter than the policy window do not extend delegation
   * beyond the operator's intent. The attestation must pass structural
   * verification; when it fails, the returned failure carries the
   * verifier's error detail verbatim so callers can log it.
   *
   * @returns `{ sessionId, expiresAt }` on success, `{ error }` on failure.
   */
  async openSession(opts: OpenSessionOpts): Promise<OpenSessionResult> {
    if (opts.attested.agentId !== opts.agentId) {
      return {
        error: `attested.agentId "${opts.attested.agentId}" does not match opts.agentId "${opts.agentId}".`,
      };
    }
    if (!Number.isFinite(opts.policy.maxSpendUsd) || opts.policy.maxSpendUsd < 0) {
      return { error: "policy.maxSpendUsd must be a non-negative finite number." };
    }
    if (!Number.isFinite(opts.policy.windowMs) || opts.policy.windowMs <= 0) {
      return { error: "policy.windowMs must be a positive finite number." };
    }

    const verification = await this.verifier.verifyQuote(
      opts.attested,
      opts.expectedNonce,
    );
    if (!verification.valid) {
      return {
        error: `attestation rejected: ${verification.errorCode ?? "unknown"} — ${verification.errorDetail ?? "no detail"}`,
      };
    }

    const attestedAt = opts.attested.quote.generatedAt;
    const expiresAt = attestedAt + opts.policy.windowMs;

    const sessionId = this.generateSessionId();
    const session: DelegationSession = {
      id: sessionId,
      agentId: opts.agentId,
      subjectId: opts.subjectId,
      policy: opts.policy,
      attestedAt,
      attestedQuote: opts.attested.quote,
      expiresAt,
    };
    this.sessions.set(sessionId, session);

    return { sessionId, expiresAt };
  }

  /**
   * Authorise a single delegated operation.
   *
   * Check order (short-circuits at first failure so audit logs surface the
   * most specific reason):
   *   1. Session exists, is not revoked, and has not expired.
   *   2. The `(chainId, to, selector)` triple matches an entry in
   *      `policy.allowedCalls`.
   *   3. Spend over `policy.windowMs` + `estimatedUsd` does not exceed
   *      `policy.maxSpendUsd`.
   *   4. If `policy.attestationPerCall`, a fresh `currentAttestation` must be
   *      present, pass structural verification, be no older than
   *      `policy.maxAttestationAgeMs`, and match the session's opening
   *      code hash (constant-time). Measurement drift triggers auto-revoke
   *      when `policy.autoRevokeOnDrift === true`.
   */
  async authorizeOperation(
    opts: AuthorizeOperationOpts,
  ): Promise<AuthorizeOperationResult> {
    const session = this.sessions.get(opts.sessionId);
    if (!session) {
      return { authorized: false, reason: "session-not-found" };
    }
    if (session.revoked) {
      return {
        authorized: false,
        reason: `session-revoked: ${session.revoked.reason}`,
      };
    }
    const now = this.now();
    if (now >= session.expiresAt) {
      return { authorized: false, reason: "session-expired" };
    }

    if (!this.isCallAllowed(session.policy, opts)) {
      return { authorized: false, reason: "call-not-allowed" };
    }

    if (!Number.isFinite(opts.estimatedUsd) || opts.estimatedUsd < 0) {
      return {
        authorized: false,
        reason: "estimatedUsd-invalid",
      };
    }

    const windowStart = now - session.policy.windowMs;
    const spentInWindow = this.spend
      .filter(
        (entry) => entry.sessionId === session.id && entry.at > windowStart,
      )
      .reduce((sum, entry) => sum + entry.amountUsd, 0);

    if (spentInWindow + opts.estimatedUsd > session.policy.maxSpendUsd) {
      return {
        authorized: false,
        reason: `spend-cap-exceeded: would total ${spentInWindow + opts.estimatedUsd} over cap ${session.policy.maxSpendUsd}`,
      };
    }

    if (session.policy.attestationPerCall) {
      const perCallCheck = await this.checkPerCallAttestation(session, opts);
      if (!perCallCheck.ok) {
        return { authorized: false, reason: perCallCheck.reason };
      }
    }

    // Record spend AFTER all checks pass — callers that want to hold an
    // authorised quote without committing spend can call `revoke` before
    // the window ticks to undo, but that flow is intentionally unsupported
    // here because it invites double-spend.
    this.spend.push({
      sessionId: session.id,
      at: now,
      amountUsd: opts.estimatedUsd,
    });

    return { authorized: true };
  }

  /**
   * Revoke a session.
   *
   * Idempotent: revoking an already-revoked session is a no-op (the
   * original revocation record is preserved). Unknown session ids throw a
   * {@link DelegationError}.
   *
   * @throws {DelegationError} When `sessionId` is unknown.
   */
  async revoke(
    sessionId: string,
    reason: RevocationReason,
    actor: string,
    detail?: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new DelegationError(
        "session-not-found",
        `No session with id ${sessionId}.`,
      );
    }
    if (session.revoked) return;
    session.revoked = {
      agentId: session.agentId,
      reason,
      at: this.now(),
      actor,
      detail,
    };
  }

  /**
   * List sessions with optional filtering.
   *
   * @param agentId         When provided, filter to sessions for this agent.
   * @param includeRevoked  When true, include revoked sessions; defaults to
   *                        false.
   */
  listSessions(
    agentId?: string,
    includeRevoked?: boolean,
  ): DelegationSession[] {
    const wantRevoked = includeRevoked === true;
    return Array.from(this.sessions.values()).filter((session) => {
      if (!wantRevoked && session.revoked) return false;
      if (agentId !== undefined && session.agentId !== agentId) return false;
      return true;
    });
  }

  /** Look up a single session, or `null` when unknown. */
  getSession(sessionId: string): DelegationSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /**
   * Test helper: introspect recorded spend entries. Not part of the
   * production surface — production storage should pull from a
   * dedicated adapter. Kept package-scoped via the underscore prefix so
   * linters flag unintended callers.
   *
   * @internal
   */
  _snapshotSpend(): ReadonlyArray<SpendEntry> {
    return this.spend.slice();
  }

  /** Deterministic, collision-resistant-ish session id. */
  private generateSessionId(): string {
    this.sessionCounter += 1;
    const randomBytes =
      typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"
        ? crypto.getRandomValues(new Uint8Array(6))
        : new Uint8Array(6);
    const randomHex = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `dlg-${this.sessionCounter}-${randomHex}`;
  }

  private isCallAllowed(
    policy: DelegationPolicy,
    opts: AuthorizeOperationOpts,
  ): boolean {
    const lowerTo = opts.to.toLowerCase();
    const lowerSelector = opts.selector.toLowerCase();
    return policy.allowedCalls.some(
      (entry) =>
        entry.chainId === opts.chainId &&
        entry.contractAddress.toLowerCase() === lowerTo &&
        entry.selector.toLowerCase() === lowerSelector,
    );
  }

  private async checkPerCallAttestation(
    session: DelegationSession,
    opts: AuthorizeOperationOpts,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!opts.currentAttestation) {
      return { ok: false, reason: "attestation-required" };
    }
    if (!opts.expectedNonce) {
      return {
        ok: false,
        reason: "attestation-required: expectedNonce missing",
      };
    }

    const result = await this.verifier.verifyQuote(
      opts.currentAttestation,
      opts.expectedNonce,
    );
    if (!result.valid) {
      return {
        ok: false,
        reason: `attestation-invalid: ${result.errorCode ?? "unknown"}`,
      };
    }

    const now = this.now();
    const attestationAge = now - opts.currentAttestation.quote.generatedAt;
    if (attestationAge > session.policy.maxAttestationAgeMs) {
      return { ok: false, reason: "attestation-stale" };
    }

    const sessionCodeHash = session.attestedQuote.measurements.codeHash;
    const currentCodeHash = opts.currentAttestation.quote.measurements.codeHash;
    if (!constantTimeHexEqual(sessionCodeHash, currentCodeHash)) {
      if (session.policy.autoRevokeOnDrift) {
        session.revoked = {
          agentId: session.agentId,
          reason: "model-drift-detected",
          at: now,
          actor: "system",
          detail: `codeHash drift: session=${sessionCodeHash} current=${currentCodeHash}`,
        };
      }
      return { ok: false, reason: "measurement-drift" };
    }

    return { ok: true };
  }
}
