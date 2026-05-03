/**
 * `@aethelred/wallet-custody-adapters` — pluggable signing backends.
 *
 * Four tiers, one contract: every adapter implements `CustodyAdapter`
 * and narrows to `asTypedDataSigner()` for the x402 `TypedDataSigner`
 * interface. Pick the adapter that matches your threat model and
 * deployment environment; the rest of the wallet stack (x402 client,
 * MCP server, intent router, smart accounts) doesn't branch on which
 * one you picked.
 *
 * @packageDocumentation
 */

// ─── Contract ───────────────────────────────────────────────────
export type {
  CustodyAdapter,
  CustodyCapabilities,
  RawTransactionRequest,
  TypedDataRequest,
  TypedDataDomain,
  TypedDataField,
  TypedDataSigner,
  TeeAttestationBundle,
} from "./types";

// ─── Errors ─────────────────────────────────────────────────────
export {
  CustodyError,
  CapabilityNotSupportedError,
  UserRejectedError,
  KeyShareMissingError,
  RemoteApiError,
} from "./errors";
export type { CustodyErrorCode } from "./errors";

// ─── Shared EIP-712 digest ──────────────────────────────────────
export {
  computeTypedDataDigest,
  hashStruct,
  encodeType,
  computeDomainType,
} from "./eip712-hash";

// ─── Adapters ───────────────────────────────────────────────────
export { LocalKeyAdapter } from "./local-key-adapter";
export type { LocalKeyAdapterConfig } from "./local-key-adapter";

export {
  ShamirTwoOfTwoAdapter,
  splitPrivateKey,
  reconstructKey,
} from "./shamir-2of2-adapter";
export type {
  ShamirTwoOfTwoAdapterConfig,
  ShareFetcher,
} from "./shamir-2of2-adapter";

export { NitroEnclaveAdapter } from "./nitro-enclave-adapter";
export type {
  NitroEnclaveAdapterConfig,
  EnclaveTransport,
  EnclaveSignatureRequest,
  EnclaveSignatureResponse,
  EnclavePublicKeyResponse,
} from "./nitro-enclave-adapter";

export { LedgerHsmAdapter } from "./ledger-hsm-adapter";
export type {
  LedgerHsmAdapterConfig,
  LedgerBackendLike,
} from "./ledger-hsm-adapter";

export { FireblocksAdapter } from "./fireblocks-adapter";
export type {
  FireblocksAdapterConfig,
  FireblocksClient,
  FireblocksCreateRequest,
  FireblocksCreateResponse,
  FireblocksStatusResponse,
  FireblocksTxStatus,
} from "./fireblocks-adapter";

// ─── Custodian liability attestation (audit-chain integration) ──
//
// Closes the audit-chain dark spot at the third-party custodian API
// boundary. When a transaction routes through Komainu / Fireblocks /
// BlockDaemon / Hextrust, the wallet captures a cryptographically-bound
// snapshot of the custodian's active SLA + insurance coverage and
// stamps it onto the transaction's audit record.
//
// Fail-graceful: oracle outages don't block transactions. The audit
// event is stamped `liabilityUnknown: true` so the gap is queryable
// later instead of silently swallowing the dark spot.

export {
  CUSTODIAN_IDS,
  NoopLiabilityAttestor,
  CachingLiabilityAttestor,
  captureLiabilitySnapshot,
} from "./liability-attestation";
export type {
  CustodianSlaStatus,
  CustodianLiabilityAttestation,
  LiabilityAttestor,
  LiabilitySnapshotEvent,
  CanonicalCustodianId,
} from "./liability-attestation";

/**
 * Audit-chain wiring — bridges a {@link LiabilitySnapshotEvent} into
 * the `wallet-audit` event pipeline as a `custodian-liability-snapshot`
 * event.
 */
export { recordLiabilitySnapshot } from "./audit-integration";
export type { AuditSubjectContext } from "./audit-integration";
