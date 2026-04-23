/**
 * Intent envelope factory — build, hash, sign, and verify intents.
 *
 * The envelope has two fields that depend on the signing step:
 *
 *   - `id` — deterministic `keccak256(canonical(envelope-without-id ||
 *     body))`. We compute this from the struct hash produced by the
 *     shared `computeTypedDataDigest` so the id is guaranteed to
 *     match what an on-chain settlement contract would derive.
 *
 *   - `signature` — EIP-712 signature by the creator. Produced by
 *     any `TypedDataSigner`, including every adapter we ship in
 *     `@aethelred/wallet-custody-adapters`.
 *
 * `createSignedIntent()` is the single entry point callers use:
 *
 *     const intent = await createSignedIntent({
 *       body: { kind: "transfer", asset, amount, recipient },
 *       creator: adapter.address,
 *       chainId: 8453,
 *       deadlineMs: Date.now() + 10 * 60_000,
 *       signer: adapter.asTypedDataSigner(),
 *     });
 *
 * `verifyIntentSignature()` checks the signature recovers to
 * `envelope.creator` — the router calls this on every submitted
 * intent before doing anything else.
 */

import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3.js";

import { computeTypedDataDigest } from "@aethelred/wallet-custody-adapters";
import type { TypedDataSigner } from "@aethelred/wallet-custody-adapters";

import type { Intent, IntentBody, IntentEnvelope } from "./types";
import { buildUnsignedIntentRequest } from "./eip712-intents";
import { IntentRouterError } from "./errors";

// ─── Public API ────────────────────────────────────────────────

export interface CreateSignedIntentOptions {
  readonly body: IntentBody;
  readonly creator: `0x${string}`;
  readonly chainId: number;
  /** Unix ms after which the intent is void. */
  readonly deadlineMs: number;
  /** Signer — any CustodyAdapter's `asTypedDataSigner()`. */
  readonly signer: TypedDataSigner;
  /**
   * Optional; if absent a 32-byte random nonce is generated via
   * `crypto.getRandomValues`. Callers that manage their own nonce
   * space (e.g. smart-account flows) pass one explicitly.
   */
  readonly nonce?: `0x${string}`;
  /**
   * Optional binding for a TEE attestation — when set, solvers that
   * consume attested intents can bind a fresh TEE quote to this
   * 32-byte value (same flow the x402 AttestationProvider uses).
   */
  readonly attestationBinding?: `0x${string}`;
  /**
   * On-chain verifying contract (if the intent will settle through a
   * specific contract). Defaults to zero address for off-chain
   * routing where no single contract is the oracle.
   */
  readonly verifyingContract?: `0x${string}`;
}

/**
 * Build, hash, and sign an intent in one call. Returns the fully
 * formed `Intent` with envelope.id and envelope.signature populated.
 */
export async function createSignedIntent(opts: CreateSignedIntentOptions): Promise<Intent> {
  if (opts.creator.toLowerCase() !== opts.signer.address.toLowerCase()) {
    throw new IntentRouterError(
      "intent-signer-mismatch",
      `creator ${opts.creator} does not match signer address ${opts.signer.address}`,
    );
  }

  const nonce = opts.nonce ?? randomBytes32();
  const envelopeWithoutIdSig = {
    creator: opts.creator,
    chainId: opts.chainId,
    nonce,
    deadline: opts.deadlineMs,
    attestationBinding: opts.attestationBinding ?? (`0x${"00".repeat(32)}` as `0x${string}`),
  };

  const request = buildUnsignedIntentRequest(opts.body, envelopeWithoutIdSig, {
    verifyingContract: opts.verifyingContract,
  });

  // The EIP-712 digest IS the intent id — deterministic, binds every
  // field, and doubles as the signing preimage. No separate hash
  // scheme to drift against.
  const digest = computeTypedDataDigest(request);
  const id = bytesToHexPrefixed(digest);

  const signature = await opts.signer.signTypedData(request);

  const envelope: IntentEnvelope = {
    id,
    creator: opts.creator,
    chainId: opts.chainId,
    nonce,
    deadline: opts.deadlineMs,
    attestationBinding: envelopeWithoutIdSig.attestationBinding,
    signature,
  };
  return { envelope, body: opts.body };
}

/**
 * Recompute the intent id and verify the signature. Used by the
 * router on every submit. Throws `IntentRouterError` with a
 * `intent-*` code on any failure.
 */
export function verifyIntentSignature(intent: Intent): void {
  const { envelope, body } = intent;

  const request = buildUnsignedIntentRequest(body, {
    creator: envelope.creator,
    chainId: envelope.chainId,
    nonce: envelope.nonce,
    deadline: envelope.deadline,
    attestationBinding: envelope.attestationBinding,
  });

  const digest = computeTypedDataDigest(request);
  const expectedId = bytesToHexPrefixed(digest);
  if (expectedId.toLowerCase() !== envelope.id.toLowerCase()) {
    throw new IntentRouterError(
      "intent-malformed",
      `envelope.id ${envelope.id} does not match recomputed id ${expectedId}`,
      { details: { expectedId, actualId: envelope.id } },
    );
  }

  const sigBytes = hexToBytes(envelope.signature);
  if (sigBytes.length !== 65) {
    throw new IntentRouterError(
      "intent-signature-invalid",
      `signature length ${sigBytes.length} != 65`,
    );
  }
  const r = sigBytes.slice(0, 32);
  const s = sigBytes.slice(32, 64);
  const v = sigBytes[64];
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) {
    throw new IntentRouterError(
      "intent-signature-invalid",
      `invalid recovery byte v=${v}`,
    );
  }

  let recoveredPub: Uint8Array;
  try {
    const sig = secp256k1.Signature.fromCompact(concat(r, s)).addRecoveryBit(recovery);
    recoveredPub = sig.recoverPublicKey(digest).toRawBytes(false);
  } catch (cause) {
    throw new IntentRouterError("intent-signature-invalid", "ECDSA recovery failed", {
      cause,
    });
  }

  const recoveredAddress = addressFromUncompressedPubkey(recoveredPub);
  if (recoveredAddress.toLowerCase() !== envelope.creator.toLowerCase()) {
    throw new IntentRouterError(
      "intent-signer-mismatch",
      `recovered signer ${recoveredAddress} does not match envelope.creator ${envelope.creator}`,
      { details: { recoveredAddress, declaredCreator: envelope.creator } },
    );
  }
}

/**
 * Check the intent hasn't expired. Exported as a separate function
 * so callers can do freshness-only checks without recomputing the
 * signature.
 */
export function assertIntentFresh(intent: Intent, now: number = Date.now()): void {
  if (intent.envelope.deadline <= now) {
    throw new IntentRouterError(
      "intent-expired",
      `intent ${intent.envelope.id} expired at ${intent.envelope.deadline} (now=${now})`,
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function randomBytes32(): `0x${string}` {
  const out = new Uint8Array(32);
  crypto.getRandomValues(out);
  return bytesToHexPrefixed(out);
}

function bytesToHexPrefixed(bytes: Uint8Array): `0x${string}` {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out as `0x${string}`;
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (s.length % 2 !== 0) {
    throw new IntentRouterError("intent-malformed", `odd-length hex: ${hex.slice(0, 18)}...`);
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function addressFromUncompressedPubkey(pub: Uint8Array): `0x${string}` {
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new IntentRouterError(
      "intent-signature-invalid",
      `expected 65-byte uncompressed public key, got ${pub.length}`,
    );
  }
  const hash = keccak_256(pub.slice(1));
  return bytesToHexPrefixed(hash.slice(-20));
}
