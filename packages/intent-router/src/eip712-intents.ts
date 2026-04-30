/**
 * EIP-712 typed-data definitions for intents.
 *
 * Every intent is signed under a stable domain separator so solvers
 * and settlement contracts can verify the signature byte-for-byte.
 * The domain pins chainId into the signed preimage — a signature on
 * Base cannot be replayed on Ethereum mainnet.
 *
 * Struct layout (one per intent kind, all share the same envelope):
 *
 *     Envelope(
 *       bytes32 id,
 *       address creator,
 *       uint256 chainId,
 *       bytes32 nonce,
 *       uint256 deadline,
 *       bytes32 attestationBinding
 *     )
 *
 *     TransferIntent(
 *       Envelope envelope,
 *       address asset, uint256 amount, address recipient
 *     )
 *     SwapIntent(
 *       Envelope envelope,
 *       address sellAsset, uint256 sellAmount,
 *       address buyAsset, uint256 minBuyAmount,
 *       address recipient, uint256 slippageBps
 *     )
 *     PaymentIntent(
 *       Envelope envelope,
 *       address asset, uint256 maxAmount,
 *       address merchant, string resource, string description
 *     )
 *
 * The `id` field on the envelope is the keccak256 of the canonical
 * encoding of `(envelope-without-id || body)` so it doubles as a
 * stable intent identifier — solvers log, cache, and deduplicate
 * by id.
 *
 * We keep the struct definitions in one place so the signer and the
 * verifier cannot drift apart. Every other module imports from here.
 */

import type {
  TypedDataDomain,
  TypedDataField,
  TypedDataRequest,
} from "@aethelred/wallet-custody-adapters";

import type { IntentBody, IntentEnvelope, IntentKind } from "./types";

/** Stable EIP-712 domain. `chainId` is filled in per intent. */
export const INTENT_DOMAIN_NAME = "AethelredIntentRouter" as const;
export const INTENT_DOMAIN_VERSION = "1" as const;

/**
 * Per-intent domain — callers pass the verifying contract or leave
 * it zero for off-chain-only routing flows. `chainId` is required
 * and pins the signature to a specific chain.
 */
export function intentDomain(params: {
  readonly chainId: number;
  readonly verifyingContract?: `0x${string}`;
}): TypedDataDomain {
  return {
    name: INTENT_DOMAIN_NAME,
    version: INTENT_DOMAIN_VERSION,
    chainId: params.chainId,
    verifyingContract:
      params.verifyingContract ?? ("0x0000000000000000000000000000000000000000" as const),
  };
}

// ─── Struct definitions ─────────────────────────────────────────

const ENVELOPE_FIELDS: ReadonlyArray<TypedDataField> = [
  { name: "creator", type: "address" },
  { name: "chainId", type: "uint256" },
  { name: "nonce", type: "bytes32" },
  { name: "deadline", type: "uint256" },
  { name: "attestationBinding", type: "bytes32" },
];

const TRANSFER_FIELDS: ReadonlyArray<TypedDataField> = [
  { name: "envelope", type: "Envelope" },
  { name: "asset", type: "address" },
  { name: "amount", type: "uint256" },
  { name: "recipient", type: "address" },
];

/**
 * Swap intent EIP-712 fields. Carries BOTH direction's amount
 * fields (PR #118) — exact-input intents populate `sellAmount` +
 * `minBuyAmount` and zero out `buyAmount` + `maxSellAmount`;
 * exact-output intents do the inverse. The `direction`
 * discriminator field tags which set is meaningful.
 *
 * EIP-712 requires every field in the schema to be present at
 * sign time; `buildMessage` below normalizes undefined amount
 * fields to "0" before hashing.
 */
const SWAP_FIELDS: ReadonlyArray<TypedDataField> = [
  { name: "envelope", type: "Envelope" },
  { name: "sellAsset", type: "address" },
  { name: "sellAmount", type: "uint256" },
  { name: "buyAsset", type: "address" },
  { name: "minBuyAmount", type: "uint256" },
  { name: "buyAmount", type: "uint256" },
  { name: "maxSellAmount", type: "uint256" },
  { name: "direction", type: "string" },
  { name: "recipient", type: "address" },
  { name: "slippageBps", type: "uint256" },
];

