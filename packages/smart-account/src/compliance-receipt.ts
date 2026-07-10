/**
 * Compliance receipt — on-chain cryptographic finality for off-chain compliance.
 *
 * This is the keystone that weaponises EIP-7702. After the off-chain pipeline
 * (multi-vendor screening + anomaly + travel-rule + policy) decides **allow**,
 * a trusted compliance authority signs an EIP-712 `ComplianceReceipt` bound to
 * the exact transaction intent. A companion EIP-7702 delegate (or a 4337
 * account) verifies that signature on-chain and refuses to execute any
 * transaction whose receipt is missing, expired, mismatched, or not signed by
 * the authority.
 *
 * Net effect: an enterprise keeps its existing EOA (via 7702 delegation) yet
 * cannot move funds unless the wallet's full compliance pipeline approved that
 * specific transfer — off-chain multi-vendor compliance with on-chain finality,
 * no wallet migration. Competitors who bolt compliance on at the UI layer
 * cannot match this; the constraint lives in the signing path AND on-chain.
 *
 * EIP-712 so a Solidity verifier recomputes the digest with the standard
 * `keccak256(0x1901 ‖ domainSeparator ‖ structHash)` and `ecrecover`s it.
 * Custody-agnostic: the authority signs via a digest→sig callback.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { hashTypedDataV4, recoverSignerAddress, bytesToHex, hexToBytes } from "@aethelred/wallet-core";

/** Decision codes carried in the receipt (match the off-chain pipeline). */
export const RECEIPT_DECISION = { allow: 0, review: 1, block: 2 } as const;
export type ReceiptDecision = (typeof RECEIPT_DECISION)[keyof typeof RECEIPT_DECISION];

export interface ComplianceReceipt {
  /** Binds the receipt to one transaction — see {@link computeIntentHash}. */
  readonly intentHash: `0x${string}`;
  /** The authorised sender (the delegating EOA / account). */
  readonly subject: `0x${string}`;
  /** Pipeline decision; only `allow` (0) authorises execution. */
  readonly decision: ReceiptDecision;
  /** Unix seconds. */
  readonly issuedAt: number;
  /** Unix seconds — the delegate rejects after this. */
  readonly expiry: number;
  /** Identifies the pipeline/config that approved (for audit + rotation). */
  readonly pipelineHash: `0x${string}`;
}

export interface SignedComplianceReceipt extends ComplianceReceipt {
  /** 65-byte `r ‖ s ‖ v` authority signature, `0x`-prefixed. */
  readonly signature: `0x${string}`;
}

export interface ReceiptDomain {
  readonly chainId: number;
  /** The verifying delegate/account contract address. */
  readonly verifyingContract: `0x${string}`;
}

export interface TransactionIntent {
  readonly chainId: number;
  readonly to: `0x${string}`;
  /** Wei, as a decimal or `0x` string. */
  readonly value: string;
  readonly data?: `0x${string}`;
  readonly nonce: number;
}

/** Sign a 32-byte digest → 65-byte `r ‖ s ‖ v` (custody-agnostic). */
export type SignDigestFn = (digest: Uint8Array) => Uint8Array | Promise<Uint8Array>;

const RECEIPT_TYPES = {
  ComplianceReceipt: [
    { name: "intentHash", type: "bytes32" },
    { name: "subject", type: "address" },
    { name: "decision", type: "uint8" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiry", type: "uint64" },
    { name: "pipelineHash", type: "bytes32" },
  ],
} as const;

function uintTo32(n: bigint): Uint8Array {
  if (n < 0n) throw new Error("compliance-receipt: value must be >= 0");
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0 && v > 0n; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function addressTo32(address: `0x${string}`): Uint8Array {
  const bytes = hexToBytes(address);
  if (bytes.length !== 20) throw new Error(`compliance-receipt: invalid address "${address}"`);
  const out = new Uint8Array(32);
  out.set(bytes, 12);
  return out;
}

/**
 * Bind a receipt to one transaction:
 * `keccak256(abi.encode(chainId, to, value, keccak256(data), nonce))`.
 * Hashing `data` first keeps every word static, so the Solidity verifier is a
 * one-line `keccak256(abi.encode(...))` with no dynamic-bytes handling.
 */
export function computeIntentHash(intent: TransactionIntent): `0x${string}` {
  const dataHash = keccak_256(hexToBytes(intent.data ?? "0x"));
  const encoded = new Uint8Array(32 * 5);
  encoded.set(uintTo32(BigInt(intent.chainId)), 0);
  encoded.set(addressTo32(intent.to), 32);
  encoded.set(uintTo32(BigInt(intent.value)), 64);
  encoded.set(dataHash, 96);
  encoded.set(uintTo32(BigInt(intent.nonce)), 128);
  return bytesToHex(keccak_256(encoded)) as `0x${string}`;
}

function typedData(receipt: ComplianceReceipt, domain: ReceiptDomain) {
  return {
    domain: { name: "AethelredCompliance", version: "1", chainId: domain.chainId, verifyingContract: domain.verifyingContract },
    types: RECEIPT_TYPES as unknown as Record<string, Array<{ name: string; type: string }>>,
    primaryType: "ComplianceReceipt",
    message: {
      intentHash: receipt.intentHash,
      subject: receipt.subject,
      decision: receipt.decision,
      issuedAt: receipt.issuedAt,
      expiry: receipt.expiry,
      pipelineHash: receipt.pipelineHash,
    },
  };
}

/** The 32-byte EIP-712 digest the authority signs. */
export function hashComplianceReceipt(receipt: ComplianceReceipt, domain: ReceiptDomain): Uint8Array {
  return hashTypedDataV4(typedData(receipt, domain));
}

export async function signComplianceReceipt(
  receipt: ComplianceReceipt,
  domain: ReceiptDomain,
  signDigest: SignDigestFn,
): Promise<SignedComplianceReceipt> {
  const sig = await signDigest(hashComplianceReceipt(receipt, domain));
  if (sig.length !== 65) throw new Error(`compliance-receipt: expected a 65-byte signature, got ${sig.length}`);
  return { ...receipt, signature: bytesToHex(sig) as `0x${string}` };
}

/** Recover the authority address that signed a receipt. */
export function recoverReceiptAuthority(signed: SignedComplianceReceipt, domain: ReceiptDomain): `0x${string}` {
  return recoverSignerAddress(hashComplianceReceipt(signed, domain), hexToBytes(signed.signature)) as `0x${string}`;
}

export interface ReceiptVerification {
  readonly valid: boolean;
  readonly reason: string;
}

/**
 * Verify a receipt as a delegate would: signed by `authority`, decision is
 * `allow`, and within its validity window. `nowSec` defaults to now.
 */
export function verifyComplianceReceipt(
  signed: SignedComplianceReceipt,
  domain: ReceiptDomain,
  authority: `0x${string}`,
  nowSec: number = Math.floor(Date.now() / 1000),
): ReceiptVerification {
  if (signed.decision !== RECEIPT_DECISION.allow) {
    return { valid: false, reason: `receipt decision is ${signed.decision}, not allow` };
  }
  if (nowSec < signed.issuedAt) return { valid: false, reason: "receipt not yet valid" };
  if (nowSec > signed.expiry) return { valid: false, reason: "receipt expired" };
  let recovered: string;
  try {
    recovered = recoverReceiptAuthority(signed, domain);
  } catch (err) {
    return { valid: false, reason: `signature malformed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (recovered.toLowerCase() !== authority.toLowerCase()) {
    return { valid: false, reason: `signed by ${recovered}, expected authority ${authority}` };
  }
  return { valid: true, reason: "valid" };
}
