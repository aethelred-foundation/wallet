/**
 * Notary contract ABI constants.
 *
 * Selectors + event topic0 hashes derived at module load from
 * signature strings — same pattern as `@aethelred/wallet-agent-
 * budget`. If the on-chain signature ever changes, the TS selector
 * updates with a single edit to the signature string.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function bytesToHexPrefixed(bytes: Uint8Array): `0x${string}` {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out as `0x${string}`;
}

function selectorOf(signature: string): `0x${string}` {
  return bytesToHexPrefixed(keccak_256(utf8(signature)).slice(0, 4));
}

function topicOf(signature: string): `0x${string}` {
  return bytesToHexPrefixed(keccak_256(utf8(signature)));
}

// ─── Function signatures + selectors ─────────────────────

export const SIG_ANCHOR = "anchor(bytes32,uint32)" as const;
export const SIG_GET_BATCH = "getBatch(uint256)" as const;
export const SIG_NEXT_BATCH_ID = "nextBatchId()" as const;

export const SELECTOR_ANCHOR = selectorOf(SIG_ANCHOR);
export const SELECTOR_GET_BATCH = selectorOf(SIG_GET_BATCH);
export const SELECTOR_NEXT_BATCH_ID = selectorOf(SIG_NEXT_BATCH_ID);

// ─── Event topic0s ───────────────────────────────────────

export const SIG_EVENT_BATCH_ANCHORED =
  "BatchAnchored(uint256,address,bytes32,uint64,uint32)" as const;

export const TOPIC_BATCH_ANCHORED = topicOf(SIG_EVENT_BATCH_ANCHORED);
