/**
 * x402 facilitator — receiver-side payment verification.
 *
 * A facilitator is the service that sits in front of a paid
 * resource and:
 *
 *   1. Returns 402 with a `PaymentRequirementsResponse` when a
 *      caller hits a paid endpoint without a payment header.
 *   2. On retry with `X-PAYMENT`, verifies the signed EIP-3009
 *      authorization, broadcasts it (or queues for batch
 *      broadcast), and returns the receipt in `X-PAYMENT-RESPONSE`.
 *   3. If the requirement includes an `attestation` block,
 *      additionally verifies the TEE quote in
 *      `X-PAYMENT-ATTESTATION` and the binding between quote
 *      and payment.
 *
 * This module provides the VERIFICATION pipeline. It does NOT
 * implement the on-chain broadcast (that's a deployment-specific
 * concern — some facilitators broadcast directly via eth_sendRawTransaction,
 * others queue into a bundler, others settle L2 via ERC-4337
 * UserOperations). We expose a `PaymentBroadcaster` interface
 * so the call-site injects its preferred strategy.
 *
 * The facilitator is intended to run server-side, typically as:
 *   - A Cloudflare Worker in front of a paid API.
 *   - A Fastify / Express middleware.
 *   - A standalone Nitro enclave service for paid compute.
 *
 * We ship the pure verification logic; the transport binding is
 * a deployment exercise. See `./examples/cloudflare-worker.ts`
 * in a follow-up PR for a reference integration.
 */

import type { TeeQuote } from "@aethelred/wallet-compliance";

import type {
  PaymentAttestationPayload,
  PaymentPayload,
  PaymentReceipt,
  PaymentRequirement,
} from "./types";
import { FacilitatorError, X402Error } from "./errors";
import { computeTransferAuthStructHash } from "./eip3009";
import {
  decodeAttestationHeader,
  verifyBindingHash,
} from "./attestation-binding";
import { chainIdForNetwork } from "./chain-config";

/**
 * Inject your broadcast/settlement strategy here. A naive
 * implementation on Base:
 *
 *   const broadcaster: PaymentBroadcaster = {
 *     async broadcast(auth, req) {
 *       const hash = await basePublicClient.sendRawTransaction({
 *         to: req.asset,
 *         data: encodeTransferWithAuth(auth),
 *       });
 *       return { txHash: hash, pending: true };
 *     }
 *   };
 */
export interface PaymentBroadcaster {
  broadcast(input: {
    readonly authorization: PaymentPayload["payload"]["authorization"];
    readonly requirement: PaymentRequirement;
    readonly chainId: number;
  }): Promise<{
    readonly txHash: `0x${string}` | null;
    readonly pending: boolean;
  }>;
}

/**
 * Signature + attestation verifier for a specific platform stack.
 *
 * In production this wraps `AttestationVerifier` from
 * `@aethelred/wallet-compliance`. We take it as an interface to
 * keep this package independent of the full verifier's pinned
 * measurements list — different deployments pin different lists.
 */
export interface AttestationVerifier {
  verify(input: {
    readonly quote: TeeQuote;
    readonly requirement: NonNullable<PaymentRequirement["attestation"]>;
    readonly userData: `0x${string}`;
  }): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;
}

/**
 * Recover-signer callback. Facilitators plug in their preferred
 * library (viem's `recoverMessageAddress`, ethers' `verifyTypedData`,
 * or a Nitro-enclave-local verifier). We expose the struct hash
 * and signature — the callback returns the recovered address.
 *
 * Returning a lowercase address is the contract (EIP-55 checksum
 * is a display convention; facilitators compare bytes).
 */
export type SignerRecovery = (input: {
  readonly structHash: `0x${string}`;
  readonly domainSeparator: `0x${string}`;
  readonly signature: `0x${string}`;
}) => Promise<`0x${string}`>;

export interface VerifyPaymentRequest {
  /** The matched requirement from the server's advertised list. */
  readonly requirement: PaymentRequirement;
  /** Raw (base64) `X-PAYMENT` header. */
  readonly paymentHeader: string;
  /** Raw (base64) `X-PAYMENT-ATTESTATION` header, if present. */
  readonly attestationHeader?: string;
  /** Recovery adapter for signature verification. */
  readonly recover: SignerRecovery;
  /** Required when the requirement carries an `attestation` block. */
  readonly attestationVerifier?: AttestationVerifier;
  /** Wall clock override; mainly for tests. */
  readonly nowSeconds?: number;
}

export interface VerifyPaymentResult {
  readonly payment: PaymentPayload;
  readonly attestation?: PaymentAttestationPayload;
  /** Recovered signer address — facilitators use it for audit log + rate limiting. */
  readonly signerAddress: `0x${string}`;
  /** Canonical payment id (paymentId in PaymentReceipt). */
  readonly paymentId: `0x${string}`;
}

