/**
 * Inpage ↔ content-script ↔ background handshake primitives.
 *
 * These helpers establish an ephemeral shared secret between the page's
 * injected provider (`inpage.ts`) and the extension service worker
 * (`background.ts`). Every subsequent bridge message carries an
 * HMAC-SHA-256 signature bound to the shared key, the session id, and
 * the correlation id — a hostile page script (or a racing extension)
 * cannot forge these without knowing the shared secret.
 *
 * Key design choices
 * ──────────────────
 *  - **ECDH-P256** for the key exchange. Native to `crypto.subtle` in
 *    every context that matters (page main world, content script, MV3
 *    service worker) without pulling in a module loader — the inpage
 *    script runs as a classic `<script>` tag with no `import.meta`.
 *  - **HKDF-SHA-256** to derive the HMAC key from the raw ECDH secret.
 *    Prevents trivial key-collision attacks against weak P-256 shared
 *    bits and lets us domain-separate the HMAC key from any other key
 *    we might derive later from the same exchange.
 *  - **AES-GCM** to seal the session-id token the background mints for
 *    the page. The inpage unseals on receipt and uses the plaintext as
 *    the `sessionId` field in every signed message. A hostile script
 *    that eavesdrops on the handshake sees only opaque ciphertext.
 *  - **SubtleCrypto only**. No `@noble/*` or other module imports — the
 *    inpage context cannot load them.
 *
 * Threat model
 * ────────────
 *  - Defeats **in-page message forgery**: a random dApp script cannot
 *    produce valid signatures for arbitrary bridge messages because it
 *    does not know the shared HMAC key.
 *  - Defeats **replay across correlation ids**: every signature is
 *    bound to a unique correlationId. Reusing an old signed message
 *    with a different correlationId fails HMAC verification.
 *  - Does NOT defeat a page script that races `inpage.js` and steals
 *    the freshly-injected provider reference — that is the job of the
 *    content-script integrity hash check.
 *  - Does NOT defeat a malicious browser extension that can read the
 *    Aethelred extension's memory. That is a sandbox-escape scenario
 *    outside this component's scope.
 *
 * All exported functions are `async` and return a Promise — callers
 * must `await` them. No exported function throws on a well-formed
 * input; every failure path routes through the typed Result shape or
 * the HMAC comparison returning `false`.
 */

/** Algorithm parameters pinned for the lifetime of a session. */
const ECDH_CURVE: EcKeyGenParams = { name: "ECDH", namedCurve: "P-256" };
const HKDF_HASH = "SHA-256" as const;
const HMAC_PARAMS: HmacKeyGenParams = { name: "HMAC", hash: "SHA-256" };
const AES_PARAMS: AesKeyGenParams = { name: "AES-GCM", length: 256 };

/**
 * Domain-separation info string fed into HKDF when deriving the HMAC
 * signing key. Changing this string invalidates every legacy session
 * immediately, which is the desired behaviour for protocol upgrades.
 */
export const HMAC_DERIVATION_INFO = "aethelred-inpage-hmac-v1";

/**
 * Domain-separation info string for the AES-GCM session-seal key.
 * Separated from the HMAC info so a key-leakage bug in one track
 * cannot turn into a forgery primitive on the other.
 */
export const AES_DERIVATION_INFO = "aethelred-inpage-seal-v1";

/** Byte length of the session id minted by the background. */
export const SESSION_ID_BYTES = 16;

/** Byte length of the HKDF salt — 32 bytes matches SHA-256 output. */
export const HKDF_SALT_BYTES = 32;

/**
 * Shape returned by {@link generateEphemeralKeyPair}. The `publicJwk`
 * field is what we post over the bridge — JWK is the only structured
 * form both ends can round-trip with `crypto.subtle.importKey` without
 * a DER parser.
 */
export interface EphemeralKeyPair {
  /** Non-extractable private key — used locally to derive secrets. */
  privateKey: CryptoKey;
  /** Public key exported as JWK for transport. */
  publicJwk: JsonWebKey;
}

/**
 * Opaque holder for the derived HMAC key plus the AES-GCM seal key.
 * Produced by {@link deriveHandshakeKeys} once both sides have each
 * other's public key. We expose the keys as `CryptoKey` so callers
 * cannot accidentally print the raw bytes to a console log.
 */
export interface HandshakeKeys {
  hmacKey: CryptoKey;
  sealKey: CryptoKey;
}

/**
 * Copy a byte view into a fresh `Uint8Array<ArrayBuffer>` so it is
 * directly usable as a `BufferSource` with `crypto.subtle`. The newer
 * DOM typings are strict about `ArrayBufferLike` vs `ArrayBuffer` — a
 * plain `TextEncoder.encode(...)` output is technically
 * `ArrayBufferLike` because it could be backed by `SharedArrayBuffer`
 * under some host configurations.
 */
function toBufferSource(bytes: ArrayLike<number>): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes as ArrayLike<number>);
  return out;
}

/** Random-bytes helper that always returns the strict BufferSource shape. */
function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(out);
  return out;
}

