/**
 * Session-key module.
 *
 * A **session key** is a freshly-generated secp256k1 keypair whose
 * spending authority is narrowly scoped by the on-chain AgentBudget
 * Session struct: (budgetId, perCallCap, expiresAt, revoked). The
 * session key itself is ephemeral — it lives in memory for the
 * session's lifetime, signs a bounded number of spend operations,
 * and is then disposed (zeroized).
 *
 * Why not reuse the parent agent's custody key?
 *
 *   - **Blast radius**. The parent key is high-value (Nitro-rooted,
 *     hardware-backed). We don't want to route every $0.01 API call
 *     through a TEE attestation round-trip.
 *   - **Revocation latency**. If a session key is compromised, the
 *     owner calls `revokeSession(sessionKey)` and the on-chain guard
 *     blocks further spends — even for UserOps already in the
 *     mempool. The parent key never has to rotate.
 *   - **Composability**. ERC-4337 / ERC-7715 session-key modules
 *     take exactly this shape — scoped, expiring, revocable. Our
 *     SessionKey plugs into those without translation.
 *
 * The module exposes two shapes of "session key":
 *
 *   - `LocalSessionKey` — an in-memory secp256k1 keypair. Implements
 *     `TypedDataSigner` so it plugs directly into x402, intent
 *     router, and any other part of the stack that consumes
 *     `@aethelred/wallet-custody-adapters` signers.
 *   - `SessionKeyRef` — a bare reference (address + budgetId +
 *     expiresAt) for callers that only need to query, not sign. The
 *     client's `canSpend` view takes this shape.
 *
 * Zeroization: `LocalSessionKey.dispose()` overwrites the private-
 * key bytes. JS GC may have already copied the bytes elsewhere; we
 * still do this as defense-in-depth and to surface a clear
 * `session-key-disposed` error on any subsequent sign attempt.
 */

import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3.js";

import {
  computeTypedDataDigest,
  type TypedDataRequest,
  type TypedDataSigner,
} from "@aethelred/wallet-custody-adapters";

import { AgentBudgetError } from "./errors";
import "./crypto-bootstrap";

// ─── Public shapes ─────────────────────────────────────────────

/** Bare reference to a session key without the private material. */
export interface SessionKeyRef {
  readonly address: `0x${string}`;
  readonly budgetId: bigint;
  readonly expiresAt: bigint;
  readonly perCallCap: bigint;
}

export interface SessionKeyMetadata {
  readonly budgetId: bigint;
  readonly expiresAt: bigint;
  readonly perCallCap: bigint;
}

// ─── LocalSessionKey ───────────────────────────────────────────

/**
 * An in-process secp256k1 keypair scoped to a budget session.
 *
 * Implements `TypedDataSigner` so every part of the stack that
 * consumes a signer (x402 client, intent router, MCP tools) works
 * unchanged with a session key in place of the parent custody
 * adapter.
 */
export class LocalSessionKey implements TypedDataSigner {
  readonly address: `0x${string}`;
  readonly metadata: SessionKeyMetadata;

  private privateKey: Uint8Array;
  private disposed = false;

  private constructor(privateKey: Uint8Array, address: `0x${string}`, metadata: SessionKeyMetadata) {
    this.privateKey = privateKey;
    this.address = address;
    this.metadata = metadata;
  }

  /**
   * Generate a fresh session key. Uses `crypto.getRandomValues` to
   * produce uniform-random entropy. The returned key is ready to
   * call `signTypedData`.
   *
   * `metadata` is what the caller will pass to the on-chain
   * `grantSession(budgetId, key.address, expiresAt, perCallCap)`.
   * The metadata is stored locally too so on-device UIs can show
   * "session expires in 42 minutes" without a chain round-trip.
   */
  static generate(metadata: SessionKeyMetadata): LocalSessionKey {
    const privateKey = new Uint8Array(32);
    crypto.getRandomValues(privateKey);
    // Reject the (vanishingly unlikely) case of sk == 0 or sk >= n.
    if (!secp256k1.utils.isValidPrivateKey(privateKey)) {
      return LocalSessionKey.generate(metadata);
    }
    const address = addressForPrivateKey(privateKey);
    return new LocalSessionKey(privateKey, address, metadata);
  }

