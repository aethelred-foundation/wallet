/**
 * x402 + TEE-Attested Payment — type surface.
 *
 * This module models the wire shapes of the x402 protocol
 * (https://x402.org) plus the Aethelred extension that binds every
 * payment to a fresh TEE attestation quote. The extension is
 * **wire-backwards-compatible**: a vanilla x402 facilitator that does
 * not know about TEE attestation will simply ignore the extra header,
 * and an Aethelred facilitator that requires attestation will return
 * `402` with a typed `attestation_required` discriminator until the
 * client re-tries with a valid quote.
 *
 * Design goals for this file:
 *
 *   1. **Transport-agnostic.** We model the JSON bodies, not
 *      `fetch()`/`Response`. Transports are bolted on in `client.ts`
 *      and `facilitator.ts`.
 *   2. **Branded / opaque chain identifiers.** `Address` is a
 *      literal-typed `0x${string}` so that passing a raw `string`
 *      where an address is required is a compile error — enforced
 *      by our type narrowing, not by a runtime regex.
 *   3. **No `any`.** Every discriminated union is exhaustive; the
 *      exhaustiveness-checker in `@aethelred/wallet-observability`
 *      catches added variants at compile time.
 *   4. **Payment and attestation are distinct wire-level concepts.**
 *      A receiver may require only payment (vanilla x402), only
 *      attestation (a metering layer that doesn't take money), or
 *      both (the default for regulated receivers). The types
 *      reflect this by keeping the attestation requirement as its
 *      own optional field on `PaymentRequirement`.
 *
 * @packageDocumentation
 */

import type { TeeQuote } from "@aethelred/wallet-compliance";

/**
 * Ethereum address. We alias instead of re-declaring so that the
 * inevitable TS 7 tightening around template-literal types does
 * not require touching every file in the tree.
 *
 * Prefer `asAddress()` in `./address.ts` over manual casts.
 */
export type Address = `0x${string}`;

/**
 * Supported x402 payment schemes.
 *
 * `exact` — the client pays the exact amount the resource requires.
 *           Corresponds to a single EIP-3009 transferWithAuthorization
 *           signed for `maxAmountRequired`.
 *
 * `upto`  — (future) client authorizes up-to a cap, facilitator
 *           debits only what the resource metered. Requires an
 *           on-chain escrow; not implemented in v0.1 because the
 *           wire format for mass adoption has not stabilized.
 */
export type PaymentScheme = "exact" | "upto";

/**
 * Chain identifier in the narrow CAIP-10 form we use throughout
 * the wallet. Keep as a literal union so a typo in `"base-mainet"`
 * is a compile error, not a runtime "unknown network" response
 * from the facilitator.
 *
 * Reserved testnet slugs are included explicitly; adding a new
 * network means adding one line here and ONE more in
 * `./chain-config.ts`. The compile error that surfaces in every
 * dependent file is the feature — it forces a full audit of
 * consumer code when a chain is added.
 */
export type PaymentNetwork =
  | "base-mainnet"
  | "base-sepolia"
  | "polygon-mainnet"
  | "polygon-amoy"
  | "arbitrum-mainnet"
  | "arbitrum-sepolia"
  | "optimism-mainnet"
  | "optimism-sepolia"
  | "ethereum-mainnet"
  | "ethereum-sepolia";

/**
 * TEE attestation requirement that a receiver can attach to a
 * payment requirement.
 *
 * This is the Aethelred extension to x402. A vanilla x402 server
 * never emits this block; receivers that care about caller code
 * integrity include it. The shape intentionally mirrors the
 * `AttestationVerifier` constructor options so a receiver can
 * declare once and the client can feed the requirement directly
 * to its own local verifier for a pre-flight check.
 *
 * @example Require AWS Nitro Enclave with a pinned measurement
 * ```ts
 * const req: AttestationRequirement = {
 *   allowedPlatforms: ["aws-nitro"],
 *   minSecurityVersion: { "aws-nitro": 2 },
 *   expectedMeasurements: [{
 *     platform: "aws-nitro",
 *     mrEnclave: "0xabc...",
 *   }],
 *   maxAgeSeconds: 600,
 * };
 * ```
 */
export interface AttestationRequirement {
  /** Platforms the receiver accepts (intersected with client's). */
  readonly allowedPlatforms: ReadonlyArray<
    "intel-tdx" | "amd-sev-snp" | "aws-nitro" | "gcp-confidential-space" | "azure-attestation"
  >;

  /** Per-platform minimum security version. Quotes below this are rejected. */
  readonly minSecurityVersion?: Readonly<Record<string, number>>;

