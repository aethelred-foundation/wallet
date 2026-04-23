/**
 * `@aethelred/wallet-agent-budget` — on-chain per-agent rolling-
 * window spend caps + scoped session keys.
 *
 * Three concerns, three surfaces:
 *
 *   - **Calldata**: deterministic encoders for every contract
 *     function + decoders for `canSpend` / `remainingInWindow`.
 *     Derived selectors at module load keep the TS-side signature
 *     in lockstep with `contracts/AgentBudget.sol`.
 *
 *   - **BudgetClient**: high-level wrapper with ergonomic async
 *     methods for views and calldata builders for writes. Emits
 *     typed `AgentBudgetEvent`s from raw log blobs.
 *
 *   - **LocalSessionKey**: in-memory secp256k1 keypair that implements
 *     `TypedDataSigner` so every signer-consumer in the stack
 *     (x402, intent-router, MCP tools) works unchanged with a
 *     scoped session key in place of the parent custody key.
 *
 * @packageDocumentation
 */

// ─── Types ──────────────────────────────────────────────────────
export type {
  Budget,
  Session,
  CanSpendResult,
  AgentBudgetEvent,
  ChainProvider,
  RawLog,
} from "./types";

// ─── Errors ─────────────────────────────────────────────────────
export { AgentBudgetError, CAN_SPEND_REASONS } from "./errors";
export type { AgentBudgetErrorCode } from "./errors";

// ─── ABI (selectors, topics, signatures, layout) ───────────────
export {
  SIG_CREATE_BUDGET,
  SIG_UPDATE_CAPS,
  SIG_REVOKE_BUDGET,
  SIG_GRANT_SESSION,
  SIG_REVOKE_SESSION,
  SIG_SPEND,
  SIG_REMAINING_IN_WINDOW,
  SIG_CAN_SPEND,
  SELECTOR_CREATE_BUDGET,
  SELECTOR_UPDATE_CAPS,
  SELECTOR_REVOKE_BUDGET,
  SELECTOR_GRANT_SESSION,
  SELECTOR_REVOKE_SESSION,
  SELECTOR_SPEND,
  SELECTOR_REMAINING_IN_WINDOW,
  SELECTOR_CAN_SPEND,
  TOPIC_BUDGET_CREATED,
  TOPIC_BUDGET_CAPS_UPDATED,
  TOPIC_BUDGET_REVOKED,
  TOPIC_SESSION_GRANTED,
  TOPIC_SESSION_REVOKED,
  TOPIC_SPENT,
  STORAGE_LAYOUT,
} from "./abi";

// ─── Calldata encoders / decoders ──────────────────────────────
export {
  encodeCreateBudget,
  encodeUpdateCaps,
  encodeRevokeBudget,
  encodeGrantSession,
  encodeRevokeSession,
  encodeSpend,
  encodeRemainingInWindow,
  encodeCanSpend,
  decodeUint256,
  decodeCanSpend,
  decodeDataWords,
  decodeIndexedAddress,
  decodeIndexedUint256,
} from "./calldata";
export type {
  CreateBudgetArgs,
  UpdateCapsArgs,
  RevokeBudgetArgs,
  GrantSessionArgs,
  RevokeSessionArgs,
  SpendArgs,
} from "./calldata";

// ─── Client ─────────────────────────────────────────────────────
export {
  BudgetClient,
  decodeBudgetStruct,
  decodeSessionStruct,
} from "./budget-client";
export type { BudgetClientConfig, PreparedCall } from "./budget-client";

// ─── Session key ────────────────────────────────────────────────
export { LocalSessionKey } from "./session-key";
export type { SessionKeyRef, SessionKeyMetadata } from "./session-key";
