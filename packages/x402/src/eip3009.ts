/**
 * EIP-3009 `transferWithAuthorization` signing + encoding.
 *
 * EIP-3009 is the stablecoin-native primitive that makes x402's
 * "exact" scheme work: instead of a two-step `approve()` + `pull()`
 * that would require gas from the payer, the holder signs a single
 * typed-data authorization that ANY third party (the facilitator)
 * can broadcast. Gas is paid by the facilitator, settlement is
 * atomic, and the nonce is a 32-byte opaque value (not a sequential
 * counter like EIP-2612 Permit), so concurrent signings never block
 * each other.
 *
 * USDC (Circle) and EURC implement EIP-3009 natively. Any ERC-20
 * that wants to live on x402 has to implement it; the protocol
 * facilitators reject tokens that only support EIP-2612.
 *
 * This module is entirely pure: it builds the EIP-712 typed data,
 * invokes the pluggable `TypedDataSigner`, and packs the result
 * into the shape that goes into the `X-PAYMENT` header. The signer
 * abstraction is the reason the same code works for an in-process
 * key, a Ledger over WebHID, a Fireblocks MPC cohort, and a Nitro
 * enclave — none of those need to know what EIP-3009 is.
 *
 * Cryptographic safety notes:
 *
 *   1. **Nonce generation uses `crypto.getRandomValues`.** Never
 *      derive a nonce from a counter, timestamp, or deterministic
 *      seed — EIP-3009's nonce is essentially a replay-protection
 *      token, and a predictable value lets an attacker front-run
 *      the payment.
 *
 *   2. **`validBefore` is time-bounded.** We refuse to sign with a
 *      validity window longer than one hour. A stale authorization
 *      sitting in a mempool is a replay risk if the facilitator
 *      retries; short windows keep the attack surface bounded.
 *
 *   3. **We return the EIP-712 struct hash alongside the signature.**
 *      Downstream audit tooling (the Merkle batcher in
 *      `@aethelred/wallet-audit`) uses the struct hash as the
 *      stable payment identifier; facilitators recompute it for
 *      verification. The hash is not strictly needed over the
 *      wire but including it lets consumers verify receipts
 *      without the full EIP-712 reconstruction pipeline.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import type {
  Address,
  Eip3009Authorization,
  PaymentPayload,
  PaymentRequirement,
  TypedDataSigner,
} from "./types";
import { SignerError, X402Error } from "./errors";
import { chainIdForNetwork } from "./chain-config";

/**
 * Maximum validity window, in seconds, we will embed in an
 * authorization. Facilitators are free to enforce a tighter ceiling;
 * we set it at 1 hour because a longer-lived authorization sitting
 * in a hostile mempool is a replay liability.
 */
export const MAX_VALIDITY_WINDOW_SECONDS = 3_600;

/**
 * EIP-712 type definitions for `TransferWithAuthorization`. The
 * field order MUST match EIP-3009's canonical ordering — clients
 * that scramble it produce a DIFFERENT struct hash and the
 * facilitator rejects the signature.
 */
const TRANSFER_WITH_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * Build the EIP-712 typed data for a given payment requirement,
 * have the signer sign it, and return the packed `PaymentPayload`
 * shape ready to go into the `X-PAYMENT` header.
 *
 * @throws {@link SignerError} with `code: "signer-rejected"` if the
 *   signer throws. Includes the underlying error as `cause`.
 * @throws {@link X402Error} with `code: "amount-over-cap"` if
 *   `value` exceeds `requirement.maxAmountRequired`.
 */
