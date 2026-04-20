/**
 * Canonical catalog of every error code the Aethelred Wallet emits. Codes
 * are grouped by domain so callers can do `ERROR_CODES.rpc.REQUEST_TIMEOUT`
 * and never free-form strings.
 *
 * Discipline:
 *   - Codes are dot-delimited, snake_case, machine-parseable.
 *   - Every code is accompanied by a doc comment describing WHEN it fires
 *     and what the recommended recovery action is.
 *   - No PII. Codes are category labels, not user-visible messages.
 *   - Backwards compatibility: codes MUST NOT be renamed after a release;
 *     to deprecate, mark with `@deprecated` and keep the value.
 *
 * The `ALL_ERROR_CODES` export flattens every value into a string[] for
 * uniqueness checks in CI.
 *
 * @example
 * ```ts
 * import { ERROR_CODES, AethelredError } from "@aethelred/wallet-observability";
 *
 * throw new AethelredError({
 *   code: ERROR_CODES.rpc.REQUEST_TIMEOUT,
 *   category: "network-error",
 *   message: "eth_call timed out after 15s",
 * });
 * ```
 */

/**
 * Error codes for the JSON-RPC client layer (packages/chain/src/rpc-client.ts).
 */
export const RPC_ERROR_CODES = {
  /** Request exceeded the configured timeoutMs. Retry via fallback URL. */
  REQUEST_TIMEOUT: "rpc.request.timeout",
  /** Request returned a non-2xx HTTP status or network error. */
  REQUEST_FAILED: "rpc.request.failed",
  /** Invalid params per JSON-RPC spec (code -32602). */
  INVALID_PARAMS: "rpc.invalid_params",
  /** Method not found per JSON-RPC spec (code -32601). */
  METHOD_NOT_FOUND: "rpc.method_not_found",
  /** Provider returned 401/403 or explicit -32001 unauthorized. */
  UNAUTHORIZED: "rpc.unauthorized",
  /** Provider returned 429 or -32005 rate limited. Honor retry-after. */
  RATE_LIMITED: "rpc.rate_limited",
  /** Provider parse error (malformed JSON). Not retryable. */
  PARSE_ERROR: "rpc.parse_error",
  /** All fallback endpoints exhausted. */
  ENDPOINTS_EXHAUSTED: "rpc.endpoints_exhausted",
  /** Batch response length did not match batch request length. */
  BATCH_MISMATCH: "rpc.batch_mismatch",
  /** Subscription setup failed (eth_subscribe). */
  SUBSCRIPTION_FAILED: "rpc.subscription_failed",
} as const;

/**
 * Error codes for the signing layer.
 */
export const SIGNER_ERROR_CODES = {
  /** Private key is not enrolled in the KeyManager for this subject. */
  KEY_NOT_FOUND: "signer.key_not_found",
  /** User cancelled the biometric / WebAuthn prompt. */
  BIOMETRIC_CANCELLED: "signer.biometric_cancelled",
  /** Biometric authentication failed (bad fingerprint, wrong PIN). */
  BIOMETRIC_FAILED: "signer.biometric_failed",
  /** Hardware wallet was disconnected mid-flow. */
  HW_DISCONNECTED: "signer.hw_disconnected",
  /** User rejected the signing prompt. */
  USER_REJECTED: "signer.user_rejected",
  /** Signing surface timed out waiting for the user. */
  APPROVAL_TIMEOUT: "signer.approval_timeout",
  /** Produced signature failed verification. Integrity failure. */
  SIGNATURE_INVALID: "signer.signature_invalid",
  /** Requested signature scheme (EIP-712 v4, personal_sign) is unsupported. */
  SCHEME_UNSUPPORTED: "signer.scheme_unsupported",
} as const;

/**
 * Error codes for the policy evaluation layer.
 */
