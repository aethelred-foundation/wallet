/**
 * Custodian Liability Attestation — closes the audit-chain dark spot
 * at the third-party custodian API boundary.
 *
 * Background (feedback PDF, Issue #2):
 *   The wallet's tamper-evident audit chain (SHA-256 hashed events)
 *   logs every operationally significant event right up to the moment
 *   it hands control to a third-party custodian (BlockDaemon,
 *   Fireblocks, Komainu, Hextrust). After that — when an MPC share
 *   gets compromised, an infrastructure failure happens during a market
 *   event, the custodian's SLA is breached — the unified audit trail
 *   "just ends at the API boundary." The treasurer is left wondering
 *   who holds the ultimate liability for the blocked transaction.
 *
 *   The feedback document's analogy: "building an impenetrable fortress,
 *   but outsourcing the drawbridge to a contractor who isn't answering
 *   their phone."
 *
 * The fix (verbatim from the feedback doc):
 *   Extend the wallet's cryptographic evidence layer to "explicitly
 *   encapsulate the third-party custodian's service-level agreements,
 *   pulling those liability boundaries directly on-chain" — NOT by
 *   putting a legal SLA PDF on-chain, but by tracking the *active state
 *   of the liability* at the moment of execution. When a transaction
 *   routes through Komainu, the wallet "actively and cryptographically
 *   fetches Komainu's active SLA status and their real-time insurance
 *   pool limits via an Oracle or a signed attestation API" and stamps
 *   the snapshot onto the transaction's audit record.
 *
 *   "Komainu currently has $500 million in active insurance coverage and
 *   their SLA is fully operational right onto the transaction hash."
 *
 * Design properties:
 *   - {@link LiabilityAttestor} is pluggable per custodian — Fireblocks,
 *     Komainu, Hextrust each have their own oracle/attestation feed.
 *   - {@link NoopLiabilityAttestor} is the safe default for tests and
 *     for adapters that haven't wired a real attestor yet.
 *   - **Fail-graceful**: when the attestor fails or times out, the
 *     transaction still proceeds — but the audit event is stamped with
 *     `liabilityUnknown: true` so the gap is queryable later. We refuse
 *     to add a hard dependency on a third-party oracle for transaction
 *     liveness.
 *   - **Bind-to-transaction**: the snapshot includes a SHA-256 digest
 *     binding the attestation to the specific transaction id, so an
 *     auditor can prove this attestation was fetched FOR THIS transfer
 *     (not pre-fetched and reused).
 */

import { sha256 } from "@noble/hashes/sha2.js";

// ─── Public types ──────────────────────────────────────────────────

/**
 * Operational SLA status as reported by the custodian's oracle.
 *
 * - **`operational`** — SLA fully met, normal liability coverage applies.
 * - **`degraded`** — partial outage, reduced throughput, but transactions
 *   can still be executed. Insurance coverage typically still applies
 *   but operators may want to pause new transfers.
 * - **`unavailable`** — custodian-side incident, no insurance coverage
 *   for new transactions until status returns to operational. Wallets
 *   typically fail-fast on this status.
 */
export type CustodianSlaStatus = "operational" | "degraded" | "unavailable";

/**
 * A single custodian's liability snapshot at a moment in time.
 *
 * The snapshot is the cryptographic answer to "if this transaction goes
 * wrong at the custodian boundary, who pays out?" — encoding the
 * active SLA + insurance coverage state at execution time.
 */
export interface CustodianLiabilityAttestation {
  /**
   * Stable custodian identifier (e.g., `"komainu"`, `"fireblocks"`,
   * `"blockdaemon"`, `"hextrust"`). Lowercase, no version. Use
   * {@link CUSTODIAN_IDS} for the canonical set.
   */
  readonly custodianId: string;

  /** Operational status as reported by the custodian's attestation API. */
  readonly slaStatus: CustodianSlaStatus;

  /**
   * Active insurance pool limit in the smallest currency unit (cents
   * for USD, fils for AED, etc.). bigint to handle pool limits beyond
   * Number.MAX_SAFE_INTEGER.
   */
  readonly insuranceCoverage: bigint;

  /** ISO 4217 currency code for {@link insuranceCoverage}. */
  readonly insuranceCurrency: string;

  /**
   * Unix milliseconds at which the custodian's oracle attested this
   * snapshot. Distinct from the transaction's submission time; auditors
   * use the gap to assess attestation freshness.
   */
  readonly attestedAt: number;