/** UTF-8 encode a string into the strict BufferSource shape. */
function utf8(input: string): Uint8Array<ArrayBuffer> {
  return toBufferSource(new TextEncoder().encode(input));
}

/**
 * Generate a fresh ephemeral P-256 ECDH key pair.
 *
 * The private key is non-extractable — even if a hostile extension
 * somehow acquired our `CryptoKey` reference it could not export the
 * underlying bytes. The public key is exported as JWK so the peer can
 * import it with `crypto.subtle.importKey("jwk", …)`.
 */
export async function generateEphemeralKeyPair(): Promise<EphemeralKeyPair> {
  const pair = await crypto.subtle.generateKey(
    ECDH_CURVE,
    false,
    ["deriveKey", "deriveBits"],
  ) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk };
}

/**
 * Import a peer's public key (JWK) into a `CryptoKey` suitable for
 * ECDH key agreement.
 */
async function importPeerPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    ECDH_CURVE,
    true,
    [],
  );
}

/**
 * Derive the HMAC + AES seal keys from our private key and the peer's
 * public JWK. Both sides call this with their own private key and the
 * other side's public key — the P-256 shared bits are identical on both
 * sides, so the derived HMAC key matches.
 *
 * @param ownPrivate - our ephemeral private key.
 * @param peerJwk - peer's public key as JWK.
 * @param salt - HKDF salt; MUST be the same on both sides. The
 *   background mints it and includes it in the handshake-ack so both
 *   participants derive from the same salt without a second round-trip.
 */
export async function deriveHandshakeKeys(
  ownPrivate: CryptoKey,
  peerJwk: JsonWebKey,
  salt: ArrayLike<number>,
): Promise<HandshakeKeys> {
  const peerKey = await importPeerPublicKey(peerJwk);
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerKey },
    ownPrivate,
    256,
  );
  // Import the raw shared bits so we can run HKDF over them twice (one
  // pass per domain string).
  const sharedKey = await crypto.subtle.importKey(
    "raw",
    sharedBits,
    "HKDF",
    false,
    ["deriveKey"],
  );
  const saltBuf = toBufferSource(salt);
  const hmacKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: HKDF_HASH,
      salt: saltBuf,
      info: utf8(HMAC_DERIVATION_INFO),
    },
    sharedKey,
    HMAC_PARAMS,
    false,
    ["sign", "verify"],
  );
  const sealKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: HKDF_HASH,
      salt: saltBuf,
      info: utf8(AES_DERIVATION_INFO),
    },
    sharedKey,
    AES_PARAMS,
    false,
    ["encrypt", "decrypt"],
  );
  return { hmacKey, sealKey };
}

/**
 * Convenience alias for `deriveHandshakeKeys(...).then(k => k.hmacKey)`.
 * Unit tests lean on the HMAC key directly and this keeps their call
 * sites short.
 */
export async function deriveHmacKey(
  ownPrivate: CryptoKey,
  peerJwk: JsonWebKey,
  salt: ArrayLike<number>,
): Promise<CryptoKey> {
  const keys = await deriveHandshakeKeys(ownPrivate, peerJwk, salt);
  return keys.hmacKey;
}

/**
 * Canonical string form of a signed message, fed into HMAC-SHA-256.
 *
 * Format: `kind|sessionId|correlationId|payloadJson`. We stringify the
 * payload with `JSON.stringify` so the signer and verifier see the same
 * bytes — any caller that mutates the payload between sign and verify
 * will see a mismatch, which is exactly the defence we want.
 */
function canonicalSigningInput(
  kind: string,
  sessionId: string,
  correlationId: string,
  payload: unknown,
): Uint8Array<ArrayBuffer> {
  const payloadStr = JSON.stringify(payload ?? null);
  const joined = `${kind}|${sessionId}|${correlationId}|${payloadStr}`;
  return utf8(joined);
}

