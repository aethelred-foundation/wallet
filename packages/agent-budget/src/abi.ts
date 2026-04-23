/**
 * AgentBudget ABI constants.
 *
 * Every function the contract exposes is listed here with its
 * canonical Solidity signature. Selectors are derived once at module
 * load via `keccak256(signature)[0..4]`. We keep the signature and
 * the selector right next to each other so auditors can eyeball the
 * derivation without consulting an external tool.
 *
 * Event topics (keccak256 of the event signature, no truncation) are
 * also derived here — the TS client uses them to decode logs.
 *
 * If the on-chain contract's signature ever changes, the TS selector
 * updates with a single change to the signature string — no hand-
 * editing hex.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";

// ─── Helpers ────────────────────────────────────────────────────

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function bytesToHexPrefixed(b: Uint8Array): `0x${string}` {
  let out = "0x";
  for (const byte of b) out += byte.toString(16).padStart(2, "0");
  return out as `0x${string}`;
}

function selectorOf(signature: string): `0x${string}` {
  const hash = keccak_256(utf8(signature));
  return bytesToHexPrefixed(hash.slice(0, 4));
}

function topicOf(eventSignature: string): `0x${string}` {
  const hash = keccak_256(utf8(eventSignature));
  return bytesToHexPrefixed(hash);
}

// ─── Function signatures ───────────────────────────────────────

export const SIG_CREATE_BUDGET =
  "createBudget(address,uint256,uint256,uint64)" as const;
export const SIG_UPDATE_CAPS = "updateCaps(uint256,uint256,uint256)" as const;
export const SIG_REVOKE_BUDGET = "revokeBudget(uint256)" as const;
export const SIG_GRANT_SESSION =
  "grantSession(uint256,address,uint64,uint256)" as const;
export const SIG_REVOKE_SESSION = "revokeSession(address)" as const;
export const SIG_SPEND = "spend(address,uint256,address)" as const;
export const SIG_REMAINING_IN_WINDOW = "remainingInWindow(uint256)" as const;
export const SIG_CAN_SPEND = "canSpend(address,uint256)" as const;

// ─── Function selectors ────────────────────────────────────────

export const SELECTOR_CREATE_BUDGET = selectorOf(SIG_CREATE_BUDGET);
export const SELECTOR_UPDATE_CAPS = selectorOf(SIG_UPDATE_CAPS);
export const SELECTOR_REVOKE_BUDGET = selectorOf(SIG_REVOKE_BUDGET);
export const SELECTOR_GRANT_SESSION = selectorOf(SIG_GRANT_SESSION);
export const SELECTOR_REVOKE_SESSION = selectorOf(SIG_REVOKE_SESSION);
export const SELECTOR_SPEND = selectorOf(SIG_SPEND);
export const SELECTOR_REMAINING_IN_WINDOW = selectorOf(SIG_REMAINING_IN_WINDOW);
export const SELECTOR_CAN_SPEND = selectorOf(SIG_CAN_SPEND);

// ─── Event signatures + topic0s ────────────────────────────────

export const SIG_EVENT_BUDGET_CREATED =
  "BudgetCreated(uint256,address,address,uint256,uint256,uint64)" as const;
export const SIG_EVENT_BUDGET_CAPS_UPDATED =
  "BudgetCapsUpdated(uint256,uint256,uint256)" as const;
export const SIG_EVENT_BUDGET_REVOKED = "BudgetRevoked(uint256)" as const;
export const SIG_EVENT_SESSION_GRANTED =
  "SessionGranted(uint256,address,uint64,uint256)" as const;
export const SIG_EVENT_SESSION_REVOKED = "SessionRevoked(address)" as const;
export const SIG_EVENT_SPENT = "Spent(uint256,address,address,uint256)" as const;

export const TOPIC_BUDGET_CREATED = topicOf(SIG_EVENT_BUDGET_CREATED);
export const TOPIC_BUDGET_CAPS_UPDATED = topicOf(SIG_EVENT_BUDGET_CAPS_UPDATED);
export const TOPIC_BUDGET_REVOKED = topicOf(SIG_EVENT_BUDGET_REVOKED);
export const TOPIC_SESSION_GRANTED = topicOf(SIG_EVENT_SESSION_GRANTED);
export const TOPIC_SESSION_REVOKED = topicOf(SIG_EVENT_SESSION_REVOKED);
export const TOPIC_SPENT = topicOf(SIG_EVENT_SPENT);

// ─── Storage slot constants ────────────────────────────────────

/**
 * Storage-slot indices for each field of `Budget` and `Session`
 * structs as laid out by Solidity. We don't decode storage directly
 * in this client (we go through eth_call of the getters), but these
 * constants are useful for callers that run a storage-proof oracle.
 *
 * Layout matches the struct declaration order in AgentBudget.sol:
 *   Budget: { owner, asset, dailyCap, perTxCap, [windowSeconds+windowStart packed],
 *             spentInWindow, lifetimeSpent, revoked }
 *   Session: { budgetId, sessionKey, expiresAt, perCallCap, revoked }
 */
export const STORAGE_LAYOUT = Object.freeze({
  budget: Object.freeze({
    owner: 0,
    asset: 1,
    dailyCap: 2,
    perTxCap: 3,
    windowPacked: 4,       // windowSeconds (hi 8 bytes) || windowStart (hi 8 bytes)
    spentInWindow: 5,
    lifetimeSpent: 6,
    revoked: 7,
  }),
  session: Object.freeze({
    budgetId: 0,
    sessionKey: 1,
    expiresAt: 2,
    perCallCap: 3,
    revoked: 4,
  }),
});