const PAYMENT_FIELDS: ReadonlyArray<TypedDataField> = [
  { name: "envelope", type: "Envelope" },
  { name: "asset", type: "address" },
  { name: "maxAmount", type: "uint256" },
  { name: "merchant", type: "address" },
  { name: "resource", type: "string" },
  { name: "description", type: "string" },
];

/**
 * Mapping from intent kind to EIP-712 primaryType + struct definitions.
 * Exported so tests can introspect the struct layout and callers can
 * build their own typed-data requests for specialised flows.
 */
export const INTENT_STRUCTS: Readonly<
  Record<IntentKind, { primaryType: string; types: Record<string, ReadonlyArray<TypedDataField>> }>
> = Object.freeze({
  transfer: {
    primaryType: "TransferIntent",
    types: {
      Envelope: ENVELOPE_FIELDS,
      TransferIntent: TRANSFER_FIELDS,
    },
  },
  swap: {
    primaryType: "SwapIntent",
    types: {
      Envelope: ENVELOPE_FIELDS,
      SwapIntent: SWAP_FIELDS,
    },
  },
  payment: {
    primaryType: "PaymentIntent",
    types: {
      Envelope: ENVELOPE_FIELDS,
      PaymentIntent: PAYMENT_FIELDS,
    },
  },
});

// ─── Builder ────────────────────────────────────────────────────

/**
 * Build an EIP-712 `TypedDataRequest` for an intent. The request is
 * what a `TypedDataSigner` consumes — so the same custody adapter
 * that signs an x402 payment can sign an intent.
 *
 * Takes the envelope WITHOUT the `id` and `signature` fields (those
 * get filled in post-signing). Exported separately from
 * `buildIntentRequest` (which takes the full Intent shape) so
 * callers can compute the struct hash without having to stuff
 * placeholder id/signature values in.
 */
export function buildUnsignedIntentRequest(
  body: IntentBody,
  envelopeWithoutIdSig: Omit<IntentEnvelope, "id" | "signature">,
  opts: { readonly verifyingContract?: `0x${string}` } = {},
): TypedDataRequest {
  const spec = INTENT_STRUCTS[body.kind];
  const envelopeValues = {
    creator: envelopeWithoutIdSig.creator,
    chainId: envelopeWithoutIdSig.chainId,
    nonce: envelopeWithoutIdSig.nonce,
    deadline: envelopeWithoutIdSig.deadline,
    attestationBinding:
      envelopeWithoutIdSig.attestationBinding ?? (`0x${"00".repeat(32)}` as `0x${string}`),
  };

  const message = buildMessage(body, envelopeValues);

  return {
    domain: intentDomain({
      chainId: envelopeWithoutIdSig.chainId,
      verifyingContract: opts.verifyingContract,
    }),
    types: spec.types,
    primaryType: spec.primaryType,
    message,
  };
}

function buildMessage(
  body: IntentBody,
  envelopeValues: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  switch (body.kind) {
    case "transfer":
      return {
        envelope: envelopeValues,
        asset: body.asset,
        amount: body.amount,
        recipient: body.recipient,
      };
    case "swap":
      // PR #118: direction-aware shape. Both directions' amount
      // fields are part of the EIP-712 schema; the inactive
      // direction's fields are zero-padded so the hash is stable
      // regardless of which direction is in use.
      return {
        envelope: envelopeValues,
        sellAsset: body.sellAsset,
        sellAmount: body.sellAmount ?? "0",
        buyAsset: body.buyAsset,
        minBuyAmount: body.minBuyAmount ?? "0",
        buyAmount: body.buyAmount ?? "0",
        maxSellAmount: body.maxSellAmount ?? "0",
        direction: body.direction ?? "exact-input",
        recipient: body.recipient,
        slippageBps: body.slippageBps ?? 0,
      };
    case "payment":
      return {
        envelope: envelopeValues,
        asset: body.asset,
        maxAmount: body.maxAmount,
        merchant: body.merchant,
        resource: body.resource,
        description: body.description ?? "",
      };
    default: {
      const _exhaustive: never = body;
      throw new Error(`Unknown intent body kind: ${(_exhaustive as { kind: string }).kind}`);
    }
  }
}