export const POLICY_ERROR_CODES = {
  /** Amount exceeded the policy's configured spend cap. */
  SPEND_LIMIT_EXCEEDED: "policy.spend_limit_exceeded",
  /** Count of transactions in the velocity window exceeded the cap. */
  VELOCITY_EXCEEDED: "policy.velocity_exceeded",
  /** Destination is on the blocklist (OFAC / internal / user). */
  DESTINATION_BLOCKED: "policy.destination_blocked",
  /** Policy requires explicit approval for this tx. */
  APPROVAL_REQUIRED: "policy.approval_required",
  /** Policy bundle failed to load / parse. */
  BUNDLE_INVALID: "policy.bundle_invalid",
  /** Role does not have permission for this action. */
  ROLE_UNAUTHORIZED: "policy.role_unauthorized",
  /** Action requires quorum that hasn't been met. */
  QUORUM_NOT_MET: "policy.quorum_not_met",
  /** Risk score exceeded threshold (destination / token / amount). */
  RISK_SCORE_EXCEEDED: "policy.risk_score_exceeded",
} as const;

/**
 * Error codes for the audit chain / evidence pipeline.
 */
export const AUDIT_ERROR_CODES = {
  /** Computed event hash did not match stored hash — tamper detected. */
  CHAIN_INTEGRITY_BROKEN: "audit.chain_integrity_broken",
  /** previousHash of event[n] did not equal eventHash of event[n-1]. */
  CHAIN_LINK_MISMATCH: "audit.chain_link_mismatch",
  /** Failed to persist audit event to storage. */
  STORAGE_WRITE_FAILED: "audit.storage_write_failed",
  /** Failed to read audit events from storage. */
  STORAGE_READ_FAILED: "audit.storage_read_failed",
  /** Export package signature / merkle root failed verification. */
  EXPORT_VERIFICATION_FAILED: "audit.export_verification_failed",
  /** Merkle batch finalization failed (missing leaves, bad adapter). */
  MERKLE_BATCH_FAILED: "audit.merkle_batch_failed",
  /** Notarization adapter (DA layer / timestamping) returned error. */
  NOTARIZATION_FAILED: "audit.notarization_failed",
} as const;

/**
 * Error codes for approval workflow engine.
 */
export const WORKFLOW_ERROR_CODES = {
  /** Workflow template not found for requested approval type. */
  TEMPLATE_NOT_FOUND: "workflow.template_not_found",
  /** Workflow timed out before quorum was reached. */
  WORKFLOW_TIMEOUT: "workflow.timeout",
  /** Insufficient approvers to meet quorum threshold. */
  INSUFFICIENT_APPROVERS: "workflow.insufficient_approvers",
  /** Workflow step validation (e.g. sign-before-broadcast) failed. */
  STEP_VALIDATION_FAILED: "workflow.step_validation_failed",
  /** Duplicate approval submitted by the same approver. */
  DUPLICATE_APPROVAL: "workflow.duplicate_approval",
  /** Workflow cancelled by initiator or automated expiration. */
  CANCELLED: "workflow.cancelled",
  /** Workflow engine restore from persisted state failed. */
  RESTORE_FAILED: "workflow.restore_failed",
} as const;

/**
 * Error codes for verifiable credentials.
 */
export const CREDENTIAL_ERROR_CODES = {
  /** VC signature verification failed. */
  SIGNATURE_INVALID: "credential.signature_invalid",
  /** VC `issuanceDate` / `expirationDate` outside accepted window. */
  EXPIRED: "credential.expired",
  /** VC is in the revocation list. */
  REVOKED: "credential.revoked",
  /** Required type/attribute missing from presentation. */
  MISSING_REQUIRED_ATTR: "credential.missing_required_attr",
  /** Presentation holder did not match expected subject. */
  HOLDER_MISMATCH: "credential.holder_mismatch",
  /** Issuer is not in the trusted issuer list. */
  UNTRUSTED_ISSUER: "credential.untrusted_issuer",
  /** Credential schema unsupported by this verifier. */
  SCHEMA_UNSUPPORTED: "credential.schema_unsupported",
} as const;

/**
 * Error codes for network / chain connectivity.
 */