  /**
   * Pinned measurements the quote must match. If ANY entry matches,
   * the quote passes. Empty or omitted = any measurement accepted
   * (useful for "TEE-any-code" tier that still proves hardware
   * isolation even if the code hasn't been audited).
   */
  readonly expectedMeasurements?: ReadonlyArray<{
    readonly platform: string;
    readonly mrEnclave?: string;
    readonly mrSigner?: string;
  }>;

  /** Maximum quote age in seconds. Default 600 (10 min) if omitted. */
  readonly maxAgeSeconds?: number;

  /**
   * If `true`, the receiver requires a *fresh* quote per call (not
   * a cached one from a prior payment). Clients that honor this
   * must refresh their `TeeQuote` before each call; receivers that
   * set this will reject any quote older than ~5s to give just
   * enough time for network round-trip.
   */
  readonly perCallFreshness?: boolean;
}

/**
 * Single payment requirement in a 402 response.
 *
 * A 402 response can list multiple requirements (e.g. "pay 0.01 USDC
 * on Base OR 0.015 USDC on Polygon"); the client picks one. This
 * shape is the exact v1 x402 wire format with the Aethelred
 * extension `attestation` appended.
 */
export interface PaymentRequirement {
  /** Always "exact" in v0.1. */
  readonly scheme: PaymentScheme;

  /** Which chain the payment is settled on. */
  readonly network: PaymentNetwork;

  /**
   * Max amount in the asset's smallest unit (e.g. 1 USDC = 1_000_000
   * because USDC has 6 decimals). String to avoid JS number precision
   * loss for large amounts.
   */
  readonly maxAmountRequired: string;

  /** Fully-qualified URL of the resource being paid for. */
  readonly resource: string;

  /** Short human-readable description — shown in UI / audit trail. */
  readonly description: string;

  /** MIME type of the expected response. */
  readonly mimeType?: string;

  /** Recipient address. */
  readonly payTo: Address;

  /** How long the signature is valid, in seconds from now. */
  readonly maxTimeoutSeconds: number;

  /** Asset contract (e.g. USDC address on the given network). */
  readonly asset: Address;

  /** Asset metadata (name + version, for EIP-712 domain construction). */
  readonly extra?: Readonly<Record<string, unknown>>;

  /**
   * Aethelred TEE-attestation requirement. OMITTED in vanilla x402;
   * present when the receiver is a compliance-native service that
   * demands caller code integrity proof.
   */
  readonly attestation?: AttestationRequirement;
}

/**
 * Full 402 response body.
 *
 * The `accepts` array is semantically "any one of" — the client picks
 * the requirement that best matches its context (cheapest, fastest,
 * network it already has balance on).
 */
export interface PaymentRequirementsResponse {
  /** Protocol version — only `1` exists today. */
  readonly x402Version: 1;

  /** Requirements the client may fulfill to unlock the resource. */
  readonly accepts: ReadonlyArray<PaymentRequirement>;

  /** Optional human-readable error that accompanied the 402. */
  readonly error?: string;
}

/**
 * EIP-3009 `transferWithAuthorization` payload. This is exactly what
 * gets signed by the agent's key and forwarded to the facilitator,
 * which broadcasts it on-chain.
 *
 * `nonce` is a 32-byte opaque value; clients MUST use a CSPRNG to
 * generate it. Reusing a nonce with the same `from` address can
 * result in the facilitator rejecting the payment as a replay.
 */
export interface Eip3009Authorization {
  readonly from: Address;
  readonly to: Address;
  /** Amount in asset's smallest unit, stringified to avoid precision loss. */
  readonly value: string;
  /** Unix seconds. `0` means "valid immediately". */
  readonly validAfter: string;
  /** Unix seconds. Must be in the future at sign time. */
  readonly validBefore: string;
  /** 32-byte random hex (`0x` + 64 chars). */
  readonly nonce: `0x${string}`;
  /** EIP-712 signature bytes, hex-encoded with `0x` prefix (65 bytes). */
  readonly signature: `0x${string}`;
}

/**
 * Full `X-PAYMENT` header payload.
 *
 * The client base64-encodes the JSON form of this struct and puts it
 * in the `X-PAYMENT` header of the retry request. The facilitator
 * base64-decodes + JSON-parses it back into this shape.
 */
export interface PaymentPayload {
  /** Always 1 in v0.1. */
  readonly x402Version: 1;

  /** Which scheme the client chose. */
  readonly scheme: PaymentScheme;

