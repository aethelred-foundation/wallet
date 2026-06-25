/**
 * `MpcTssAdapter` — vendor-agnostic MPC threshold-signature custody.
 *
 * MPC-TSS (a key split across N parties that jointly compute ECDSA
 * signatures without any party ever holding the whole key) is the
 * institutional custody standard — Fireblocks, Copper, and Anchorage all
 * run it, and embedded-wallet vendors (Privy, Dynamic) use it under the
 * hood. The existing {@link FireblocksAdapter} covers one vendor via its
 * REST API; this adapter is the **vendor-agnostic** seam: drop in a
 * Silence Labs, ZenGo, Sodot, or in-house TSS engine by implementing the
 * small {@link ThresholdSigner} interface, and the rest of the stack (x402,
 * MCP server, intent router) doesn't change.
 *
 * Security: every signature is cross-checked by recovering the signer
 * address from `(digest, r, s, recovery)` and comparing it to the
 * configured address. A buggy or malicious cohort that returns a signature
 * for the wrong key is rejected before it ever leaves the adapter — the
 * same defence-in-depth the Nitro enclave adapter applies.
 *
 * The adapter signs digests (EIP-712 via {@link computeTypedDataDigest}, or
 * any 32-byte digest via {@link MpcTssAdapter.signDigest}); raw-transaction
 * serialization is the caller's job (defer to `@aethelred/wallet-core`),
 * so `canSignRawTransaction` is false.
 */

import "./crypto-bootstrap";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import * as secp256k1 from "@noble/secp256k1";
import { computeTypedDataDigest } from "./eip712-hash";
import { CustodyError } from "./errors";
import type {
  CustodyAdapter,
  CustodyCapabilities,
  TypedDataRequest,
  TypedDataSigner,
} from "./types";

/** A recoverable ECDSA signature produced by the MPC cohort. */
export interface ThresholdSignature {
  /** 32-byte `r`, `0x`-prefixed (leading zeros allowed). */
  readonly r: `0x${string}`;
  /** 32-byte `s` (low-S), `0x`-prefixed. */
  readonly s: `0x${string}`;
  /** Recovery id, 0 or 1. */
  readonly recovery: 0 | 1;
}

/**
 * Vendor-agnostic threshold signer. Implement this over Silence Labs,
 * ZenGo, Sodot, an in-house GG20/CMP engine, or any MPC cohort — the
 * adapter only needs the cooperative digest-signing primitive.
 */
export interface ThresholdSigner {
  readonly label: string;
  /** M in M-of-N. */
  readonly threshold: number;
  /** N in M-of-N. */
  readonly parties: number;
  /** Cooperatively sign a 32-byte digest across the cohort. */
  signDigest(digest: Uint8Array): Promise<ThresholdSignature>;
}

export interface MpcTssAdapterConfig {
  readonly signer: ThresholdSigner;
  /** EOA address the distributed key derives to. */
  readonly address: `0x${string}`;
  /** Cross-check the recovered signer against `address`. Default: true. */
  readonly verifyRecovery?: boolean;
  readonly label?: string;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function to32(hex: string, field: string): Uint8Array {
  const bytes = hexToBytes(strip0x(hex).padStart(64, "0"));
  if (bytes.length !== 32) {
    throw new CustodyError("signature-malformed", `MPC signature ${field} must be 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

function recoverAddress(digest: Uint8Array, sig: ThresholdSignature): `0x${string}` {
  const compact = new Uint8Array(64);
  compact.set(to32(sig.r, "r"), 0);
  compact.set(to32(sig.s, "s"), 32);
  const pub = secp256k1.Signature.fromCompact(compact)
    .addRecoveryBit(sig.recovery)
    .recoverPublicKey(digest)
    .toRawBytes(false);
  return `0x${bytesToHex(keccak_256(pub.slice(1)).slice(-20))}`;
}

export class MpcTssAdapter implements CustodyAdapter {
  readonly address: `0x${string}`;
  readonly capabilities: CustodyCapabilities;

  private readonly signer: ThresholdSigner;
  private readonly verifyRecovery: boolean;
  private disposed = false;

  constructor(config: MpcTssAdapterConfig) {
    if (!ADDRESS_RE.test(config.address)) {
      throw new CustodyError("adapter-config-invalid", `MpcTssAdapter: invalid address "${config.address}"`);
    }
    if (config.signer.threshold < 1 || config.signer.threshold > config.signer.parties) {
      throw new CustodyError("adapter-config-invalid", `MpcTssAdapter: invalid threshold ${config.signer.threshold}-of-${config.signer.parties}`);
    }
    this.address = config.address;
    this.signer = config.signer;
    this.verifyRecovery = config.verifyRecovery ?? true;
    this.capabilities = {
      canSignTypedData: true,
      canSignRawTransaction: false,
      canExportPublicKey: true,
      canProduceAttestation: false,
      requiresUserInteraction: false,
      requiresNetworkAccess: true,
      label: config.label ?? `mpc-tss-${config.signer.threshold}of${config.signer.parties}-${config.signer.label}`,
    };
  }

  async signTypedData(req: TypedDataRequest): Promise<`0x${string}`> {
    this.ensureAlive();
    return this.signDigest(computeTypedDataDigest(req));
  }

  /** Threshold-sign a 32-byte digest; returns a 65-byte `r ‖ s ‖ v` (v = 27/28). */
  async signDigest(digest: Uint8Array): Promise<`0x${string}`> {
    this.ensureAlive();
    if (!(digest instanceof Uint8Array) || digest.length !== 32) {
      throw new CustodyError("signature-malformed", `MpcTssAdapter.signDigest expects a 32-byte digest, got ${digest?.length ?? "null"}`);
    }
    let sig: ThresholdSignature;
    try {
      sig = await this.signer.signDigest(digest);
    } catch (cause) {
      throw new CustodyError("signing-failed", `MPC threshold signing failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (sig.recovery !== 0 && sig.recovery !== 1) {
      throw new CustodyError("signature-malformed", `MPC recovery id must be 0 or 1, got ${sig.recovery}`);
    }
    if (this.verifyRecovery) {
      const recovered = recoverAddress(digest, sig);
      if (recovered.toLowerCase() !== this.address.toLowerCase()) {
        throw new CustodyError(
          "signing-failed",
          `MPC signature recovers to ${recovered}, expected ${this.address} — cohort/key mismatch, refusing to release signature`,
        );
      }
    }
    const v = (27 + sig.recovery).toString(16).padStart(2, "0");
    return `0x${strip0x(sig.r).padStart(64, "0")}${strip0x(sig.s).padStart(64, "0")}${v}` as `0x${string}`;
  }

  asTypedDataSigner(): TypedDataSigner {
    return {
      address: this.address,
      signTypedData: (req) => this.signTypedData(req),
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  private ensureAlive(): void {
    if (this.disposed) {
      throw new CustodyError("adapter-disposed", "MpcTssAdapter has been disposed");
    }
  }
}