export const NETWORK_ERROR_CODES = {
  /** No network endpoint is reachable for the active chain. */
  CHAIN_UNREACHABLE: "network.chain_unreachable",
  /** Requested chainId isn't configured in this build. */
  CHAIN_NOT_CONFIGURED: "network.chain_not_configured",
  /** Gas price fetch failed (oracle outage). */
  GAS_ORACLE_FAILED: "network.gas_oracle_failed",
  /** Chain reorg detected while a tx was in-flight. */
  REORG_DETECTED: "network.reorg_detected",
  /** Broadcast rejected by mempool (underpriced, nonce reuse). */
  BROADCAST_REJECTED: "network.broadcast_rejected",
  /** Block number did not advance within expected interval. */
  HEAD_STALE: "network.head_stale",
} as const;

/**
 * Error codes for local storage primitives.
 */
export const STORAGE_ERROR_CODES = {
  /** chrome.storage.local write quota exceeded. */
  QUOTA_EXCEEDED: "storage.quota_exceeded",
  /** Decryption of stored blob failed (wrong master key). */
  DECRYPT_FAILED: "storage.decrypt_failed",
  /** Integrity check (HMAC) on stored blob failed. */
  INTEGRITY_FAILED: "storage.integrity_failed",
  /** Storage adapter returned an unexpected shape. */
  CORRUPTED: "storage.corrupted",
  /** Attempted to use a storage key that is unknown. */
  KEY_NOT_FOUND: "storage.key_not_found",
  /** Migration between storage schema versions failed. */
  MIGRATION_FAILED: "storage.migration_failed",
} as const;

/**
 * Error codes for WebAuthn / passkey flows.
 */
export const WEBAUTHN_ERROR_CODES = {
  /** navigator.credentials.create threw NotAllowedError (cancelled/timeout). */
  CREATE_CANCELLED: "webauthn.create_cancelled",
  /** No authenticator responded in the expected window. */
  AUTHENTICATOR_TIMEOUT: "webauthn.authenticator_timeout",
  /** RP-ID mismatch between challenge and authenticator data. */
  RP_ID_MISMATCH: "webauthn.rp_id_mismatch",
  /** Attestation statement verification failed. */
  ATTESTATION_INVALID: "webauthn.attestation_invalid",
  /** Signature counter went backwards — possible clone. */
  COUNTER_REGRESSED: "webauthn.counter_regressed",
  /** The browser/platform does not support the requested authenticator type. */
  PLATFORM_UNSUPPORTED: "webauthn.platform_unsupported",
  /** User verification required but not performed. */
  USER_VERIFICATION_MISSING: "webauthn.user_verification_missing",
} as const;

/**
 * Error codes for on-chain transaction preparation & submission.
 */
export const TX_ERROR_CODES = {
  /** Computed gas would exceed the user's balance. */
  INSUFFICIENT_FUNDS: "tx.insufficient_funds",
  /** Nonce was consumed by another pending tx. */
  NONCE_TAKEN: "tx.nonce_taken",
  /** Gas estimation returned an error (revert). */
  GAS_ESTIMATION_FAILED: "tx.gas_estimation_failed",
  /** Transaction simulation reverted. */
  SIMULATION_REVERTED: "tx.simulation_reverted",
  /** Encoded calldata exceeds chain's size limit. */
  CALLDATA_TOO_LARGE: "tx.calldata_too_large",
  /** Replacement tx has insufficient fee bump. */
  REPLACEMENT_UNDERPRICED: "tx.replacement_underpriced",
  /** Transaction was dropped from the mempool. */
  DROPPED: "tx.dropped",
  /** Transaction failed on-chain (receipt status = 0). */
  EXECUTION_FAILED: "tx.execution_failed",
} as const;

/**
 * Error codes for dapp / EIP-1193 bridge interactions.
 */
