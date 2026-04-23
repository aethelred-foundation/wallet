/**
 * `ShamirTwoOfTwoAdapter` — 2-of-2 Shamir secret split signing.
 *
 * The MoltPe-parity tier: a secp256k1 private key is split into two
 * additive shares (share_a ⊕ share_b = private_key over GF(n),
 * where n is the secp256k1 curve order). Each party holds one
 * share, and reconstruction requires both. Once reconstructed
 * in-memory, the adapter signs with the full key then
 * immediately zeroizes the reconstructed bytes.
 *
 * Why 2-of-2 additive (not full Shamir polynomial sharing)?
 *
 *   - It's simpler and easier to audit — literally `share_a + share_b
 *     mod n == private_key`.
 *   - MoltPe uses the same construction, so feature-parity is direct.
 *   - For 2-of-2 specifically, polynomial sharing degenerates to
 *     additive sharing anyway.
 *   - 2-of-3, 3-of-5, etc. threshold splits would use the full
 *     polynomial scheme; those are tracked for a follow-up
 *     `ShamirThresholdAdapter`.
 *
 * Security model:
 *
 *   1. **Neither share alone reveals anything** about the private
 *      key. Each is uniformly random mod n.
 *
 *   2. **Reconstruction is in-memory only**. The full key exists
 *      ephemerally during `signTypedData`, is used to sign, and is
 *      zeroized immediately. If the process is compromised during
 *      the signing window, the key is exposed — matching MoltPe's
 *      threat model for shared custody.
 *
 *   3. **Remote-share fetching is pluggable**. In MoltPe's
 *      architecture, one share lives at the server. Our adapter
 *      accepts a `ShareFetcher` so deployments can plug in
 *      whatever transport (HTTPS to a coordinator, Nitro-sealed
 *      storage, keychain) they prefer.
 *
 *   4. **The adapter never persists shares**. Each sign invocation
 *      fetches fresh from the ShareFetcher, uses the share,
 *      zeroizes. No in-memory caching across calls — defeats the
 *      benefit of split custody.
 *
 * **The moat vs MoltPe**: we support Shamir AND harder tiers
 * (Ledger, Nitro). Customers pick the tier that matches their
 * regulatory posture. MoltPe can only offer Shamir + full custody.
 */

import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3.js";

import "./crypto-bootstrap";
import type {
  CustodyAdapter,
  CustodyCapabilities,
  RawTransactionRequest,
  TypedDataRequest,
  TypedDataSigner,
} from "./types";
import { computeTypedDataDigest } from "./eip712-hash";
import {
  CustodyError,
  KeyShareMissingError,
} from "./errors";

/**
 * Curve order for secp256k1 — every arithmetic operation on shares
 * happens mod n.
 */
const SECP256K1_N = BigInt(
  "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
);

/**
 * Pluggable share fetcher. The adapter calls this on every sign
 * invocation to get the second share (the first share is passed
 * at construction time). Typical implementations:
 *
 *   - HTTPS fetcher calling a coordinator service.
 *   - Nitro-sealed-storage fetcher (share lives inside a TEE).
 *   - Keychain / secure-storage fetcher.
 *   - For tests: static in-memory fetcher.
 *
 * Fetchers MUST return a 32-byte share; the adapter does not trust
 * the returned value beyond length + curve validation.
 */
export interface ShareFetcher {
  /** Return the remote share as 32 raw bytes. */
  fetchRemoteShare(context: { readonly address: `0x${string}` }): Promise<Uint8Array>;
}

export interface ShamirTwoOfTwoAdapterConfig {
  /**
   * Local (client-side) share — 32 bytes. Keep this ONLY in the
   * user's trusted custody (keychain, browser secure storage,
   * hardware-backed keystore).
   */
  readonly localShare: Uint8Array | string;

  /** Fetcher for the remote (coordinator-side) share. */
  readonly remoteFetcher: ShareFetcher;

  /** Optional label. Default: "shamir-2of2". */
  readonly label?: string;