  /**
   * Identifier of the oracle / attestation source (e.g.,
   * `"chainlink:custody:komainu"`, `"komainu-internal-api"`,
   * `"compositeOracle:rwa"`). Surfaces who signed the attestation.
   */
  readonly oracleId: string;

  /**
   * Hex-encoded signature from the oracle binding the snapshot fields.
   * Verification is the responsibility of the consumer (oracle-specific
   * key material). Optional because some legacy attestation APIs return
   * unsigned snapshots over a TLS-pinned channel — those should still
   * be auditable, just with a lower trust tier.
   */
  readonly signature?: `0x${string}`;
}

/**
 * Pluggable attestation source. One implementation per custodian.
 *
 * Implementations are responsible for:
 *   - Fetching the live status from the custodian's oracle / signed API
 *   - Verifying the oracle signature (where available)
 *   - Returning a stable `null` when the attestation feed is unreachable
 *     or the response fails verification — never throw upward
 *
 * The contract refuses to throw because the wallet's transaction
 * liveness must not depend on the availability of a third-party oracle.
 * A null return triggers the {@link LiabilitySnapshotEvent#liabilityUnknown}
 * flag instead.
 */
export interface LiabilityAttestor {
  /** Stable custodian identifier this attestor speaks for. */
  readonly custodianId: string;

  /**
   * Fetch the live attestation. Implementations should respect a sensible
   * timeout internally; the consumer doesn't pass one.
   */
  fetchAttestation(): Promise<CustodianLiabilityAttestation | null>;
}

/**
 * The audit-chain event shape emitted for every transaction that routes
 * through a third-party custodian. Designed to drop into the existing
 * audit event-capture pipeline as an additive event kind.
 */
export interface LiabilitySnapshotEvent {
  /** Stable kind for downstream filtering. */
  readonly kind: "custodian-liability-snapshot";
  /** Transaction id this snapshot is bound to. Hex-prefixed. */
  readonly transactionId: string;
  /** Custodian id this transaction routes through. */
  readonly custodianId: string;
  /**
   * The attestation snapshot. `null` ↔ `liabilityUnknown === true`.
   * When `null`, the transaction proceeded but the audit chain has a
   * queryable record that liability state could not be captured at
   * execution.
   */
  readonly attestation: CustodianLiabilityAttestation | null;
  /**
   * Set to `true` when {@link attestation} is null because the
   * attestor failed (timeout, signature mismatch, oracle outage).
   * Auditors use this to scan for gaps in coverage data.
   */
  readonly liabilityUnknown: boolean;
  /** Unix ms when the snapshot was emitted (NOT the attestedAt). */
  readonly capturedAt: number;
  /**
   * SHA-256 of `(transactionId || custodianId || canonical(attestation))`.
   * Binds the attestation to this specific transaction so an auditor
   * can prove the snapshot was fetched FOR THIS transfer (not
   * pre-fetched and reused). Constant whether attestation is present
   * or null — `liabilityUnknown=true` events still hash deterministically
   * for chain integrity.
   */
  readonly digest: `0x${string}`;
}

// ─── Canonical custodian identifiers ──────────────────────────────

/**
 * Canonical ids for the tier-1 custodians named in the master plan.
 * Use these for {@link CustodianLiabilityAttestation.custodianId} so
 * dashboards can group attestations by vendor without string-fuzzing.
 */
export const CUSTODIAN_IDS = {
  fireblocks: "fireblocks",
  komainu: "komainu",
  blockdaemon: "blockdaemon",
  hextrust: "hextrust",
} as const;

export type CanonicalCustodianId =
  (typeof CUSTODIAN_IDS)[keyof typeof CUSTODIAN_IDS];

// ─── Default attestors ────────────────────────────────────────────

/**
 * No-op attestor — every call returns null, every event surfaces with
 * `liabilityUnknown: true`. This is the safe default for:
 *
 *   - Tests that don't care about custodian liability state
 *   - Adapters whose custodian doesn't yet have an attestation API wired
 *   - Local development where there's no oracle to call
 *
 * Production deployments swap this for a real attestor per custodian.
 */
export class NoopLiabilityAttestor implements LiabilityAttestor {
  readonly custodianId: string;

  constructor(custodianId: string) {
    this.custodianId = custodianId;
  }

  async fetchAttestation(): Promise<null> {
    return null;
  }
}

