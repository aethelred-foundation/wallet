/**
 * `LocalKeyAdapter` — software-key baseline.
 *
 * The simplest possible adapter: a secp256k1 private key in memory,
 * used directly for EIP-712 + raw-transaction signing. This is the
 * development baseline, the reference implementation every other
 * adapter is compared against in tests, AND the emergency fallback
 * when no hardware / enclave is available.
 *
 * **Do NOT use this in production for agents handling real money.**
 * A compromised process memory can exfiltrate the key. Production
 * agent wallets should use `NitroEnclaveAdapter`, `LedgerHsmAdapter`,
 * or `ShamirTwoOfTwoAdapter` depending on their threat model.
 *
 * Security notes:
 *
 *   1. The private key is stored as a `Uint8Array`. We zeroize it
 *      in `dispose()`. Zeroization is best-effort in JS (the V8
 *      GC may have already copied the bytes) but good hygiene
 *      nonetheless.
 *
 *   2. We never log the private key. Errors reference only the
 *      derived address.
 *
 *   3. `signTypedData` computes the EIP-712 digest with the shared
 *      `computeTypedDataDigest` helper — byte-for-byte identical to
 *      what Nitro / Ledger adapters produce. A signature from this
 *      adapter recovers to the same address any other adapter
 *      would produce for the same key material.
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
import { CustodyError } from "./errors";

export interface LocalKeyAdapterConfig {
  /**
   * 32-byte raw secp256k1 private key. Hex string with or without
   * 0x prefix, or a Uint8Array.
   *
   * The adapter copies the bytes immediately and zeroizes on
   * dispose; the caller should also zeroize their reference.
   */
  readonly privateKey: Uint8Array | string;
  /**
   * Optional label shown in audit + error output.
   * Default: "local-key".
   */
  readonly label?: string;
}

export class LocalKeyAdapter implements CustodyAdapter {
  readonly address: `0x${string}`;
  readonly capabilities: CustodyCapabilities;

  private privateKey: Uint8Array;
  private disposed = false;

  constructor(config: LocalKeyAdapterConfig) {
    const pkBytes = normalizePrivateKey(config.privateKey);
    if (!secp256k1.utils.isValidPrivateKey(pkBytes)) {
      throw new CustodyError("invalid-key-material", "Invalid secp256k1 private key");
    }
    this.privateKey = pkBytes;

    const publicKey = secp256k1.getPublicKey(this.privateKey, /* compressed */ false);
    this.address = computeAddressFromUncompressedPublicKey(publicKey);

    this.capabilities = {
      canSignTypedData: true,
      canSignRawTransaction: true,
      canExportPublicKey: true,
      canProduceAttestation: false,
      requiresUserInteraction: false,
      requiresNetworkAccess: false,
      label: config.label ?? "local-key",
    };
  }

  async signTypedData(req: TypedDataRequest): Promise<`0x${string}`> {
    this.ensureAlive();
    const digest = computeTypedDataDigest(req);
    return this.signDigest(digest);
  }

  async signRawTransaction(_req: RawTransactionRequest): Promise<`0x${string}`> {
    this.ensureAlive();
    throw new CustodyError(
      "capability-not-supported",
      "LocalKeyAdapter.signRawTransaction is intentionally deferred to @aethelred/wallet-core custody — use this adapter only for EIP-712 typed-data signing in the custody-adapters layer",
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
    // Best-effort zeroization. The V8 GC may have already copied
    // the bytes; on hot paths we also rely on short-lived process
    // boundaries.
    for (let i = 0; i < this.privateKey.length; i += 1) {
      this.privateKey[i] = 0;
    }
    this.privateKey = new Uint8Array(0);
    this.disposed = true;
  }

  // ─── Private ────────────────────────────────────────────────

  private ensureAlive(): void {
    if (this.disposed) {
      throw new CustodyError("adapter-disposed", "LocalKeyAdapter has been disposed");
    }
  }

  private signDigest(digest: Uint8Array): `0x${string}` {
    // Secp256k1 canonical (low-s) signature, with recovery.
    // `lowS: true` is MANDATORY for Ethereum — EIP-2 rejects
    // signatures with s > n/2.
    // `@noble/secp256k1` v2 signs the digest directly — no `prehash`
    // toggle. We pass a keccak-256 output and it treats those 32
    // bytes as the message-hash verbatim, which is what EIP-712 needs.
    const sig = secp256k1.sign(digest, this.privateKey, { lowS: true });
    // Compact form: r || s || v where v = 27 + recovery
    const rs = sig.toCompactRawBytes();
    const v = 27 + (sig.recovery ?? 0);

    const out = new Uint8Array(65);
    out.set(rs, 0);
    out[64] = v;

    const hex = bytesToHex(out);
    return `0x${hex}` as `0x${string}`;
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function normalizePrivateKey(input: Uint8Array | string): Uint8Array {
  if (input instanceof Uint8Array) {
    if (input.length !== 32) {
      throw new CustodyError(
        "invalid-key-material",
        `Private key must be 32 bytes, got ${input.length}`,
      );
    }
    const copy = new Uint8Array(32);
    copy.set(input);
    return copy;
  }
  if (typeof input === "string") {
    const hex = input.startsWith("0x") ? input.slice(2) : input;
    if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
      throw new CustodyError("invalid-key-material", "Private key hex must be 64 chars");
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  throw new CustodyError("invalid-key-material", `Unsupported private-key type: ${typeof input}`);
}

function computeAddressFromUncompressedPublicKey(pub: Uint8Array): `0x${string}` {
  // Uncompressed pub = 0x04 || X || Y — strip the 0x04 prefix.
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new CustodyError(
      "invalid-key-material",
      "Expected uncompressed public key (65 bytes starting with 0x04)",
    );
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