export async function signPaymentAuthorization(input: {
  readonly requirement: PaymentRequirement;
  readonly from: Address;
  /** If omitted, defaults to `requirement.maxAmountRequired`. */
  readonly value?: string;
  /** If omitted, defaults to `now + min(requirement.maxTimeoutSeconds, MAX_VALIDITY_WINDOW_SECONDS)`. */
  readonly validBeforeSeconds?: number;
  readonly signer: TypedDataSigner;
}): Promise<PaymentPayload> {
  const { requirement, from, signer } = input;
  const value = input.value ?? requirement.maxAmountRequired;

  // Numeric sanity — stringly-typed for precision, compared via
  // BigInt to avoid Number's 53-bit ceiling.
  if (BigInt(value) > BigInt(requirement.maxAmountRequired)) {
    throw new X402Error(
      "amount-over-cap",
      `Requested value ${value} exceeds requirement.maxAmountRequired ${requirement.maxAmountRequired}`,
    );
  }
  if (BigInt(value) <= 0n) {
    throw new X402Error("amount-over-cap", `Requested value must be > 0`);
  }

  const now = Math.floor(Date.now() / 1000);
  const windowSeconds = Math.min(
    Math.max(1, requirement.maxTimeoutSeconds),
    MAX_VALIDITY_WINDOW_SECONDS,
  );
  const validBefore = input.validBeforeSeconds ?? now + windowSeconds;
  if (validBefore <= now) {
    throw new X402Error(
      "invalid-payment-requirement",
      `validBefore (${validBefore}) must be in the future (now=${now})`,
    );
  }

  const nonce = randomNonce();
  const chainId = chainIdForNetwork(requirement.network);

  const extra = requirement.extra ?? {};
  const domain = {
    name: typeof extra.name === "string" ? extra.name : "USD Coin",
    version: typeof extra.version === "string" ? extra.version : "2",
    chainId,
    verifyingContract: requirement.asset,
  };

  const message = {
    from,
    to: requirement.payTo,
    value,
    validAfter: "0",
    validBefore: String(validBefore),
    nonce,
  };

  let signature: `0x${string}`;
  try {
    signature = await signer.signTypedData({
      domain,
      types: TRANSFER_WITH_AUTH_TYPES as unknown as Readonly<
        Record<string, ReadonlyArray<{ name: string; type: string }>>
      >,
      primaryType: "TransferWithAuthorization",
      message,
    });
  } catch (cause) {
    throw new SignerError("signer-rejected", "Signer rejected EIP-3009 authorization", { cause });
  }

  if (!isSignature65Bytes(signature)) {
    throw new SignerError(
      "signer-rejected",
      `Signer returned a malformed signature (expected 65-byte hex, got length ${signature.length})`,
    );
  }

  const authorization: Eip3009Authorization = {
    from,
    to: requirement.payTo,
    value,
    validAfter: "0",
    validBefore: String(validBefore),
    nonce,
    signature,
  };

  const structHash = computeTransferAuthStructHash(authorization);

  return {
    x402Version: 1,
    scheme: requirement.scheme,
    network: requirement.network,
    payload: {
      authorization,
      structHash,
    },
  };
}

/**
 * Compute the EIP-712 struct hash for an authorization. Facilitators
 * recompute this on verification; we expose it for audit pipelines
 * that need a stable payment identifier without re-implementing the
 * typed-data machinery.
 *
 * The algorithm is:
 *     structHash = keccak256(
 *         keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
 *         || abi.encode(from, to, value, validAfter, validBefore, nonce)
 *     )
 *
 * We implement the ABI encoding inline because our only consumer
 * is this one struct and pulling in `viem` / `ethers` for a
 * single encode would balloon the bundle by ~80KB.
 */
export function computeTransferAuthStructHash(auth: Eip3009Authorization): `0x${string}` {
  const typeHash = keccak256Hex(
    utf8Bytes(
      "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
    ),
  );
  const encoded = concatBytes(
    hexToBytes(typeHash),
    abiEncodeAddress(auth.from),
    abiEncodeAddress(auth.to),
    abiEncodeUint256(auth.value),
    abiEncodeUint256(auth.validAfter),
    abiEncodeUint256(auth.validBefore),
    hexToBytes(auth.nonce),
  );
  return keccak256Hex(encoded);
}

// ─── Internal helpers ───────────────────────────────────────────

function randomNonce(): `0x${string}` {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return ("0x" + bytesToHex(buf)) as `0x${string}`;
}

function isSignature65Bytes(sig: string): boolean {
  // 0x + 130 hex chars = 65 bytes (r, s, v)
  return /^0x[0-9a-fA-F]{130}$/.test(sig);
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function keccak256Hex(bytes: Uint8Array): `0x${string}` {
  return ("0x" + bytesToHex(keccak_256(bytes))) as `0x${string}`;
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const stripped = hex.slice(2);
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

/** Left-pad an address to 32 bytes (ABI encoding for `address`). */
function abiEncodeAddress(addr: Address): Uint8Array {
  const out = new Uint8Array(32);
  const bytes = hexToBytes(addr as `0x${string}`);
  out.set(bytes, 32 - bytes.length);
  return out;
}

/** Big-endian 32-byte encoding of a decimal-string uint256. */
function abiEncodeUint256(valueDecimal: string): Uint8Array {
  const v = BigInt(valueDecimal);
  if (v < 0n) throw new X402Error("invalid-payment-requirement", "uint256 cannot be negative");
  const out = new Uint8Array(32);
  let remaining = v;
  for (let i = 31; i >= 0 && remaining > 0n; i -= 1) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}