/** Bytes → lowercase hex, used for both HMAC signatures and salts. */
function bytesToHex(bytes: ArrayLike<number>): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/** Lowercase hex → bytes. Accepts `0x` prefix or no prefix. */
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (stripped.length % 2 !== 0) {
    throw new Error("hex string must have even length");
  }
  const out = new Uint8Array(new ArrayBuffer(stripped.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Payload shape for a signed bridge message. Every field except the
 * signature itself goes into the HMAC input, which is why we keep this
 * type narrow and canonical.
 */
export interface SignedPayload {
  kind: string;
  sessionId: string;
  correlationId: string;
  payload: unknown;
}

/**
 * Compute a hex-encoded HMAC-SHA-256 signature over a signed payload.
 *
 * The canonical form binds the signature to:
 *   - `kind`: the BridgeMessageKind, prevents signature reuse across
 *     message types.
 *   - `sessionId`: the opaque token minted by the background, scopes
 *     the signature to this tab's handshake session.
 *   - `correlationId`: the per-request nonce, defeats replay attacks.
 *   - `payload`: the JSON payload bytes, defeats in-flight tampering.
 */
export async function signMessage(
  hmacKey: CryptoKey,
  input: SignedPayload,
): Promise<string> {
  const bytes = canonicalSigningInput(
    input.kind,
    input.sessionId,
    input.correlationId,
    input.payload,
  );
  const sig = await crypto.subtle.sign("HMAC", hmacKey, bytes);
  return bytesToHex(new Uint8Array(sig));
}

/**
 * Constant-time-ish verification of a signature produced by
 * {@link signMessage}. `crypto.subtle.verify` already does the timing-
 * safe comparison internally, so this wrapper just reconstructs the
 * canonical input and delegates.
 *
 * Returns `true` iff the signature was produced by the same HMAC key
 * over an identical canonical form. Any tampering — wrong sessionId,
 * wrong correlationId, mutated payload, rebuilt kind — causes `false`.
 */
export async function verifyMessage(
  hmacKey: CryptoKey,
  input: SignedPayload,
  signatureHex: string,
): Promise<boolean> {
  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = hexToBytes(signatureHex);
  } catch {
    return false;
  }
  const bytes = canonicalSigningInput(
    input.kind,
    input.sessionId,
    input.correlationId,
    input.payload,
  );
  try {
    return await crypto.subtle.verify("HMAC", hmacKey, sigBytes, bytes);
  } catch {
    return false;
  }
}

/**
 * Seal a session-id token with AES-GCM. Returns the IV + ciphertext
 * concatenated (12 bytes IV, then GCM-encrypted bytes including the
 * 16-byte auth tag). The caller ships the resulting bytes as hex
 * over the bridge; the peer unseals with {@link unsealSessionId}.
 *
 * We stamp the session id into AES-GCM rather than sending it plain
 * so a third-party on the page cannot eavesdrop on it — only the peer
 * that completed the ECDH exchange holds the `sealKey`.
 */
export async function sealSessionId(
  sealKey: CryptoKey,
  sessionId: ArrayLike<number>,
): Promise<string> {
  const iv = randomBytes(12);
  const pt = toBufferSource(sessionId);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sealKey,
    pt,
  );
  const ctBytes = new Uint8Array(ct);
  const out = new Uint8Array(new ArrayBuffer(iv.length + ctBytes.length));
  out.set(iv, 0);
  out.set(ctBytes, iv.length);
  return bytesToHex(out);
}

/**
 * Unseal a session-id previously produced by {@link sealSessionId}.
 * Returns the plaintext session id bytes. Throws if the ciphertext is
 * malformed or the GCM tag doesn't verify — both indicate tampering.
 */
export async function unsealSessionId(
  sealKey: CryptoKey,
  sealedHex: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const sealed = hexToBytes(sealedHex);
  if (sealed.length < 12 + 16) {
    throw new Error("sealed session id is too short");
  }
  const iv = toBufferSource(sealed.slice(0, 12));
  const ct = toBufferSource(sealed.slice(12));
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    sealKey,
    ct,
  );
  const ptBytes = new Uint8Array(pt);
  return toBufferSource(ptBytes);
}

/**
 * Generate a fresh salt for HKDF. Pure convenience — makes call sites
 * explicit about the intent (salt freshness = session isolation).
 */
export function generateSalt(): Uint8Array<ArrayBuffer> {
  return randomBytes(HKDF_SALT_BYTES);
}

/**
 * Generate a fresh random session id, hex-encoded as used on the
 * bridge. `SESSION_ID_BYTES * 2` hex chars of 128 bits of entropy is
 * ample to avoid collisions even across a browser with thousands of
 * open tabs.
 */
export function generateSessionId(): string {
  return bytesToHex(randomBytes(SESSION_ID_BYTES));
}

/**
 * Hex-encode arbitrary bytes. Re-exported so the extension contexts
 * can share the same encoder as the handshake helpers without pulling
 * in another module.
 */
export const toHex = bytesToHex;

/** Hex-decode arbitrary bytes. Mirror of {@link toHex}. */
export const fromHex = hexToBytes;

/**
 * Payload for `handshake-init` (inpage → content → background).
 *
 * The inpage script mints an ephemeral keypair, keeps the private key
 * in-memory, and sends the public JWK alongside a client nonce used
 * later to prove the handshake-ack is fresh.
 */
export interface HandshakeInitPayload {
  publicJwk: JsonWebKey;
  clientNonce: string;
  /** Handshake-protocol version — reserve room for future variants. */
  version: 1;
}

/**
 * Payload for `handshake-ack` (background → content → inpage).
 *
 * `saltHex`, `sealedSessionId`, and `publicJwk` together let the
 * inpage derive the same HMAC key and unseal the session id. The
 * `clientNonce` is echoed back so the inpage can reject stale acks.
 */
export interface HandshakeAckPayload {
  publicJwk: JsonWebKey;
  saltHex: string;
  sealedSessionId: string;
  clientNonce: string;
  version: 1;
}

/**
 * Envelope for any post-handshake signed message crossing the bridge.
 * Wraps the underlying payload with the fields the HMAC is computed
 * over, so the receiver can reconstruct the canonical signing input
 * without any out-of-band context.
 */
export interface SignedBridgeEnvelope<TPayload = unknown> {
  kind: string;
  sessionId: string;
  correlationId: string;
  payload: TPayload;
  hmac: string;
}
