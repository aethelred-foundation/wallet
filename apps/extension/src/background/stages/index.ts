/**
 * Aggregator for every lifecycle stage the extension background wires
 * into `SwLifecycle`. Keep the priority map in this file so engineers
 * have a single reference for "what runs when, and why".
 *
 * ```
 *  0  storage-persistence       schema migration, quota checks
 * 10  audit-chain-rehydration   restore sequence + previousHash
 * 20  merkle-batch-restoration  start coordinator, flush on suspend
 * 30  pending-approvals         rehydrate chrome.storage.session map
 * 40  nonce-manager             restore per-account nonce high-water
 * 50  pending-tx-tracker        reconcile receipts for in-flight txs
 * 60  credential-store          restore enrolled passkey descriptors
 * 70  walletconnect-session     re-establish relay subscriptions
 * 80  velocity-tracker          force-hydrate policy velocity cache
 * 90  workflow-engine           restore quorum workflow state
 * ```
 */

export * from "./types";
export * from "./storage-persistence-stage";
export * from "./audit-chain-rehydration-stage";
export * from "./merkle-batch-restoration-stage";
export * from "./pending-approvals-stage";
export * from "./nonce-manager-stage";
export * from "./pending-tx-tracker-stage";
export * from "./credential-store-stage";
export * from "./walletconnect-session-stage";
export * from "./velocity-tracker-stage";
export * from "./workflow-engine-stage";
