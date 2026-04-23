/**
 * EIP-712 typed-data layer for MerchantProfile + Invoice.
 *
 * Merchants sign their profile once; they sign each invoice when
 * they publish it. Payers verify both signatures before honouring
 * the invoice. The signatures are byte-for-byte the same shape the
 * x402 client and the intent router already produce — the same
 * `TypedDataSigner` backend works for every flow.
 *
 * Two primary types:
 *
 *     MerchantProfile(
 *       string id,
 *       string displayName,
 *       string logoUrl,
 *       address signer,
 *       bytes33 publicKey,
 *       string acceptedNetworks,     // JSON-serialised array
 *       string defaultGateHash,      // keccak256 of canonical gate JSON
 *       uint256 createdAt,
 *       uint256 expiresAt,
 *       bool hasAttestation,
 *       bytes32 attestationNonce     // 0x0..0 when no attestation
 *     )
 *
 *     Invoice(
 *       bytes32 id,
 *       string slug,
 *       string merchantId,
 *       string title,
 *       string description,
 *       uint256 amount,
 *       address asset,
 *       string network,
 *       address recipient,
 *       uint256 deadline,
 *       bytes32 gateHash,            // keccak256 of canonical gate JSON, 0x0..0 when none
 *       uint256 createdAt
 *     )
 *
 * We use `bytes32` hashes of structured sub-fields (gate, networks
 * list) instead of inlining nested arrays because EIP-712 array
 * support inside the custody-adapters encoder is deliberately
 * disabled — see `@aethelred/wallet-custody-adapters/eip712-hash`.
 * This keeps the encoder simple AND forces callers to commit to a
 * specific canonical form for sub-structures.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import * as secp256k1 from "@noble/secp256k1";

import {
  computeTypedDataDigest,
  type TypedDataDomain,
  type TypedDataField,
  type TypedDataRequest,
  type TypedDataSigner,
} from "@aethelred/wallet-custody-adapters";
import type { SerializedVcGate } from "@aethelred/wallet-reputation";

import type { Invoice, MerchantProfile } from "./types";
import { InvoiceError } from "./errors";
import "./crypto-bootstrap";

// ─── Domains ────────────────────────────────────────────────────

export const INVOICE_DOMAIN_NAME = "AethelredInvoice" as const;
export const INVOICE_DOMAIN_VERSION = "1" as const;

/**
 * Chain-scoped domain. `chainId` defaults to 0 when the caller has
 * no specific chain in mind — profiles are chain-agnostic, so the
 * default is reasonable. Invoices that settle on a specific network
 * SHOULD pin chainId to that network's id so cross-chain replay is
 * impossible.
 */
export function invoiceDomain(opts: {
  readonly chainId?: number;
  readonly verifyingContract?: `0x${string}`;
}): TypedDataDomain {
  return {
    name: INVOICE_DOMAIN_NAME,
    version: INVOICE_DOMAIN_VERSION,
    chainId: opts.chainId ?? 0,
    verifyingContract:
      opts.verifyingContract ?? ("0x0000000000000000000000000000000000000000" as const),
  };
}

// ─── Struct definitions ───────────────────────────────────────

const MERCHANT_PROFILE_FIELDS: ReadonlyArray<TypedDataField> = [
  { name: "id", type: "string" },
  { name: "displayName", type: "string" },
  { name: "logoUrl", type: "string" },
  { name: "signer", type: "address" },
  { name: "publicKey", type: "bytes33" },
  { name: "acceptedNetworksHash", type: "bytes32" },
  { name: "defaultGateHash", type: "bytes32" },
  { name: "createdAt", type: "uint256" },
  { name: "expiresAt", type: "uint256" },
  { name: "hasAttestation", type: "bool" },
  { name: "attestationNonce", type: "bytes32" },
];

const INVOICE_FIELDS: ReadonlyArray<TypedDataField> = [
  { name: "id", type: "bytes32" },
  { name: "slug", type: "string" },
  { name: "merchantId", type: "string" },
  { name: "title", type: "string" },
  { name: "description", type: "string" },
  { name: "amount", type: "uint256" },
  { name: "asset", type: "address" },
  { name: "network", type: "string" },
  { name: "recipient", type: "address" },
  { name: "deadline", type: "uint256" },
  { name: "gateHash", type: "bytes32" },
  { name: "createdAt", type: "uint256" },
];

// `bytes33` isn't a native EIP-712 type, and the custody-adapters
// encoder accepts `bytes1..32`. We hash the publicKey down to
// bytes32 before building the message — the field type stays
// `bytes32`, but we keep the semantic name `publicKey` in the docs
// above.
const MERCHANT_PROFILE_FIELDS_ENCODED: ReadonlyArray<TypedDataField> = MERCHANT_PROFILE_FIELDS.map(
  (f) => (f.name === "publicKey" ? { name: "publicKey", type: "bytes32" } : f),
);

// ─── Canonical hashes for sub-structures ──────────────────────