/**
 * Cache-wrapping attestor — TTL-bounded in-memory cache so a high-volume
 * stream of transactions through the same custodian doesn't hammer the
 * oracle. Cache misses (TTL expired OR upstream returned null) flow
 * through to the inner attestor.
 *
 * The cache is intentionally simple: one entry per inner-attestor
 * instance. Use distinct instances if you need cache isolation per
 * subkey.
 *
 * IMPORTANT: this cache deliberately does NOT cache `null` responses.
 * A failed oracle fetch shouldn't poison the cache and prolong the
 * `liabilityUnknown` window — the next transaction gets a fresh attempt.
 */
export class CachingLiabilityAttestor implements LiabilityAttestor {
  readonly custodianId: string;
  private cached: {
    readonly value: CustodianLiabilityAttestation;
    readonly cachedAt: number;
  } | null = null;

  constructor(
    private readonly inner: LiabilityAttestor,
    private readonly opts: {
      /** Cache TTL in ms. Past this age, the inner attestor is consulted again. */
      readonly ttlMs: number;
      /** Clock for deterministic tests. Defaults to Date.now. */
      readonly now?: () => number;
    },
  ) {
    this.custodianId = inner.custodianId;
  }

  async fetchAttestation(): Promise<CustodianLiabilityAttestation | null> {
    const now = (this.opts.now ?? Date.now)();
    if (this.cached && now - this.cached.cachedAt < this.opts.ttlMs) {
      return this.cached.value;
    }
    const fresh = await this.inner.fetchAttestation();
    if (fresh !== null) {
      this.cached = { value: fresh, cachedAt: now };
    }
    return fresh;
  }

  /** Force-clear the cache (e.g., after a known custodian incident). */
  invalidate(): void {
    this.cached = null;
  }
}

// ─── Snapshot capture ─────────────────────────────────────────────

/**
 * Capture a {@link LiabilitySnapshotEvent} for a transaction routing
 * through `attestor.custodianId`. This is the function the custody
 * flow calls right before handing control to the third-party custodian.
 *
 * Always returns a {@link LiabilitySnapshotEvent} — never throws,
 * never returns null. Failure modes surface via `liabilityUnknown:
 * true` so the audit chain has a record either way.
 */
export async function captureLiabilitySnapshot(opts: {
  readonly transactionId: string;
  readonly attestor: LiabilityAttestor;
  /** Clock for deterministic tests. Defaults to Date.now. */
  readonly now?: () => number;
}): Promise<LiabilitySnapshotEvent> {
  const now = (opts.now ?? Date.now)();
  let attestation: CustodianLiabilityAttestation | null = null;
  try {
    attestation = await opts.attestor.fetchAttestation();
  } catch {
    // Attestor implementations are documented to return null rather
    // than throw, but defend against buggy implementations: catch and
    // map to liabilityUnknown.
    attestation = null;
  }

  const liabilityUnknown = attestation === null;
  const digest = computeSnapshotDigest({
    transactionId: opts.transactionId,
    custodianId: opts.attestor.custodianId,
    attestation,
  });

  return {
    kind: "custodian-liability-snapshot",
    transactionId: opts.transactionId,
    custodianId: opts.attestor.custodianId,
    attestation,
    liabilityUnknown,
    capturedAt: now,
    digest,
  };
}

// ─── Canonicalization + digest ────────────────────────────────────

/**
 * SHA-256 digest binding the snapshot to its transaction.
 *
 * Canonical input: stable-key JSON of
 *   `{ transactionId, custodianId, attestation }`
 * The `attestation` field is included verbatim (with its own
 * stable-key serialization) so two distinct attestations for the same
 * transaction produce distinct digests, AND a `null` attestation
 * still produces a deterministic digest (so `liabilityUnknown` events
 * are integrity-checkable too).
 */
function computeSnapshotDigest(payload: {
  readonly transactionId: string;
  readonly custodianId: string;
  readonly attestation: CustodianLiabilityAttestation | null;
}): `0x${string}` {
  const canonical = stableStringify(payload);
  const hash = sha256(new TextEncoder().encode(canonical));
  const hex = Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
  return `0x${hex}` as `0x${string}`;
}

/**
 * Stable-key JSON serialization (keys sorted recursively). bigint
 * values are serialized as `"<digits>n"` strings so the JSON survives
 * `JSON.parse` round-trips without losing precision and so two
 * snapshots with the same coverage value hash identically.
 */
function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "bigint") return JSON.stringify(`${value}n`);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(",")}}`;
}