/**
 * Verify a payment (signature + authorization validity + optional
 * attestation binding). Does NOT broadcast — that's the
 * `broadcastVerifiedPayment` step below. Separating them lets
 * facilitators run all verification in parallel and batch broadcasts.
 */
export async function verifyPayment(
  req: VerifyPaymentRequest,
): Promise<VerifyPaymentResult> {
  const payment = parsePaymentHeader(req.paymentHeader);

  if (payment.network !== req.requirement.network) {
    throw new FacilitatorError(
      "facilitator-rejected",
      `Payment network (${payment.network}) does not match requirement network (${req.requirement.network})`,
      { httpStatus: 402 },
    );
  }
  if (payment.scheme !== req.requirement.scheme) {
    throw new FacilitatorError(
      "facilitator-rejected",
      `Payment scheme (${payment.scheme}) does not match requirement scheme (${req.requirement.scheme})`,
      { httpStatus: 402 },
    );
  }

  const { authorization } = payment.payload;
  const now = req.nowSeconds ?? Math.floor(Date.now() / 1000);

  // Validity window
  const validAfter = Number(authorization.validAfter);
  const validBefore = Number(authorization.validBefore);
  if (!Number.isFinite(validAfter) || !Number.isFinite(validBefore)) {
    throw new FacilitatorError(
      "facilitator-rejected",
      `validAfter/validBefore are not finite numbers`,
      { httpStatus: 402 },
    );
  }
  if (now < validAfter) {
    throw new FacilitatorError(
      "facilitator-rejected",
      `Authorization not yet valid (validAfter=${validAfter}, now=${now})`,
      { httpStatus: 402 },
    );
  }
  if (now >= validBefore) {
    throw new FacilitatorError(
      "facilitator-rejected",
      `Authorization expired (validBefore=${validBefore}, now=${now})`,
      { httpStatus: 402 },
    );
  }

  // Amount & recipient sanity
  if (authorization.to.toLowerCase() !== req.requirement.payTo.toLowerCase()) {
    throw new FacilitatorError(
      "facilitator-rejected",
      `Authorization 'to' (${authorization.to}) does not match requirement payTo`,
      { httpStatus: 402 },
    );
  }
  if (BigInt(authorization.value) > BigInt(req.requirement.maxAmountRequired)) {
    throw new FacilitatorError(
      "facilitator-rejected",
      `Authorization value exceeds maxAmountRequired`,
      { httpStatus: 402 },
    );
  }

  // Recompute struct hash; MUST match what client claimed
  const recomputedHash = computeTransferAuthStructHash(authorization);
  if (recomputedHash !== payment.payload.structHash) {
    throw new FacilitatorError(
      "facilitator-rejected",
      "Client-supplied structHash does not match recomputed value",
      { httpStatus: 402 },
    );
  }

  // Recover the signer address
  const chainId = chainIdForNetwork(payment.network);
  const domainSeparator = computeDomainSeparator({
    name:
      typeof req.requirement.extra?.name === "string"
        ? (req.requirement.extra.name as string)
        : "USD Coin",
    version:
      typeof req.requirement.extra?.version === "string"
        ? (req.requirement.extra.version as string)
        : "2",
    chainId,
    verifyingContract: req.requirement.asset,
  });
  const signer = await req.recover({
    structHash: recomputedHash,
    domainSeparator,
    signature: authorization.signature,
  });
  if (signer.toLowerCase() !== authorization.from.toLowerCase()) {
    throw new FacilitatorError(
      "facilitator-rejected",
      `Signature recovered to ${signer}, expected ${authorization.from}`,
      { httpStatus: 402 },
    );
  }

  // Attestation gate
  let attestation: PaymentAttestationPayload | undefined;
  if (req.requirement.attestation) {
    if (!req.attestationHeader) {
      throw new FacilitatorError(
        "facilitator-rejected",
        "Receiver requires attestation but X-PAYMENT-ATTESTATION was not supplied",
        { httpStatus: 402 },
      );
    }
    if (!req.attestationVerifier) {
      throw new X402Error(
        "attestation-verification-failed",
        "Facilitator has no AttestationVerifier configured for an attestation-required receiver",
      );
    }
    attestation = decodeAttestationHeader(req.attestationHeader);
    const bindingOk = verifyBindingHash({
      structHash: recomputedHash,
      quote: attestation.quote,
      claimedBindingHash: attestation.bindingHash,
    });
    if (!bindingOk) {
      throw new FacilitatorError(
        "facilitator-rejected",
        "Attestation binding hash does not bind to this payment",
        { httpStatus: 402 },
      );
    }
    const verifyResult = await req.attestationVerifier.verify({
      quote: attestation.quote,
      requirement: req.requirement.attestation,
      userData: recomputedHash,
    });
    if (!verifyResult.ok) {
      throw new FacilitatorError(
        "facilitator-rejected",
        `TEE attestation failed: ${verifyResult.reason}`,
        { httpStatus: 402 },
      );
    }
  }

  return {
    payment,
    attestation,
    signerAddress: signer.toLowerCase() as `0x${string}`,
    paymentId: recomputedHash,
  };
}