  /**
   * Import an existing private key as a session key. Rarely needed —
   * the `generate` path is preferred. This exists for flows where
   * the parent has pre-computed a deterministic session key (HD
   * derivation path, enclave-sealed subkey).
   */
  static fromPrivateKey(
    privateKey: Uint8Array | `0x${string}`,
    metadata: SessionKeyMetadata,
  ): LocalSessionKey {
    const bytes =
      typeof privateKey === "string" ? hexToBytes(privateKey as `0x${string}`) : privateKey;
    if (bytes.length !== 32) {
      throw new AgentBudgetError(
        "session-key-invalid",
        `private key must be 32 bytes, got ${bytes.length}`,
      );
    }
    if (!secp256k1.utils.isValidPrivateKey(bytes)) {
      throw new AgentBudgetError("session-key-invalid", "not a valid secp256k1 private key");
    }
    const copy = new Uint8Array(32);
    copy.set(bytes);
    return new LocalSessionKey(copy, addressForPrivateKey(copy), metadata);
  }

  async signTypedData(req: TypedDataRequest): Promise<`0x${string}`> {
    this.ensureAlive();
    this.ensureFresh();
    const digest = computeTypedDataDigest(req);
    return this.signDigest(digest);
  }

  /**
   * Sign an arbitrary 32-byte digest. Used by callers that need a
   * raw signature (e.g. to authorise a userOp hash). Most callers
   * should prefer `signTypedData` — the scope of "what the session
   * can sign" is easier to audit when every signature starts from a
   * structured TypedDataRequest.
   */
  signDigest(digest: Uint8Array): `0x${string}` {
    this.ensureAlive();
    this.ensureFresh();
    if (digest.length !== 32) {
      throw new AgentBudgetError(
        "session-key-invalid",
        `signDigest expects 32-byte input, got ${digest.length}`,
      );
    }
    const sig = secp256k1.sign(digest, this.privateKey, { lowS: true });
    const rs = sig.toCompactRawBytes();
    const out = new Uint8Array(65);
    out.set(rs, 0);
    out[64] = 27 + (sig.recovery ?? 0);
    return bytesToHexPrefixed(out);
  }

  /** Bare reference without the private material. */
  toRef(): SessionKeyRef {
    this.ensureAlive();
    return {
      address: this.address,
      budgetId: this.metadata.budgetId,
      expiresAt: this.metadata.expiresAt,
      perCallCap: this.metadata.perCallCap,
    };
  }

  /** Expired = local-clock freshness check. NOT the on-chain check. */
  isExpired(nowMs: number = Date.now()): boolean {
    return BigInt(Math.floor(nowMs / 1000)) >= this.metadata.expiresAt;
  }

  /**
   * Zero the private-key bytes and mark the key disposed. All future
   * sign attempts throw `session-key-disposed`.
   */
  dispose(): void {
    if (this.disposed) return;
    for (let i = 0; i < this.privateKey.length; i += 1) {
      this.privateKey[i] = 0;
    }
    this.privateKey = new Uint8Array(0);
    this.disposed = true;
  }

  // ─── Private ────────────────────────────────────────────────

  private ensureAlive(): void {
    if (this.disposed) {
      throw new AgentBudgetError(
        "session-key-disposed",
        `SessionKey ${this.address} has been disposed`,
      );
    }
  }

  private ensureFresh(): void {
    if (this.isExpired()) {
      throw new AgentBudgetError(
        "session-expired",
        `SessionKey ${this.address} expired at unix ${this.metadata.expiresAt}`,
      );
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function addressForPrivateKey(privateKey: Uint8Array): `0x${string}` {
  const pub = secp256k1.getPublicKey(privateKey, /* compressed */ false);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new AgentBudgetError(
      "session-key-invalid",
      "expected uncompressed 65-byte public key",
    );
  }
  const hash = keccak_256(pub.slice(1));
  return bytesToHexPrefixed(hash.slice(-20));
}

function bytesToHexPrefixed(bytes: Uint8Array): `0x${string}` {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out as `0x${string}`;
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (s.length % 2 !== 0) {
    throw new AgentBudgetError(
      "session-key-invalid",
      `odd-length hex: ${hex.slice(0, 18)}...`,
    );
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