/**
 * Canonical JSON for any deterministic object. RFC 8785-inspired —
 * keys sorted, no whitespace. The hash of this JSON is what we sign
 * over when the field's native form is not EIP-712-friendly (arrays,
 * nested optional maps).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new InvoiceError(
    "invoice-malformed",
    `canonicalJson: unsupported value type ${typeof value}`,
  );
}

/** `keccak256(canonicalJson(value))` packaged as `0x${string}`. */
export function canonicalHash(value: unknown): `0x${string}` {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = keccak_256(bytes);
  return bytesToHexPrefixed(digest);
}

/** All-zeros bytes32 — the sentinel when a field isn't set. */
const ZERO_BYTES32 = ("0x" + "00".repeat(32)) as `0x${string}`;

function hashAcceptedNetworks(networks: ReadonlyArray<string>): `0x${string}` {
  return canonicalHash([...networks].sort());
}

function hashGate(gate: SerializedVcGate | undefined): `0x${string}` {
  if (!gate) return ZERO_BYTES32;
  return canonicalHash({
    combinator: gate.combinator ?? "all",
    directives: gate.directives,
  });
}

function hashPublicKey(publicKey: `0x${string}`): `0x${string}` {
  const bytes = hexToBytes(publicKey);
  if (bytes.length !== 33) {
    throw new InvoiceError(
      "merchant-profile-invalid",
      `publicKey must be 33 bytes (compressed secp256k1), got ${bytes.length}`,
    );
  }
  // Hash the 33 bytes down to 32 so it fits a bytes32 EIP-712 slot.
  return bytesToHexPrefixed(keccak_256(bytes));
}

// ─── MerchantProfile sign/verify ──────────────────────────────

export function buildMerchantProfileRequest(
  profile: Omit<MerchantProfile, "signature" | "revoked" | "revocationReason">,
  opts: { readonly chainId?: number; readonly verifyingContract?: `0x${string}` } = {},
): TypedDataRequest {
  const acceptedNetworksHash = hashAcceptedNetworks(profile.acceptedNetworks);
  const defaultGateHash = hashGate(profile.defaultGate);
  const publicKeyHash = hashPublicKey(profile.publicKey);
  const attestationNonce = profile.attestation?.nonce ?? ZERO_BYTES32;

  return {
    domain: invoiceDomain(opts),
    types: { MerchantProfile: MERCHANT_PROFILE_FIELDS_ENCODED },
    primaryType: "MerchantProfile",
    message: {
      id: profile.id,
      displayName: profile.displayName,
      logoUrl: profile.logoUrl ?? "",
      signer: profile.address,
      publicKey: publicKeyHash,
      acceptedNetworksHash,
      defaultGateHash,
      createdAt: profile.createdAt,
      expiresAt: profile.expiresAt ?? 0,
      hasAttestation: profile.attestation !== undefined,
      attestationNonce,
    },
  };
}

export async function signMerchantProfile(
  draft: Omit<MerchantProfile, "signature" | "revoked" | "revocationReason">,
  signer: TypedDataSigner,
  opts: { readonly chainId?: number; readonly verifyingContract?: `0x${string}` } = {},
): Promise<MerchantProfile> {
  if (signer.address.toLowerCase() !== draft.address.toLowerCase()) {
    throw new InvoiceError(
      "merchant-signature-invalid",
      `signer address ${signer.address} does not match profile.address ${draft.address}`,
    );
  }
  const request = buildMerchantProfileRequest(draft, opts);
  const signature = await signer.signTypedData(request);
  return {
    ...draft,
    signature,
    revoked: false,
  };
}

export function verifyMerchantProfileSignature(
  profile: MerchantProfile,
  opts: { readonly chainId?: number; readonly verifyingContract?: `0x${string}` } = {},
): void {
  const request = buildMerchantProfileRequest(profile, opts);
  const digest = computeTypedDataDigest(request);
  assertRecoveredSignerMatches(digest, profile.signature, profile.address);
}

// ─── Invoice canonical id ─────────────────────────────────────

/**
 * Deterministic invoice id = `keccak256(canonicalJson(body))` where
 * `body` covers every field EXCEPT `id`, `slug`, `signature`,
 * `merchantCredentials`, and `status`. Excluding `status` is
 * intentional — the id must not change when the invoice transitions
 * from `open` to `paid`.
 *
 * Exported so callers that precompute invoices (batch settlement,
 * template generators) can derive ids without holding the full
 * Invoice object.
 */
export function computeInvoiceId(
  body: Omit<Invoice, "id" | "slug" | "signature" | "merchantCredentials" | "status">,
): `0x${string}` {
  const gateHash = hashGate(body.gate);
  const canonical = {
    merchantId: body.merchantId,
    title: body.title,
    description: body.description ?? "",
    amount: body.amount,
    asset: body.asset,
    network: body.network,
    recipient: body.recipient,
    deadline: body.deadline,
    gateHash,
    createdAt: body.createdAt,
    lineItems: body.lineItems ?? [],
  };
  return canonicalHash(canonical);
}

// ─── Invoice sign/verify ──────────────────────────────────────