/**
 * Broadcast a verified payment and produce the final receipt.
 *
 * Splitting verify + broadcast lets facilitators:
 *   - Parallelize verification across many incoming requests.
 *   - Batch broadcasts into bundler-friendly tranches.
 *   - Roll back verified-but-not-broadcast state cleanly on
 *     facilitator restart (no half-written on-chain state).
 */
export async function broadcastVerifiedPayment(input: {
  readonly verified: VerifyPaymentResult;
  readonly requirement: PaymentRequirement;
  readonly broadcaster: PaymentBroadcaster;
}): Promise<PaymentReceipt> {
  const chainId = chainIdForNetwork(input.verified.payment.network);
  const { txHash, pending } = await input.broadcaster.broadcast({
    authorization: input.verified.payment.payload.authorization,
    requirement: input.requirement,
    chainId,
  });

  const receipt: PaymentReceipt = {
    x402Version: 1,
    scheme: input.verified.payment.scheme,
    network: input.verified.payment.network,
    txHash,
    pending,
    acceptedAt: Math.floor(Date.now() / 1000),
    paymentId: input.verified.paymentId,
    attestationBindingHash: input.verified.attestation?.bindingHash,
  };
  return receipt;
}

/**
 * Encode a receipt for the `X-PAYMENT-RESPONSE` header.
 * Mirrors the client's encoder; kept symmetric so a single
 * canonicalization bug doesn't let verified payments through
 * with unverifiable receipts.
 */
export function encodeReceiptHeader(receipt: PaymentReceipt): string {
  const json = JSON.stringify(receipt);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ─── Header parsing ─────────────────────────────────────────────

function parsePaymentHeader(raw: string): PaymentPayload {
  let decoded: string;
  try {
    decoded = atob(raw);
  } catch (cause) {
    throw new FacilitatorError(
      "facilitator-rejected",
      "X-PAYMENT header is not valid base64",
      { httpStatus: 402, cause },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch (cause) {
    throw new FacilitatorError(
      "facilitator-rejected",
      "X-PAYMENT header is not valid JSON",
      { httpStatus: 402, cause },
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { x402Version?: unknown }).x402Version !== 1 ||
    typeof (parsed as { payload?: unknown }).payload !== "object" ||
    (parsed as { payload: { authorization?: unknown } }).payload.authorization === null
  ) {
    throw new FacilitatorError(
      "facilitator-rejected",
      "X-PAYMENT header does not match PaymentPayload shape",
      { httpStatus: 402 },
    );
  }
  return parsed as PaymentPayload;
}

/**
 * Compute the EIP-712 domain separator for EIP-3009 verification.
 *
 *     keccak256(
 *       abi.encode(
 *         keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
 *         keccak256(name), keccak256(version), chainId, verifyingContract
 *       )
 *     )
 */
function computeDomainSeparator(input: {
  readonly name: string;
  readonly version: string;
  readonly chainId: number;
  readonly verifyingContract: `0x${string}`;
}): `0x${string}` {
  // Hoisted import inside the function to avoid top-of-file
  // circular dep risk with eip3009.ts. Unused elsewhere.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { keccak_256 } = require("@noble/hashes/sha3.js") as { keccak_256: (b: Uint8Array) => Uint8Array };
  const utf8 = (s: string) => new TextEncoder().encode(s);
  const typeHash = keccak_256(
    utf8(
      "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
    ),
  );
  const nameHash = keccak_256(utf8(input.name));
  const versionHash = keccak_256(utf8(input.version));

  const out = new Uint8Array(32 * 5);
  out.set(typeHash, 0);
  out.set(nameHash, 32);
  out.set(versionHash, 64);
  // chainId u256 big-endian
  let n = BigInt(input.chainId);
  for (let i = 32 * 4 - 1; i >= 96 && n > 0n; i -= 1) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  // verifyingContract (20 bytes right-aligned in 32-byte slot)
  const addrBytes = hexToBytes(input.verifyingContract as `0x${string}`);
  out.set(addrBytes, 32 * 5 - 20);

  const digest = keccak_256(out);
  const hex = Array.from(digest)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return ("0x" + hex) as `0x${string}`;
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const s = hex.slice(2);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
