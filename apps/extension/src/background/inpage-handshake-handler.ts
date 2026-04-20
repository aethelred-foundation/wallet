/**
 * Background-side handler for the inpage ↔ service-worker handshake.
 *
 * Lifecycle
 * ─────────
 *   1. Inpage posts `handshake-init` via the content bridge. The
 *      background receives it here.
 *   2. We mint an ephemeral P-256 keypair, derive the shared HMAC +
 *      AES-GCM seal keys, mint a fresh session id, seal it under the
 *      AES key, and reply with `handshake-ack`.
 *   3. The in-memory session map holds the HMAC key keyed by
 *      `(origin, sessionId)` so subsequent `rpc-request` envelopes
 *      can be verified.
 *
 * We deliberately keep one session per origin. A hostile second page
 * in the same tab (via an iframe navigation quirk) would present a
 * different origin and get its own session — there is never a single
 * shared HMAC key across origins.
 */

import {
  deriveHandshakeKeys,
  generateEphemeralKeyPair,
  generateSalt,
  generateSessionId,
  sealSessionId,
  toHex,
  fromHex,
  verifyMessage,
  type BridgeMessage,
  type HandshakeInitPayload,
  type HandshakeAckPayload,
  type SignedBridgeEnvelope,
} from "@aethelred/wallet-connect";

/** Shape stored for every active inpage session. */
export interface InpageSession {
  /** HMAC-SHA-256 key, reused to verify every subsequent rpc-request. */
  hmacKey: CryptoKey;
  /** Session id as sent to the inpage (hex). */
  sessionId: string;
  /** Hex-encoded HKDF salt (useful for diagnostics + rotation). */
  saltHex: string;
  /** Unix millis when this session was minted — drives GC. */
  mintedAt: number;
  /** Origin the session is bound to. */
  origin: string;
}

/** Map from `sessionId` → session state. Module-scoped singleton. */
const sessions = new Map<string, InpageSession>();

/**
 * Maximum age before an unused session is purged. 24 h is more than
 * any reasonable page lifetime and is far below the policy-bundle
 * defaults for audit retention, so this never sits in the critical
 * path of any enforcement decision.
 */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * GC entry point — call occasionally (e.g. on every new handshake) to
 * evict expired sessions. Uses a hand-rolled scan rather than a
 * `setInterval` because MV3 service workers evict `setInterval` timers
 * whenever the worker sleeps.
 */
function evictExpired(now: number): void {
  for (const [id, s] of sessions.entries()) {
    if (now - s.mintedAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

/**
 * Reset all session state. Test-only — not exposed on the default
 * import path to avoid accidental misuse.
 */
export function __resetInpageSessionsForTests(): void {
  sessions.clear();
}

/**
 * Read-only accessor for the session map, exposed for assertion-style
 * tests. Returns a shallow clone so mutation is caught at review time.
 */
export function __snapshotInpageSessionsForTests(): Map<string, InpageSession> {
  return new Map(sessions);
}

/**
 * Handle a `handshake-init` message. Returns the `handshake-ack`
 * message the caller should send back over the bridge.
 *
 * @param message - the incoming handshake-init bridge message.
 * @param origin - the origin the content script recorded for the page.
 */
export async function handleInpageHandshakeInit(
  message: BridgeMessage,
  origin: string,
): Promise<BridgeMessage> {
  const initPayload = message.payload as HandshakeInitPayload;
  evictExpired(Date.now());

  const ours = await generateEphemeralKeyPair();
  const salt = generateSalt();
  const keys = await deriveHandshakeKeys(
    ours.privateKey,
    initPayload.publicJwk,
    salt,
  );
  const sessionId = generateSessionId();
  const sealedSessionId = await sealSessionId(
    keys.sealKey,
    fromHex(sessionId),
  );

  sessions.set(sessionId, {
    hmacKey: keys.hmacKey,
    sessionId,
    saltHex: toHex(salt),
    mintedAt: Date.now(),
    origin,
  });

  const ackPayload: HandshakeAckPayload = {
    publicJwk: ours.publicJwk,
    saltHex: toHex(salt),
    sealedSessionId,
    clientNonce: initPayload.clientNonce,
    version: 1,
  };

  return {
    kind: "handshake-ack",
    correlationId: message.correlationId,
    payload: ackPayload,
    timestamp: Date.now(),
  };
}

/**
 * Verify a signed `rpc-request` envelope. Returns `{ ok: true }` iff
 * the HMAC matches the session key bound to the claimed sessionId AND
 * the origin matches. Otherwise returns `{ ok: false, reason }`
 * suitable for logging to the audit chain.
 *
 * Callers should refuse the request entirely on `ok: false`.
 */
export async function verifyInpageRpcRequest(
  message: BridgeMessage,
  origin: string,
): Promise<
  | { ok: true; session: InpageSession }
  | { ok: false; reason: string }
> {
  const envelope = message.payload as Partial<SignedBridgeEnvelope> & {
    method?: string;
    params?: unknown;
  };
  const sessionId = envelope.sessionId;
  const hmac = envelope.hmac;

  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { ok: false, reason: "missing-session-id" };
  }
  if (typeof hmac !== "string" || hmac.length === 0) {
    return { ok: false, reason: "missing-hmac" };
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, reason: "unknown-session" };
  }
  if (session.origin !== origin) {
    return { ok: false, reason: "origin-mismatch" };
  }

  // The HMAC was computed over the inpage's original `{method, params}`
  // payload (without the `sessionId` + `hmac` wrappers). Reconstruct
  // that payload shape here.
  const rebuiltPayload = {
    method: envelope.method,
    params: envelope.params,
  };

  const verified = await verifyMessage(
    session.hmacKey,
    {
      kind: message.kind,
      sessionId,
      correlationId: message.correlationId,
      payload: rebuiltPayload,
    },
    hmac,
  );

  if (!verified) {
    return { ok: false, reason: "hmac-mismatch" };
  }

  return { ok: true, session };
}