export function buildInvoiceRequest(
  invoice: Omit<Invoice, "signature"> & { readonly merchantCredentials?: Invoice["merchantCredentials"] },
  opts: { readonly chainId?: number; readonly verifyingContract?: `0x${string}` } = {},
): TypedDataRequest {
  return {
    domain: invoiceDomain(opts),
    types: { Invoice: INVOICE_FIELDS },
    primaryType: "Invoice",
    message: {
      id: invoice.id,
      slug: invoice.slug,
      merchantId: invoice.merchantId,
      title: invoice.title,
      description: invoice.description ?? "",
      amount: invoice.amount,
      asset: invoice.asset,
      network: invoice.network,
      recipient: invoice.recipient,
      deadline: invoice.deadline,
      gateHash: hashGate(invoice.gate),
      createdAt: invoice.createdAt,
    },
  };
}

/**
 * Sign a draft invoice. The merchant's signer MUST match the
 * merchant's profile address — we verify that before calling the
 * signer to avoid confusing errors later.
 */
export async function signInvoice(
  draft: Omit<Invoice, "signature">,
  signer: TypedDataSigner,
  merchant: MerchantProfile,
  opts: { readonly chainId?: number; readonly verifyingContract?: `0x${string}` } = {},
): Promise<Invoice> {
  if (signer.address.toLowerCase() !== merchant.address.toLowerCase()) {
    throw new InvoiceError(
      "invoice-signer-mismatch",
      `signer ${signer.address} does not match merchant.address ${merchant.address}`,
    );
  }
  // Recompute the id and assert it matches — protects against callers
  // who construct a draft with a stale id after mutating a field.
  const recomputed = computeInvoiceId(draft);
  if (recomputed.toLowerCase() !== draft.id.toLowerCase()) {
    throw new InvoiceError(
      "invoice-malformed",
      `invoice.id ${draft.id} does not match recomputed id ${recomputed}`,
      { details: { expectedId: recomputed, actualId: draft.id } },
    );
  }
  const request = buildInvoiceRequest(draft, opts);
  const signature = await signer.signTypedData(request);
  return { ...draft, signature };
}

export function verifyInvoiceSignature(
  invoice: Invoice,
  merchant: MerchantProfile,
  opts: { readonly chainId?: number; readonly verifyingContract?: `0x${string}` } = {},
): void {
  const recomputed = computeInvoiceId({
    merchantId: invoice.merchantId,
    title: invoice.title,
    description: invoice.description,
    amount: invoice.amount,
    asset: invoice.asset,
    network: invoice.network,
    recipient: invoice.recipient,
    deadline: invoice.deadline,
    gate: invoice.gate,
    createdAt: invoice.createdAt,
    lineItems: invoice.lineItems,
  });
  if (recomputed.toLowerCase() !== invoice.id.toLowerCase()) {
    throw new InvoiceError(
      "invoice-malformed",
      `invoice.id ${invoice.id} does not match recomputed id ${recomputed}`,
      { details: { expectedId: recomputed, actualId: invoice.id } },
    );
  }
  const request = buildInvoiceRequest(invoice, opts);
  const digest = computeTypedDataDigest(request);
  assertRecoveredSignerMatches(digest, invoice.signature, merchant.address);
}

// ─── Signature recovery ──────────────────────────────────────

function assertRecoveredSignerMatches(
  digest: Uint8Array,
  signature: `0x${string}`,
  expectedAddress: `0x${string}`,
): void {
  const sigBytes = hexToBytes(signature);
  if (sigBytes.length !== 65) {
    throw new InvoiceError(
      "invoice-signature-invalid",
      `signature must be 65 bytes, got ${sigBytes.length}`,
    );
  }
  const r = sigBytes.slice(0, 32);
  const s = sigBytes.slice(32, 64);
  const v = sigBytes[64];
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) {
    throw new InvoiceError(
      "invoice-signature-invalid",
      `invalid recovery byte v=${v}`,
    );
  }
  let recoveredPub: Uint8Array;
  try {
    const sig = secp256k1.Signature.fromCompact(concatBytes(r, s)).addRecoveryBit(recovery);
    recoveredPub = sig.recoverPublicKey(digest).toRawBytes(false);
  } catch (cause) {
    throw new InvoiceError("invoice-signature-invalid", "ECDSA recovery failed", { cause });
  }
  const recovered = addressFromUncompressedPubkey(recoveredPub);
  if (recovered.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new InvoiceError(
      "invoice-signer-mismatch",
      `signature recovers to ${recovered}, expected ${expectedAddress}`,
      { details: { recovered, expectedAddress } },
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (s.length % 2 !== 0) {
    throw new InvoiceError(
      "invoice-malformed",
      `odd-length hex: ${hex.slice(0, 18)}...`,
    );
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHexPrefixed(bytes: Uint8Array): `0x${string}` {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out as `0x${string}`;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function addressFromUncompressedPubkey(pub: Uint8Array): `0x${string}` {
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new InvoiceError(
      "invoice-signature-invalid",
      `expected 65-byte uncompressed public key`,
    );
  }
  const hash = keccak_256(pub.slice(1));
  return bytesToHexPrefixed(hash.slice(-20));
}