  /**
   * The address this adapter signs for. Computed at split-time by
   * the coordinator; the client stores it as metadata alongside the
   * local share. Passing it here avoids having to reconstruct-and-
   * derive on every `address` query (which would leak the key).
   *
   * If absent, the first successful reconstruction computes and
   * caches it.
   */
  readonly address?: `0x${string}`;
}

export class ShamirTwoOfTwoAdapter implements CustodyAdapter {
  readonly capabilities: CustodyCapabilities;

  private localShare: Uint8Array;
  private readonly remoteFetcher: ShareFetcher;
  private cachedAddress?: `0x${string}`;
  private disposed = false;

  constructor(config: ShamirTwoOfTwoAdapterConfig) {
    this.localShare = normalizeShare(config.localShare);
    this.remoteFetcher = config.remoteFetcher;
    this.cachedAddress = config.address;

    this.capabilities = {
      canSignTypedData: true,
      canSignRawTransaction: false, // same as local — out of scope for this package
      canExportPublicKey: config.address !== undefined,
      canProduceAttestation: false,
      requiresUserInteraction: false,
      requiresNetworkAccess: true, // remote share fetch
      label: config.label ?? "shamir-2of2",
    };
  }

  /**
   * Address accessor. If not cached, this fetches BOTH shares to
   * reconstruct — which defeats the benefit of split custody. So
   * we prefer to be told at construction (and cache it), throwing
   * if neither is available.
   */
  get address(): `0x${string}` {
    if (!this.cachedAddress) {
      throw new CustodyError(
        "adapter-config-invalid",
        "ShamirTwoOfTwoAdapter address not known — pass it in config to avoid unnecessary reconstructions",
      );
    }
    return this.cachedAddress;
  }

  async signTypedData(req: TypedDataRequest): Promise<`0x${string}`> {
    this.ensureAlive();
    const digest = computeTypedDataDigest(req);
    return this.signDigest(digest);
  }

  async signRawTransaction(_req: RawTransactionRequest): Promise<`0x${string}`> {
    throw new CustodyError(
      "capability-not-supported",
      "ShamirTwoOfTwoAdapter.signRawTransaction is deferred to @aethelred/wallet-core custody",
    );
  }