export const DAPP_ERROR_CODES = {
  /** Origin is not on the dapp allow list for this workspace. */
  ORIGIN_DENIED: "dapp.origin_denied",
  /** Connect request was rejected by the user. */
  CONNECT_REJECTED: "dapp.connect_rejected",
  /** Session not found for the current connection. */
  SESSION_NOT_FOUND: "dapp.session_not_found",
  /** Requested chain not in the session's enabled chains. */
  CHAIN_NOT_ENABLED: "dapp.chain_not_enabled",
  /** Permission request (eth_requestAccounts) denied. */
  PERMISSION_DENIED: "dapp.permission_denied",
  /** Message schema did not match expected bridge envelope. */
  BRIDGE_MESSAGE_INVALID: "dapp.bridge_message_invalid",
  /** WalletConnect pairing failed. */
  WALLETCONNECT_PAIRING_FAILED: "dapp.walletconnect_pairing_failed",
} as const;

/**
 * Error codes for identity / subject / workspace registry.
 */
export const IDENTITY_ERROR_CODES = {
  /** Subject ID not found in the registry. */
  SUBJECT_NOT_FOUND: "identity.subject_not_found",
  /** Workspace ID not found in the registry. */
  WORKSPACE_NOT_FOUND: "identity.workspace_not_found",
  /** Role not assignable at the current tier. */
  ROLE_NOT_AVAILABLE: "identity.role_not_available",
  /** Attempted to enroll a subject under a workspace they don't belong to. */
  WORKSPACE_MISMATCH: "identity.workspace_mismatch",
  /** Recovery method not registered for the subject. */
  NO_RECOVERY_METHOD: "identity.no_recovery_method",
} as const;

/**
 * Error codes for transaction simulation layer.
 */
export const SIMULATION_ERROR_CODES = {
  /** Simulator could not produce a trace (node doesn't support). */
  TRACE_UNAVAILABLE: "simulation.trace_unavailable",
  /** State override produced a divergent outcome we cannot verify. */
  STATE_OVERRIDE_UNSAFE: "simulation.state_override_unsafe",
  /** Simulation timed out. */
  TIMEOUT: "simulation.timeout",
  /** Simulator returned a schema we don't understand. */
  SCHEMA_UNSUPPORTED: "simulation.schema_unsupported",
} as const;

/**
 * Complete catalog. Callers should use the nested paths
 * (`ERROR_CODES.rpc.REQUEST_TIMEOUT`), not the string values directly.
 */
export const ERROR_CODES = {
  rpc: RPC_ERROR_CODES,
  signer: SIGNER_ERROR_CODES,
  policy: POLICY_ERROR_CODES,
  audit: AUDIT_ERROR_CODES,
  workflow: WORKFLOW_ERROR_CODES,
  credential: CREDENTIAL_ERROR_CODES,
  network: NETWORK_ERROR_CODES,
  storage: STORAGE_ERROR_CODES,
  webauthn: WEBAUTHN_ERROR_CODES,
  tx: TX_ERROR_CODES,
  dapp: DAPP_ERROR_CODES,
  identity: IDENTITY_ERROR_CODES,
  simulation: SIMULATION_ERROR_CODES,
} as const;

/**
 * Flattened list of every error code string. Guaranteed unique (enforced
 * at build time by the CI check in the test suite).
 */
export const ALL_ERROR_CODES: readonly string[] = (() => {
  const out: string[] = [];
  for (const domain of Object.values(ERROR_CODES)) {
    for (const value of Object.values(domain)) out.push(value);
  }
  return Object.freeze(out);
})();

/**
 * Look up a code's domain (e.g. `"rpc"` for `"rpc.request.timeout"`). Returns
 * null if the code isn't registered.
 */
export function domainOf(code: string): string | null {
  for (const [domain, dict] of Object.entries(ERROR_CODES)) {
    for (const value of Object.values(dict)) {
      if (value === code) return domain;
    }
  }
  return null;
}

/**
 * True if `code` is a string that appears in the catalog.
 */
export function isRegisteredErrorCode(code: string): boolean {
  return ALL_ERROR_CODES.includes(code);
}