  /** Which network the client is paying on. */
  readonly network: PaymentNetwork;

  /** Signed EIP-3009 authorization. */
  readonly payload: {
    readonly authorization: Eip3009Authorization;
    /**
     * `0x`-prefixed hex encoding of the EIP-712 struct hash the
     * signature covers. Redundant with the signature (facilitators
     * recompute it) but included so audit tooling can verify
     * receipts without the full EIP-712 reconstruction pipeline.
     */
    readonly structHash: `0x${string}`;
  };
}

/**
 * The `X-PAYMENT-ATTESTATION` header payload.
 *
 * Carries the caller's TEE quote + the binding between the quote and
 * this specific payment. The facilitator verifies:
 *   (a) the quote itself via `AttestationVerifier`,
 *   (b) the binding: `quoteBindingHash === sha256(structHash || quoteDigest)`.
 * The binding prevents a MITM from stapling a valid quote from a
 * different agent onto a valid signature from this one.
 */
export interface PaymentAttestationPayload {
  readonly x402Version: 1;

  /** Full TEE quote — same shape as `@aethelred/wallet-compliance`. */
  readonly quote: TeeQuote;

  /**
   * `sha256(structHash || sha256(quoteBytes))`, hex-encoded. This is
   * the binding: it proves the quote and the payment were generated
   * together and not re-combined. Facilitators MUST verify this
   * before accepting either one.
   */
  readonly bindingHash: `0x${string}`;
}

/**
 * Facilitator verification + broadcast receipt.
 *
 * Returned in the `X-PAYMENT-RESPONSE` header of the 200 that follows
 * a successful 402 → pay → retry sequence. The client keeps it as the
 * canonical record of payment for audit.
 */
export interface PaymentReceipt {
  readonly x402Version: 1;

  /** Which scheme was settled. */
  readonly scheme: PaymentScheme;

  /** Network the payment settled on. */
  readonly network: PaymentNetwork;

  /**
   * On-chain transaction hash. May be `null` if the facilitator is
   * still in a pre-broadcast state (e.g. "queued for next batch") —
   * in that case `pending` is `true`.
   */
  readonly txHash: `0x${string}` | null;

  /** `true` until the facilitator has a confirmed inclusion. */
  readonly pending: boolean;

  /** Unix seconds of facilitator-side acceptance. */
  readonly acceptedAt: number;

  /** `sha256(structHash)` — stable cross-facilitator payment id. */
  readonly paymentId: `0x${string}`;

  /**
   * If attestation was required, the facilitator echoes back the
   * binding hash it verified. Clients MUST confirm it matches the
   * one they submitted; a mismatch is evidence of a facilitator
   * that doesn't actually check attestations (even though it
   * claims to).
   */
  readonly attestationBindingHash?: `0x${string}`;
}

/**
 * Signer contract — the pluggable custody seam.
 *
 * Every concrete custody backend (local key, Ledger HSM, Fireblocks
 * MPC, AWS Nitro enclave, Google Confidential Space) implements this
 * one method. The x402 client is agnostic to how the private key is
 * stored, only cares that the signer can produce an EIP-712 signature
 * over a typed payload.
 *
 * Returning a full 65-byte `0x`-prefixed signature (r || s || v) is
 * the simplest contract; the facilitator recovers the signer address
 * with `ecrecover`. Backends that return DER-encoded signatures
 * (HSMs) must convert before returning.
 */
export interface TypedDataSigner {
  /** Address this signer signs for. Used to populate `from` fields. */
  readonly address: Address;

  /**
   * Sign an EIP-712 typed struct. The domain separator, types, and
   * value are pre-built by the caller — the signer only hashes and
   * signs. Signing errors should throw a typed error from
   * `./errors.ts`, never a raw `Error`.
   */
  signTypedData(request: {
    readonly domain: TypedDataDomain;
    readonly types: Readonly<Record<string, ReadonlyArray<TypedDataField>>>;
    readonly primaryType: string;
    readonly message: Readonly<Record<string, unknown>>;
  }): Promise<`0x${string}`>;
}

/**
 * EIP-712 domain separator components. Kept loose (all optional) because
 * different assets specify different subsets — USDC uses name + version
 * + chainId + verifyingContract; some DAI forks also use salt.
 */
export interface TypedDataDomain {
  readonly name?: string;
  readonly version?: string;
  readonly chainId?: number | string;
  readonly verifyingContract?: Address;
  readonly salt?: `0x${string}`;
}

export interface TypedDataField {
  readonly name: string;
  readonly type: string;
}