  asTypedDataSigner(): TypedDataSigner {
    return {
      address: this.address,
      signTypedData: (req) => this.signTypedData(req),
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    for (let i = 0; i < this.localShare.length; i += 1) {
      this.localShare[i] = 0;
    }
    this.localShare = new Uint8Array(0);
    this.disposed = true;
  }

  // ─── Private ────────────────────────────────────────────────

  private ensureAlive(): void {
    if (this.disposed) {
      throw new CustodyError("adapter-disposed", "ShamirTwoOfTwoAdapter has been disposed");
    }
  }

  private async signDigest(digest: Uint8Array): Promise<`0x${string}`> {
    const remoteShare = await this.remoteFetcher.fetchRemoteShare({
      address: this.cachedAddress ?? ("0x" + "00".repeat(20) as `0x${string}`),
    });
    if (remoteShare.length !== 32) {
      throw new KeyShareMissingError(
        `Remote share fetcher returned ${remoteShare.length} bytes, expected 32`,
      );
    }

    const reconstructed = reconstructKey(this.localShare, remoteShare);
    try {
      if (!secp256k1.utils.isValidPrivateKey(reconstructed)) {
        throw new CustodyError(
          "shamir-reconstruction-failed",
          "Reconstructed key is not a valid secp256k1 private key — shares may be corrupt or incompatible",
        );
      }

      // Cache the address on first successful reconstruction if
      // the caller didn't provide it.
      if (!this.cachedAddress) {
        const pub = secp256k1.getPublicKey(reconstructed, false);
        this.cachedAddress = computeAddressFromUncompressedPublicKey(pub);
      }

      const sig = secp256k1.sign(digest, reconstructed, { lowS: true });
      const rs = sig.toCompactRawBytes();
      const out = new Uint8Array(65);
      out.set(rs, 0);
      out[64] = 27 + (sig.recovery ?? 0);
      return `0x${bytesToHex(out)}` as `0x${string}`;
    } finally {
      // Zeroize the reconstructed key — critical.
      for (let i = 0; i < reconstructed.length; i += 1) {
        reconstructed[i] = 0;
      }
      // Also zeroize the remote share we fetched.
      for (let i = 0; i < remoteShare.length; i += 1) {
        remoteShare[i] = 0;
      }
    }
  }
}

// ─── Share arithmetic ───────────────────────────────────────────

/**
 * Split a 32-byte private key into two shares such that
 * `(share_a + share_b) mod n == private_key`. The first share is
 * generated uniformly at random; the second is derived.
 *
 * Exported so coordinators can generate share-pairs at wallet-
 * creation time. Tests also use this to round-trip split →
 * reconstruct.
 */
export function splitPrivateKey(
  privateKey: Uint8Array,
): { readonly shareA: Uint8Array; readonly shareB: Uint8Array } {
  if (privateKey.length !== 32) {
    throw new CustodyError(
      "invalid-key-material",
      `Private key must be 32 bytes, got ${privateKey.length}`,
    );
  }
  const shareA = new Uint8Array(32);
  crypto.getRandomValues(shareA);

  // Ensure shareA is in [1, n-1] range. The probability of
  // generating zero or >= n is cryptographically negligible, but
  // we're rigorous.
  const shareAInt = bytesToBigInt(shareA);
  if (shareAInt === 0n || shareAInt >= SECP256K1_N) {
    // Retry with fresh random bytes (this branch fires with
    // probability < 2^-128).
    return splitPrivateKey(privateKey);
  }

  const keyInt = bytesToBigInt(privateKey);
  const shareBInt = ((keyInt - shareAInt + SECP256K1_N) % SECP256K1_N);
  const shareB = bigIntToBytes(shareBInt, 32);

  return { shareA, shareB };
}

/**
 * Reconstruct a private key from two additive shares. Pure function;
 * used by `ShamirTwoOfTwoAdapter.signDigest` and by tests.
 */
export function reconstructKey(shareA: Uint8Array, shareB: Uint8Array): Uint8Array {
  if (shareA.length !== 32 || shareB.length !== 32) {
    throw new CustodyError(
      "shamir-reconstruction-failed",
      `Shares must each be 32 bytes, got ${shareA.length} + ${shareB.length}`,
    );
  }
  const sum = (bytesToBigInt(shareA) + bytesToBigInt(shareB)) % SECP256K1_N;
  if (sum === 0n) {
    throw new CustodyError(
      "shamir-reconstruction-failed",
      "Shares sum to zero — cannot form a valid private key",
    );
  }
  return bigIntToBytes(sum, 32);
}

// ─── Helpers ────────────────────────────────────────────────────

function normalizeShare(input: Uint8Array | string): Uint8Array {
  if (input instanceof Uint8Array) {
    if (input.length !== 32) {
      throw new KeyShareMissingError(`Share must be 32 bytes, got ${input.length}`);
    }
    const copy = new Uint8Array(32);
    copy.set(input);
    return copy;
  }
  if (typeof input === "string") {
    const hex = input.startsWith("0x") ? input.slice(2) : input;
    if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
      throw new KeyShareMissingError("Share hex must be 64 chars");
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  throw new KeyShareMissingError(`Unsupported share type: ${typeof input}`);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let out = 0n;
  for (let i = 0; i < bytes.length; i += 1) {
    out = (out << 8n) | BigInt(bytes[i]);
  }
  return out;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let remaining = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function computeAddressFromUncompressedPublicKey(pub: Uint8Array): `0x${string}` {
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new CustodyError("invalid-key-material", "Expected uncompressed 65-byte public key");
  }
  const hash = keccak_256(pub.slice(1));
  return `0x${bytesToHex(hash.slice(-20))}` as `0x${string}`;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}
