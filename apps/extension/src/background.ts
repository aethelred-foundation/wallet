/**
 * Background service worker - the central orchestration hub.
 *
 * Integrates ALL packages:
 *   - core: key management, signing, encryption
 *   - identity: subjects, workspaces, roles
 *   - policy: deterministic rule evaluation
 *   - audit: tamper-evident event chain
 *   - connect: sessions, request validation
 *   - chain: RPC client, balances, gas, tx broadcast, prices
 *   - simulation: tx simulation, message analysis
 *   - approval: workflow engine with quorum
 *   - deployment: tier-aware feature gating
 *
 * Request pipeline: Validate → Policy → Simulate → (Approve) → Sign → Broadcast → Audit
 */

import {
  MasterKey,
  EncryptedStorage,
  MemoryStorageAdapter,
  KeyManager,
  Signer,
  LocalCustodyBackend,
  // Real EIP-1559 tx builder + broadcast helpers
  buildAndSignEip1559Tx,
  hexToBigInt,
  hexToBytes,
  addressToBytes,
  LockedError,
  // Real EIP-712 typed-data hasher
  hashTypedDataV4Json,
} from "@aethelred/wallet-core";
import {
  SubjectRegistry,
  WorkspaceRegistry,
  CredentialStore,
  toSubjectSummary,
  toWorkspaceSummary,
  type PasskeyCredential,
  type Subject,
  type Workspace,
  type RoleAssignment,
} from "@aethelred/wallet-identity";
import { evaluate, getDefaultPolicyBundle, buildPolicyContext, VelocityTracker } from "@aethelred/wallet-policy";
import { baseUnitsToAmount, buildSpendingFields, UNPRICED_POLICY_NOTICE } from "./background/spending-context";
import { AuditCapture, AuditStore, type AuditEventKind } from "@aethelred/wallet-audit";
import {
  assertNever,
  InMemoryMeter,
  OtlpMetricsExporter,
  PeriodicMetricsExporter,
} from "@aethelred/wallet-observability";
import {
  AUDIT_METRICS_SNAPSHOT_KIND,
  buildAuditMetricsRecorder,
  buildAuditMetricsSuspendHandler,
  getAuditMetricsSnapshot,
} from "./lib/audit-metrics-bridge";
import {
  RpcClient,
  BalanceFetcher,
  StakingPositionFetcher,
  GasOracle,
  TxManager,
  PriceService,
  TokenListService,
  StatePersistence,
  PendingTxTracker,
  PendingTxTrackerError,
  type PendingTransaction,
  type TrackedPendingTransaction,
} from "@aethelred/wallet-chain";
import {
  computeReplacementGas,
  buildSpeedUpTransaction,
  buildCancelTransaction,
  GasReplacementError,
  type OriginalTransaction,
} from "@aethelred/wallet-core";
import { TransactionSimulator, MessageAnalyzer, NetworkManager } from "@aethelred/wallet-simulation";
import { MerkleBatchCoordinator } from "./background/merkle-batch-coordinator";
import { WalletConnectManager } from "./services/walletconnect-manager";
import { BasicTracer, CONSOLE_SINK, Logger } from "@aethelred/wallet-observability";
import { SwLifecycle } from "./background/sw-lifecycle";
import {
  buildAuditChainRehydrationStage,
  buildCredentialStoreStage,
  buildMerkleBatchRestorationStage,
  buildNonceManagerStage,
  buildPendingApprovalsStage,
  buildPendingTxTrackerStage,
  buildStoragePersistenceStage,
  buildVelocityTrackerStage,
  buildWalletConnectSessionStage,
  buildWorkflowEngineStage,
  CREDENTIAL_STORE_KEY,
  persistWalletConnectSessions,
  type CredentialStoreHydrationState,
} from "./background/stages";
import {
  bytesToBase64Url,
  commitPasskeyBindingTransaction,
  evaluatePasskeyBinding,
  verifyWebAuthnAssertion,
  verifyWebAuthnRegistrationContext,
} from "./background/webauthn-verifier";
import {
  PasskeyEphemeralAuthority,
  type PasskeyAuthChallengeRecord,
  type PasskeyEnrollmentChallengeRecord,
} from "./background/passkey-ephemeral-authority";
import { runVaultEpochBoundMutation } from "./background/passkey-vault-epoch";
import { getCredentialReleaseError } from "./background/credential-release-gate";
import { getTenantMigrationReleaseError } from "./background/tenant-migration-release-gate";
import {
  inspectAuditChainIntegrity,
  type AuditChainRehydrationState,
} from "./background/audit-chain-integrity";
import {
  WorkflowEngine,
  getApprovalTemplate,
  type ApprovalContext,
} from "@aethelred/wallet-approval";
import {
  SessionManager,
  validateRequest,
  type AethelredWalletState,
  type AppIdentity,
  type BridgeMessage,
  type IntentRequest,
  type IntentResponse,
  type ApprovalSummary,
  type ApprovalDetail,
  type WorkspaceRole,
  type WalletConnectApprovedNamespace,
  type SessionGrant,
} from "@aethelred/wallet-connect";
import { applyTerraQuraApprovalPresentation, inspectTerraQuraTransaction } from "./lib/terraqura-approval";
import { getWalletAppCatalog } from "./background/app-catalog";
import {
  Eip1559GasValidationError,
  resolveEffectiveEip1559GasParameters,
} from "./background/eip1559-gas";
import {
  ContactBookController,
  ContactBookValidationError,
  type ContactBookSnapshot,
} from "./background/contact-book";
import { toPendingTxSummary } from "./background/pending-tx-summary";
import {
  isProviderSessionActive,
  planProviderEventDeliveries,
  planRevokedAccountsDelivery,
  tabMatchesProviderEventOrigin,
  type ProviderEventDelivery,
} from "./provider-event-scope";

// ─── Storage ──────────────────────────────────────────────────────
const storageAdapter = typeof chrome !== "undefined" && chrome.storage?.local
  ? {
      get: (key: string) => new Promise<string | null>((resolve, reject) => {
        chrome.storage.local.get(key, (result) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(`chrome.storage.local.get(${key}) failed: ${error.message}`));
            return;
          }
          resolve((result[key] as string) ?? null);
        });
      }),
      set: (key: string, value: string) => new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ [key]: value }, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(`chrome.storage.local.set(${key}) failed: ${error.message}`));
            return;
          }
          resolve();
        });
      }),
      delete: (key: string) => new Promise<void>((resolve, reject) => {
        chrome.storage.local.remove(key, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(`chrome.storage.local.remove(${key}) failed: ${error.message}`));
            return;
          }
          resolve();
        });
      }),
    }
  : new MemoryStorageAdapter();

// One-time WebAuthn challenges and unlock grants belong in session storage:
// it survives MV3 service-worker eviction but is not exposed to content
// scripts by default and is cleared when the browser session ends.
const passkeyEphemeralStorage =
  typeof chrome !== "undefined" && chrome.storage?.session
    ? {
        get: (key: string) => new Promise<string | null>((resolve, reject) => {
          chrome.storage.session.get(key, (result) => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(`chrome.storage.session.get(${key}) failed: ${error.message}`));
              return;
            }
            resolve((result[key] as string) ?? null);
          });
        }),
        set: (key: string, value: string) => new Promise<void>((resolve, reject) => {
          chrome.storage.session.set({ [key]: value }, () => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(`chrome.storage.session.set(${key}) failed: ${error.message}`));
              return;
            }
            resolve();
          });
        }),
        delete: (key: string) => new Promise<void>((resolve, reject) => {
          chrome.storage.session.remove(key, () => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(`chrome.storage.session.remove(${key}) failed: ${error.message}`));
              return;
            }
            resolve();
          });
        }),
      }
    : storageAdapter;

// ─── Spending velocity (24h sliding window, persisted) ────────────
// Feeds requestedOperationCount24h / cumulativeValueSpentUsd24h into
// every send-path policy evaluation; broadcasts record into it (keyed
// by tx hash, so retries can't double-count).
const velocityTracker = new VelocityTracker(storageAdapter);

async function releaseVelocityReservation(
  reservationId: string,
  reason: string,
): Promise<void> {
  try {
    await velocityTracker.releaseReservation(reservationId);
  } catch (error) {
    // The tracker poisons itself after a storage failure, so swallowing this
    // cleanup error cannot fail open: every later send is blocked until a
    // healthy worker rehydrates the durable ledger.
    console.error(`[velocity] failed to release ${reservationId} (${reason})`, error);
  }
}

// ─── Core ─────────────────────────────────────────────────────────
const masterKey = new MasterKey(storageAdapter, 5 * 60 * 1000);
const encryptedStorage = new EncryptedStorage(masterKey, storageAdapter);
const custody = new LocalCustodyBackend(encryptedStorage);
const keyManager = new KeyManager(custody, encryptedStorage);
const signer = new Signer(masterKey, custody);

// ─── Identity ─────────────────────────────────────────────────────
const subjectRegistry = new SubjectRegistry();
const workspaceRegistry = new WorkspaceRegistry();
/**
 * The credential store now holds WebAuthn passkey credentials for
 * optional 2FA unlock. It was previously instantiated but unreferenced
 * (GAP J dead code); the `passkey-enroll` / `passkey-verify` message
 * handlers below give it a real purpose.
 */
const credentialStore = new CredentialStore();
const sessionManager = new SessionManager();

const PASSKEY_CHALLENGE_TTL_MS = 90_000;
const PASSKEY_UNLOCK_GRANT_TTL_MS = 30_000;
const passkeyEphemeralAuthority = new PasskeyEphemeralAuthority(
  storageAdapter,
  passkeyEphemeralStorage,
);
const DISABLED_WALLETCONNECT_KINDS = new Set<string>([
  "wc-pair",
  "wc-sessions",
  "wc-disconnect",
  "wc-approve-proposal",
  "wc-reject-proposal",
]);

let credentialStoreHydrationState: CredentialStoreHydrationState = {
  status: "pending",
};

// Credential and vault-policy writes span two storage keys. Serialize every
// binding reconciliation/change so another message cannot observe the brief
// in-memory transition between those crash-safe ordered writes.
let passkeyBindingOperationTail: Promise<void> = Promise.resolve();

async function withPasskeyBindingOperation<T>(operation: () => Promise<T>): Promise<T> {
  const predecessor = passkeyBindingOperationTail;
  let release!: () => void;
  passkeyBindingOperationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await predecessor;
  try {
    return await operation();
  } finally {
    release();
  }
}

function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function resolveExtensionWebAuthnContext(
  sender: chrome.runtime.MessageSender,
): { effectiveRpId: string; legacyHostRpId: string; origin: string } | null {
  try {
    if (
      typeof chrome !== "undefined" &&
      chrome.runtime?.id &&
      sender.id &&
      sender.id !== chrome.runtime.id
    ) {
      return null;
    }
    const rawUrl =
      sender.url ??
      (typeof chrome !== "undefined" && chrome.runtime?.getURL
        ? chrome.runtime.getURL("/")
        : "");
    if (!rawUrl) return null;
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "chrome-extension:" && parsed.protocol !== "moz-extension:") {
      return null;
    }
    if (!parsed.host) return null;
    // Chromium serializes an extension origin as the effective RP ID. It
    // hashes this full value into authenticatorData, not the bare extension
    // host used by ordinary HTTPS relying parties.
    const origin = `${parsed.protocol}//${parsed.host}`;
    return { effectiveRpId: origin, legacyHostRpId: parsed.host, origin };
  } catch {
    return null;
  }
}

function isTrustedWalletPage(sender: chrome.runtime.MessageSender): boolean {
  // A content script's browser-owned sender URL is the website URL, while a
  // popup/full-page/options caller has the extension URL. Use that origin
  // boundary rather than `sender.tab`, because a legitimate full-page wallet
  // can itself be hosted in a browser tab.
  return resolveExtensionWebAuthnContext(sender) !== null;
}

type CredentialStoreSnapshot = ReturnType<CredentialStore["toSnapshot"]>;

function captureCredentialSnapshot(): CredentialStoreSnapshot {
  return credentialStore.toSnapshot().map((credential) => ({
    ...credential,
    metadata: credential.metadata ? { ...credential.metadata } : undefined,
  }));
}

function restoreCredentialSnapshot(snapshot: CredentialStoreSnapshot): void {
  credentialStore.loadFromSnapshot(snapshot);
}

async function persistCredentialSnapshot(snapshot: CredentialStoreSnapshot): Promise<void> {
  await storageAdapter.set(CREDENTIAL_STORE_KEY, JSON.stringify(snapshot));
}

async function commitCredentialMutation<T>(mutation: () => T): Promise<T> {
  const previous = captureCredentialSnapshot();
  try {
    const result = mutation();
    await persistCredentialSnapshot(captureCredentialSnapshot());
    return result;
  } catch (error) {
    restoreCredentialSnapshot(previous);
    throw error;
  }
}

/** Restore the exact credential/policy pair after a stale vault-epoch commit. */
async function restorePasskeyBinding(
  snapshot: CredentialStoreSnapshot,
  policy: Awaited<ReturnType<MasterKey["getPasskeyPolicy"]>>,
): Promise<void> {
  if (policy === "unknown") {
    throw new Error("Prior passkey policy is unavailable; refusing unsafe rollback");
  }
  try {
    // Preserve the same crash-safe ordering used by the normal binding
    // transaction: a required policy is never written before its credential,
    // and a password-only policy is cleared before its credential is removed.
    if (policy === "required") {
      await persistCredentialSnapshot(snapshot);
      await masterKey.setPasskeyPolicy("required");
    } else {
      await masterKey.setPasskeyPolicy("none");
      await persistCredentialSnapshot(snapshot);
    }
  } finally {
    restoreCredentialSnapshot(snapshot);
  }
}

function getPersistedPasskeySubjectId(): string | null {
  return subjectRegistry.getActive()?.id ?? statePersistence.getState().activeSubjectId;
}

async function resolvePasskeyRequirementWithinBinding(subjectId: string | null): Promise<{
  required: boolean;
  passkeys: ReturnType<CredentialStore["listPasskeys"]>;
}> {
  const policy = await masterKey.getPasskeyPolicy();

  if (
    credentialStoreHydrationState.status === "pending" ||
    credentialStoreHydrationState.status === "invalid" ||
    credentialStoreHydrationState.status === "error"
  ) {
    throw new Error(
      "Passkey protection data is unavailable or corrupted; restore this wallet with its recovery phrase",
    );
  }

  const allPasskeys = credentialStore.toSnapshot().filter(
    (credential): credential is PasskeyCredential => credential.type === "passkey",
  );
  const resolution = evaluatePasskeyBinding(policy, subjectId, allPasskeys);
  if (resolution.policyToPersist) {
    await masterKey.setPasskeyPolicy(resolution.policyToPersist);
  }
  return { required: resolution.required, passkeys: resolution.passkeys };
}

async function resolvePasskeyRequirement(subjectId: string | null): Promise<{
  required: boolean;
  passkeys: ReturnType<CredentialStore["listPasskeys"]>;
}> {
  return withPasskeyBindingOperation(() =>
    resolvePasskeyRequirementWithinBinding(subjectId),
  );
}

async function consumePasskeyUnlockGrant(
  subjectId: string | null,
  suppliedToken: string | undefined,
  password: string,
): Promise<void> {
  await withPasskeyBindingOperation(async () => {
    const requirement = await resolvePasskeyRequirementWithinBinding(subjectId);
    if (!requirement.required) {
      // A token supplied after the final credential was removed must not be
      // silently accepted as a password-only unlock. The caller can retry
      // without the revoked token.
      if (suppliedToken) {
        throw new Error("Passkey verification was revoked; try again");
      }
      await masterKey.unlock(password);
      return;
    }
    if (!subjectId) {
      // evaluatePasskeyBinding rejects this state; retain a local guard so a
      // future policy refactor cannot turn a missing identity into a bypass.
      throw new Error("Passkey verification identity binding is unavailable");
    }
    if (!suppliedToken || !/^[A-Za-z0-9_-]{32,}$/.test(suppliedToken)) {
      throw new Error("Passkey verification is required to unlock this wallet");
    }

    await passkeyEphemeralAuthority.consumeUnlockGrant(
      subjectId,
      suppliedToken,
      requirement.passkeys.map((passkey) => passkey.metadata.credentialId),
    );
    // Keep password verification inside the binding operation so a concurrent
    // credential removal linearizes either before the grant is consumed or
    // after the wallet is unlocked, never between those security checks.
    await masterKey.unlock(password);
  });
}

// ─── Observability — metrics meter (PRs #110, #111) ──────────────
/**
 * Background-scoped meter for audit observability. Counters tick on:
 *   - `audit_chain_integrity_broken_total` (P1) — tamper signal
 *   - `audit_chain_link_mismatch_total` (P2/P1) — gap signal
 *   - `audit_storage_write_failed_total` — Hypothesis-A leading indicator
 *   - `audit_storage_read_failed_total` — startup read failure
 *
 * The chain-integrity counters require a verifyChain or
 * buildEvidenceRecord call site to fire; storage counters fire
 * automatically from `auditStore.append` / `initialize` / `rotateKey`.
 *
 * **Export pipeline (PR #111)** — when the build was configured
 * with `VITE_AUDIT_METRICS_OTLP_URL`, a `PeriodicMetricsExporter`
 * pushes the meter's accumulated state to the configured OTLP
 * endpoint every 60 seconds (default). Operators rebuilding the
 * extension without the env var get a no-op exporter (default
 * OSS posture: no auto-export).
 *
 * Service-worker eviction risk: in-flight increments since the
 * last successful tick are lost on SW eviction. The 60s interval
 * minimizes window size; pre-eviction `chrome.runtime.onSuspend`
 * flush is a future PR.
 */
const auditMeter = new InMemoryMeter();
const auditMetrics = buildAuditMetricsRecorder({
  meter: auditMeter,
  defaultLabels: { service: "wallet-extension-background" },
});

const AUDIT_METRICS_OTLP_URL = (() => {
  try {
    return import.meta.env?.VITE_AUDIT_METRICS_OTLP_URL as string | undefined;
  } catch {
    return undefined;
  }
})();

const auditMetricsExporter = AUDIT_METRICS_OTLP_URL
  ? new PeriodicMetricsExporter({
      meter: auditMeter,
      exporter: new OtlpMetricsExporter({
        url: AUDIT_METRICS_OTLP_URL,
        resource: { "service.name": "wallet-extension-background" },
      }),
      intervalMs: 60_000,
      onError: (err) => {
        // Use the existing background logger when it's available
        // below; for now, console.warn ensures the failure is at
        // least visible in DevTools.
        console.warn("[audit-metrics] OTLP export failed:", err);
      },
    })
  : null;
auditMetricsExporter?.start();

// ─── Pre-eviction flush (PR #112) ─────────────────────────
// `chrome.runtime.onSuspend` fires before the SW terminates.
// Best-effort flush of the metrics exporter shrinks the
// observability gap from ~60s (one tick interval) to the time
// between the listener firing and Chrome killing the worker.
// Not a guarantee — Chrome doesn't await async work in onSuspend
// listeners — but a meaningful narrowing of the loss window.
if (typeof chrome !== "undefined" && chrome.runtime?.onSuspend) {
  const suspendHandler = buildAuditMetricsSuspendHandler(
    auditMetricsExporter,
    (err) => console.warn("[audit-metrics] pre-eviction flush failed:", err),
  );
  chrome.runtime.onSuspend.addListener(suspendHandler);
}

// ─── Audit ────────────────────────────────────────────────────────
const auditCapture = new AuditCapture();
const auditStore = new AuditStore(
  storageAdapter,
  undefined, // maxEvents — package default
  null, // encryptedStorage — wired via rotateKey() after master key unlocks
  auditMetrics, // PR #110 — wires storage failure metrics to the meter
);
let auditChainRehydrationState: AuditChainRehydrationState = { state: "pending" };
auditCapture.onEvent(async (event) => {
  try { await auditStore.append(event); } catch { /* must not break ops */ }
});

/* ─── Merkle batch coordinator ────────────────────────────────
 * Wires `AuditCapture.onEvent` into the `MerkleBatch` primitive so
 * every recorded audit event contributes to a tamper-evident Merkle
 * root that the L1 notarizer will publish. When a batch finalizes
 * (at the 256-event threshold or after 60s of activity) we persist
 * it to chrome.storage.local under `merkle-batches` and emit a
 * `merkle-batch-ready` bridge event so production's L1 notarizer
 * adapter can subscribe.
 *
 * The coordinator also persists the raw event queue as-it-arrives,
 * so a browser crash or MV3 service-worker eviction between capture
 * and finalize never leaves events unnotarized.
 *
 * Graceful degradation: if chrome.storage.local is unavailable
 * (typically dev / test), the coordinator falls back to an in-
 * memory store and logs a banner line — the rest of the pipeline
 * is unaffected. */
const merkleBatchCoordinator = new MerkleBatchCoordinator(
  auditCapture,
  async (batch) => {
    try {
      chrome.runtime
        .sendMessage({
          kind: "merkle-batch-ready",
          correlationId: "",
          payload: {
            batchId: batch.batchId,
            root: batch.root,
            leafCount: batch.leafCount,
            finalizedAt: batch.finalizedAt,
            firstSequenceNumber: batch.firstSequenceNumber,
            lastSequenceNumber: batch.lastSequenceNumber,
          },
          timestamp: Date.now(),
        })
        .catch(() => {
          // Popup may not be open — no listener is fine. The L1
          // notarizer adapter subscribes via a different channel.
        });
    } catch {
      /* empty */
    }
  },
  {
    maxBatchSize: 256,
    maxBatchAgeMs: 60_000,
    retentionMs: 30 * 24 * 60 * 60 * 1000,
  },
);
merkleBatchCoordinator.start().catch((err) => {
  console.warn("[background] merkleBatchCoordinator.start failed", err);
});

// ─── Chain (real blockchain communication) ────────────────────────
const networkManager = new NetworkManager();
let rpcClient = new RpcClient({ url: networkManager.getActive().rpcUrl });
let balanceFetcher = new BalanceFetcher(rpcClient, networkManager.getActive().nativeCurrency);
let stakingPositionFetcher = new StakingPositionFetcher(rpcClient);
let gasOracle = new GasOracle(rpcClient);
let txManager = new TxManager(rpcClient);
// Network-aware: only the active network knows whether its native asset
// has a market. Rebuilt in switchChain (like the other RPC-scoped
// services) so a chain switch can never serve another asset's price.
let priceService = new PriceService({
  nativeCoingeckoId: networkManager.getActive().nativeCoingeckoId ?? null,
});
const tokenListService = new TokenListService();

/**
 * Monotonic generation for the active chain-scoped services. Comparing only
 * chain IDs is insufficient: a request can yield while the user switches away
 * and back, leaving its review bound to obsolete RPC/service instances. Every
 * successful switch (including a same-chain RPC rebuild) advances this epoch.
 */
let activeChainEpoch = 0;

interface TransactionChainContext {
  chainId: string;
  epoch: number;
  network: ReturnType<NetworkManager["getActive"]>;
  rpcClient: RpcClient;
  gasOracle: GasOracle;
  txManager: TxManager;
  priceService: PriceService;
}

function captureTransactionChainContext(): TransactionChainContext {
  return {
    chainId: networkManager.getActiveChainId(),
    epoch: activeChainEpoch,
    network: networkManager.getActive(),
    rpcClient,
    gasOracle,
    txManager,
    priceService,
  };
}

function transactionChainContextChanged(context: Pick<TransactionChainContext, "chainId" | "epoch">): boolean {
  return (
    activeChainEpoch !== context.epoch ||
    networkManager.getActiveChainId().toLowerCase() !== context.chainId.toLowerCase()
  );
}

/* ─── Pending transaction tracker (gas-bump / speed-up / cancel) ───
 * Durable ledger of broadcast-but-not-yet-confirmed txs, including
 * the `original → replacement` lineage the popup's Activity view
 * needs to render Speed-up / Cancel buttons. Persists independently
 * of `txManager` (which is per-chain and reset on switchChain). */
const pendingTxTracker = new PendingTxTracker(storageAdapter);

/* ─── WalletConnect v2 session manager ─────────────────────────
 * Lazily initialized the first time a popup issues a `wc-pair` or
 * `wc-sessions` call — keeps the scaffold out of the hot path for
 * users who never use WalletConnect. The init is idempotent so
 * repeated calls are cheap. The SDK wiring itself is deferred
 * (the stub returns empty session lists and logs operations). */
let walletConnectManager: WalletConnectManager | null = null;
function getWalletConnectManager(): WalletConnectManager {
  if (import.meta.env.PROD) {
    throw new Error("WalletConnect is not packaged in this production build");
  }
  if (walletConnectManager) return walletConnectManager;
  walletConnectManager = new WalletConnectManager({
    projectId: "aethelred-wallet",
    walletMetadata: {
      name: "Aethelred Wallet",
      description: "Aethelred trust platform wallet",
      url: "https://aethelred.org",
      icons: [],
    },
    onProposal: async (proposal) => {
      // Route every proposal through the approval pipeline — the
      // popup renders the same approval UI it uses for EIP-1193.
      const decision = await requestUserApproval({
        title: "Connect via WalletConnect",
        summary: `${proposal.proposer.metadata.name} wants to connect via WalletConnect.`,
        appName: proposal.proposer.metadata.name,
        origin: proposal.proposer.metadata.url,
        detail: {
          kind: "connect",
          permissions: Object.keys(proposal.requiredNamespaces),
          accountAddresses: keyManager.getAccounts().map((a) => a.address),
        },
      });
      if (decision === "rejected") {
        return {
          approved: false,
          reason: { code: 5000, message: "User rejected the connection" },
        };
      }
      const account = getActiveAccount();
      const accounts = account ? [account.address] : [];
      // Synthesize a bare-minimum approved-namespaces response.
      // Production wires the SDK's own namespace negotiator.
      const approved: Record<string, WalletConnectApprovedNamespace> = {};
      for (const [key, req] of Object.entries(proposal.requiredNamespaces)) {
        const chains = req.chains ?? [];
        approved[key] = {
          chains,
          methods: req.methods,
          events: req.events,
          accounts: chains.flatMap((chain) => accounts.map((a) => `${chain}:${a}`)),
        };
      }
      return { approved: true, accounts, namespaces: approved };
    },
    onRequest: async (request) => {
      // Every WalletConnect RPC MUST go through the same approval
      // pipeline as an EIP-1193 request — we never bypass policy.
      const { method, params } = request.params.request;
      const correlationId = `wc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const bridgeMessage: BridgeMessage = {
        kind: "rpc-request",
        correlationId,
        payload: { method, params: Array.isArray(params) ? params : [] },
        origin: `walletconnect:${request.topic}`,
        timestamp: Date.now(),
      };
      const fakeSender: chrome.runtime.MessageSender = {
        // This request is produced by our own WalletConnect session manager,
        // not by a browser page. Mark it as an extension-owned bridge call so
        // browser-origin authentication below stays fail-closed for callers
        // that have no MessageSender URL.
        id: chrome.runtime.id,
        url: chrome.runtime.getURL("/"),
      } as chrome.runtime.MessageSender;
      try {
        const response = await handleRpcRequest(bridgeMessage, fakeSender);
        const payload = response.payload as {
          result?: unknown;
          error?: { code: number; message: string };
        };
        if (payload.error) return { error: payload.error };
        return { result: payload.result };
      } catch (err) {
        return {
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : "WalletConnect request failed",
          },
        };
      }
    },
    onSessionExpire: (topic) => {
      auditCapture.record({
        kind: "session-revoked",
        subjectId: subjectRegistry.getActive()?.id ?? "unknown",
        workspaceId: workspaceRegistry.getActive()?.id ?? "unknown",
        detail: { transport: "walletconnect", topic },
      });
    },
    onAudit: (event) => {
      // Normalise the WalletConnect-specific event kinds into our
      // audit schema so `get-audit-events` surfaces them uniformly.
      const subjectId = subjectRegistry.getActive()?.id ?? "unknown";
      const workspaceId = workspaceRegistry.getActive()?.id ?? "unknown";
      if (event.kind === "session-created") {
        auditCapture.record({
          kind: "session-created",
          subjectId,
          workspaceId,
          detail: {
            transport: "walletconnect",
            topic: event.topic,
            peer: event.peer.name,
          },
        });
      } else if (event.kind === "session-revoked") {
        auditCapture.record({
          kind: "session-revoked",
          subjectId,
          workspaceId,
          detail: { transport: "walletconnect", topic: event.topic },
        });
      } else if (event.kind === "approval-decided") {
        auditCapture.record({
          kind: "approval-decided",
          subjectId,
          workspaceId,
          detail: {
            transport: "walletconnect",
            topic: event.topic,
            proposalId: event.proposalId,
            decision: event.decision,
          },
        });
      }
    },
  });
  walletConnectManager.init().catch((err) => {
    console.warn("[background] walletConnectManager.init failed", err);
  });
  return walletConnectManager;
}

// ─── Simulation ───────────────────────────────────────────────────
const txSimulator = new TransactionSimulator();
const messageAnalyzer = new MessageAnalyzer();

/* ─── Approval workflow engine ─────────────────────────────────
 * The workflow engine handles multi-reviewer quorum/escalation/spend
 * limits for enterprise workspaces. It's wired into `handleSendTransaction`
 * via the policy engine's "approval-required" outcome — when that
 * outcome fires, we create a real `WorkflowRequest` so the engine can
 * track reviewer decisions across multiple popup sessions (fixes part
 * of GAP J: instantiated but unreferenced). */
const workflowEngine = new WorkflowEngine();

/* ─── Deployment tier manager ────────────────────────────────
 * Gates certain features (hardware wallet, multi-sig, compliance
 * module) by deployment tier. We now consult this on `init-wallet`
 * and `wallet_getCapabilities` to advertise only the features the
 * active tier is allowed to use. Previously instantiated but
 * unreferenced. */

// ─── State Persistence ────────────────────────────────────────────
const statePersistence = new StatePersistence(storageAdapter);
const contactBookController = new ContactBookController(
  statePersistence,
  broadcastContactsUpdated,
);

/* ─── SW lifecycle orchestrator ────────────────────────────────
 * Every critical subsystem registers a `LifecycleStage` here so we
 * run the MV3 onInstalled / onStartup / onSuspend / first-message
 * protocol in a single auditable place. See
 * `./background/sw-lifecycle.ts` for the full contract.
 */
const backgroundLogger = new Logger({
  component: "background",
  sinks: [CONSOLE_SINK],
  minLevel: "info",
});
const backgroundTracer = new BasicTracer({
  resource: { "service.name": "wallet-extension-background" },
});
const swLifecycle = new SwLifecycle(backgroundLogger, backgroundTracer, {
  currentVersion: (() => {
    try {
      return chrome.runtime?.getManifest?.()?.version ?? "0.0.0";
    } catch {
      return "0.0.0";
    }
  })(),
});
let initializationPromise: Promise<void> | null = null;

// ─── Pending Approvals ────────────────────────────────────────────
/**
 * A pending approval is an in-flight request that needs a user decision
 * before it can proceed. The `summary` field is the serializable payload
 * that crosses the bridge to the popup (with the structured `detail`
 * attached); `resolve` is the promise callback that unblocks the waiting
 * handler. `createdAt` + `expiresAt` support TTL auto-rejection and the
 * persistence layer below.
 */
interface PendingApproval {
  summary: ApprovalSummary;
  /** Legacy intent request shape — kept for the Aethelred Connect path. */
  intentRequest: IntentRequest;
  /** Callback invoked when the user approves or rejects. */
  resolve: (decision: "approved" | "rejected") => void;
  createdAt: number;
  expiresAt: number;
}

const FIRST_PARTY_APP_MATCHERS: Array<{
  id: string;
  name: string;
  patterns: RegExp[];
}> = [
  {
    id: "cruzible",
    name: "Cruzible",
    patterns: [/^cruzible\.aethelred\.(org|io|network)$/i],
  },
  {
    id: "terraqura",
    name: "TerraQura",
    patterns: [
      /^terraqura\.aethelred\.(org|io|network)$/i,
      /^(app\.)?terraqura\.io$/i,
    ],
  },
  {
    id: "zeroid",
    name: "ZeroID",
    patterns: [
      /^zeroid\.aethelred\.(org|io|network)$/i,
      /^(id|app)\.zeroid\.aethelred\.(org|io|network)$/i,
    ],
  },
  {
    id: "noblepay",
    name: "NoblePay",
    patterns: [/^noblepay\.aethelred\.(org|io|network)$/i],
  },
  {
    id: "shiora",
    name: "Shiora",
    patterns: [/^shiora\.aethelred\.(org|io|network)$/i],
  },
];

function normalizeOrigin(input: string): { origin: string; host: string | null } {
  try {
    const parsed = new URL(input);
    // Custom transports such as `walletconnect:<topic>` have an opaque
    // URL origin (`"null"`). Keep the full transport identity instead of
    // collapsing every such caller into the same session origin.
    if (parsed.origin === "null") {
      return {
        origin: input,
        host: parsed.hostname ? parsed.hostname.toLowerCase() : null,
      };
    }
    return {
      origin: parsed.origin,
      host: parsed.hostname.toLowerCase(),
    };
  } catch {
    return {
      origin: input,
      host: null,
    };
  }
}

function resolveAppIdentity(input: string): AppIdentity {
  const normalized = normalizeOrigin(input);

  if (normalized.host) {
    for (const app of FIRST_PARTY_APP_MATCHERS) {
      if (app.patterns.some((pattern) => pattern.test(normalized.host!))) {
        return {
          id: app.id,
          name: app.name,
          origin: normalized.origin,
          trustLevel: "first-party",
        };
      }
    }
  }

  return {
    id: normalized.host ?? input,
    name: input,
    origin: normalized.origin,
    trustLevel: "unverified",
  };
}

function formatAppRequestLabel(app: AppIdentity): string {
  if (app.name === app.origin || app.origin === "popup") {
    return app.name;
  }

  return `${app.name} (${app.origin})`;
}

const pendingApprovals = new Map<string, PendingApproval>();

/*
 * The persistence + rehydration plumbing that used to live inline here
 * has been extracted to `./background/stages/pending-approvals-stage.ts`
 * so every critical subsystem shares one lifecycle contract. The
 * wrapper functions below delegate to the stage-scoped helpers while
 * preserving the same `persistPendingApprovals()` / `rehydratePendingApprovals()`
 * call sites the rest of this file relies on.
 */
const {
  stage: pendingApprovalsStageInstance,
  persist: persistPendingApprovalsImpl,
  rehydrate: rehydratePendingApprovalsImpl,
} = buildPendingApprovalsStage({ pendingApprovals });

async function persistPendingApprovals(): Promise<void> {
  await persistPendingApprovalsImpl();
}

/**
 * Disconnecting a site invalidates not only future signing requests but also
 * any approval it already has waiting in the popup. Otherwise a stale
 * approval could resume after revocation and sign under authority that no
 * longer exists.
 */
function rejectPendingApprovalsForOrigin(origin: string): number {
  const canonicalOrigin = normalizeOrigin(origin).origin;
  let rejected = 0;
  for (const [approvalId, pending] of pendingApprovals) {
    const approvalOrigin = normalizeOrigin(
      pending.summary.origin ?? pending.intentRequest.app.origin,
    ).origin;
    if (approvalOrigin !== canonicalOrigin) continue;
    pending.summary.status = "rejected";
    pendingApprovals.delete(approvalId);
    pending.resolve("rejected");
    rejected += 1;
  }
  if (rejected > 0) persistPendingApprovals().catch(() => {});
  return rejected;
}

/**
 * Backwards-compatible wrapper retained for external test harnesses
 * that still call the old name. The lifecycle `onStartup` path runs
 * the rehydration automatically; this wrapper delegates to the same
 * stage helper for anyone calling it directly (mostly tests).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function rehydratePendingApprovals(): Promise<void> {
  await rehydratePendingApprovalsImpl();
}
// Keep the export compile-error-free without implying the function is
// dead — the lifecycle stage replaces the original call site but the
// name remains as a public debug hook.
void rehydratePendingApprovals;

/**
 * Attempt to open the extension popup so the user can see a new
 * approval that just landed. `chrome.action.openPopup()` is MV3
 * and requires Chrome 127+; it's a no-op in older browsers and
 * silently fails when the popup is already open — both cases are
 * fine. We swallow errors because a missing popup is not a
 * security-critical failure (the approval still queues; the user
 * can open the popup manually and it will be visible in the
 * ApprovalsView).
 */
async function openPopupSafely(): Promise<void> {
  try {
    const action = (chrome as unknown as {
      action?: { openPopup?: () => Promise<void> };
    }).action;
    if (action?.openPopup) {
      await action.openPopup();
    }
  } catch {
    // Many conditions legitimately fail here:
    //   - popup already open
    //   - browser doesn't support MV3 openPopup (Firefox, older Chrome)
    //   - user gesture restriction (some platforms require a click)
    // None are fatal.
  }
}

/* ─── Active account tracking ──────────────────────────────────
 * The active account is the one the user has currently selected in
 * the popup. It's persisted across service-worker restarts via
 * `statePersistence`. Defaults to the first account if unset.
 * Every RPC handler that needs "from" reads via `getActiveAccount()`. */
let activeAccountId: string | null = null;

function getActiveAccount() {
  const accounts = keyManager.getAccounts();
  if (accounts.length === 0) return null;
  if (activeAccountId) {
    const found = accounts.find((a) => a.id === activeAccountId);
    if (found) return found;
  }
  return accounts[0];
}

/* ─── Draft transactions (popup-initiated flow — GAP C) ──────
 * When the popup calls `prepare-tx`, we compute nonce + gas + simulation
 * and stash the full unsigned-tx fields in this map. A subsequent
 * `execute-tx` call looks up the draft by id, signs it with the same
 * key slot, and broadcasts. This two-step flow avoids the deadlock
 * where send.tsx would await its own approval while being unmounted
 * by a navigate-to-approvals action.
 *
 * Drafts expire after 10 minutes to prevent stale data from being
 * broadcast with an outdated nonce / gas price. */
interface DraftTx {
  id: string;
  from: string;
  to: string | null;
  value: bigint;
  data: Uint8Array;
  nonce: number;
  /** Exact manager that allocated the nonce (may no longer be globally active). */
  txManager: TxManager;
  /** Replacement drafts reuse an already-broadcast nonce and do not own it. */
  ownsNonce: boolean;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  chainId: string;
  chainEpoch: number;
  createdAt: number;
  keySlotId: string;
  origin: string;
  subjectId: string;
  workspaceId: string;
  /** Persisted capacity held from policy evaluation through broadcast. */
  velocityReservationId: string;
  /** Exact policy inputs retained for mandatory execute-time revalidation. */
  spending: ResolvedTransactionSpending;
  /** USD value at prepare time (undefined when unpriced) — velocity record. */
  amountUsd?: number;
  /** Authoritative asset identity used by the policy/velocity ledger. */
  assetSymbol?: string;
}
const draftTxs = new Map<string, DraftTx>();
const DRAFT_TX_TTL_MS = 10 * 60 * 1000;

function releaseDraftNonce(draft: DraftTx): void {
  if (!draft.ownsNonce) return;
  draft.ownsNonce = false;
  draft.txManager.releaseNonce(draft.from, draft.nonce);
}

/* ─── Transaction spending resolution ─────────────────────────
 * A native transfer carries its amount in tx.value. A standard ERC-20
 * transfer carries the real recipient and amount in calldata while tx.value
 * is normally zero. Treating every transaction as native therefore let token
 * sends bypass amount, destination and velocity policies.
 *
 * The resolver below is deliberately strict:
 *   - transfer(address,uint256) must be canonical ABI (selector + 2 words)
 *   - token identity/decimals come from TokenListService on the active chain
 *   - token price comes from PriceService and must be positive + fresh
 *   - unknown/malformed token calls fail closed
 *   - known but unpriced tokens are marked for explicit high-risk review
 */
const ERC20_TRANSFER_SELECTOR = "a9059cbb";
const ERC20_DECIMALS_SELECTOR = "0x313ce567";
const ERC20_TRANSFER_CALLDATA_HEX_LENGTH = 8 + 64 + 64;
const MAX_POLICY_PRICE_AGE_MS = 5 * 60 * 1000;

class TransactionSpendingResolutionError extends Error {
  constructor(
    message: string,
    readonly code: number = 4001,
  ) {
    super(message);
    this.name = "TransactionSpendingResolutionError";
  }
}

interface ResolvedTransactionSpending {
  destination?: string;
  destinationCategory: "known-contact" | "unknown";
  amount: number;
  amountUsd?: number;
  assetId: string;
  assetSymbol: string;
  assetCategory: "native" | "stablecoin" | "governance" | "unknown";
  requestedOperationCount24h?: number;
  cumulativeValueSpentUsd24h?: number;
  priced: boolean;
  amountBaseUnits: bigint;
  /** Verified decimals used to produce the immutable approval amount. */
  assetDecimals: number;
  tokenContract?: string;
  decodedRecipient?: string;
  requiresHighRiskReview: boolean;
  reviewWarnings: string[];
}

type ReviewedTxSpending = NonNullable<
  Extract<ApprovalDetail, { kind: "tx" }>["reviewedSpending"]
>;

function formatExactBaseUnits(value: bigint, decimals: number): string {
  if (value < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new TransactionSpendingResolutionError("Invalid exact spending amount metadata");
  }
  if (decimals === 0) return value.toString();
  const digits = value.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function buildReviewedTxSpending(
  spending: ResolvedTransactionSpending,
  transactionTo: string | null,
  transactionValue: string,
): ReviewedTxSpending {
  const nativeValue = `0x${hexToBigInt(transactionValue).toString(16)}`;
  const amount = formatExactBaseUnits(
    spending.amountBaseUnits,
    spending.assetDecimals,
  );

  if (spending.tokenContract) {
    if (!spending.decodedRecipient || nativeValue !== "0x0") {
      throw new TransactionSpendingResolutionError(
        "ERC-20 approval facts are incomplete or include native value",
      );
    }
    return {
      kind: "erc20",
      recipient: spending.decodedRecipient,
      amount,
      amountBaseUnits: spending.amountBaseUnits.toString(),
      decimals: spending.assetDecimals,
      symbol: spending.assetSymbol,
      tokenContract: spending.tokenContract,
      nativeValue: "0x0",
    };
  }

  return {
    kind: "native",
    recipient: transactionTo,
    amount,
    amountBaseUnits: spending.amountBaseUnits.toString(),
    decimals: spending.assetDecimals,
    symbol: spending.assetSymbol,
    nativeValue,
  };
}

function decodeCanonicalErc20Transfer(
  data: string | undefined,
): { recipient: string; amountBaseUnits: bigint } | null {
  const rawCalldata = data ?? "0x";
  if (/^a9059cbb/i.test(rawCalldata)) {
    throw new TransactionSpendingResolutionError(
      "Malformed ERC-20 transfer calldata; a 0x prefix is required",
      -32602,
    );
  }
  const calldata = rawCalldata.toLowerCase();
  if (!calldata.startsWith(`0x${ERC20_TRANSFER_SELECTOR}`)) return null;

  const body = calldata.slice(2);
  if (
    body.length !== ERC20_TRANSFER_CALLDATA_HEX_LENGTH ||
    !/^[0-9a-f]+$/.test(body)
  ) {
    throw new TransactionSpendingResolutionError(
      "Malformed ERC-20 transfer calldata; expected canonical transfer(address,uint256)",
      -32602,
    );
  }

  const recipientWord = body.slice(8, 72);
  if (!/^0{24}[0-9a-f]{40}$/.test(recipientWord)) {
    throw new TransactionSpendingResolutionError(
      "Malformed ERC-20 transfer recipient encoding",
      -32602,
    );
  }

  return {
    recipient: `0x${recipientWord.slice(24)}`,
    amountBaseUnits: BigInt(`0x${body.slice(72, 136)}`),
  };
}

function classifyPolicyToken(symbol: string): "stablecoin" | "governance" | "unknown" {
  const normalized = symbol.toUpperCase();
  if (["USDC", "USDT", "DAI"].includes(normalized)) return "stablecoin";
  if (["UNI", "AAVE"].includes(normalized)) return "governance";
  return "unknown";
}

async function resolveTransactionSpending(
  tx: { to?: string; value?: string; data?: string },
  subjectId: string,
  chainContext: TransactionChainContext,
): Promise<ResolvedTransactionSpending> {
  const network = chainContext.network;
  const velocity = await velocityTracker.getVelocity(subjectId);
  const ownAddresses = keyManager.getAccounts().map((account) => account.address);
  const decodedTransfer = decodeCanonicalErc20Transfer(tx.data);

  if (!decodedTransfer) {
    const native = buildSpendingFields({
      to: tx.to,
      valueWei: hexToBigInt(tx.value ?? "0x0"),
      decimals: network.nativeCurrency.decimals,
      symbol: network.nativeCurrency.symbol,
      // Aethelred's native asset has no configured authoritative market feed.
      // Keep policy evaluation explicitly unpriced instead of inventing a USD
      // value. This forces the high-risk review path for non-zero transfers.
      priceUsd: null,
      ownAddresses,
      velocity,
    });
    return {
      ...native,
      assetId: "native",
      amountBaseUnits: hexToBigInt(tx.value ?? "0x0"),
      assetDecimals: network.nativeCurrency.decimals,
      requiresHighRiskReview: false,
      reviewWarnings: [],
    };
  }

  if (!tx.to) {
    throw new TransactionSpendingResolutionError(
      "ERC-20 transfer is missing its token contract address",
      -32602,
    );
  }
  if (hexToBigInt(tx.value ?? "0x0") !== 0n) {
    throw new TransactionSpendingResolutionError(
      "ERC-20 transfer with a non-zero native value cannot be evaluated safely",
    );
  }

  const chainId = parseInt(chainContext.chainId, 16);
  const token = tokenListService
    .getTokensForChain(chainId)
    .find(
      (entry) =>
        !entry.isNative && entry.address.toLowerCase() === tx.to!.toLowerCase(),
    );
  if (!token) {
    throw new TransactionSpendingResolutionError(
      `ERC-20 token ${tx.to} is not in the authoritative token list for chain ${chainId}`,
    );
  }
  if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255) {
    throw new TransactionSpendingResolutionError(
      `ERC-20 token ${token.symbol} has invalid authoritative decimals metadata`,
    );
  }

  // Custom-token entries originate from a user/dApp watch-token request, so
  // their decimals are not authoritative by themselves. Validate every token
  // (curated and custom) against the active-chain contract before doing policy
  // math; this also catches a stale curated entry after a proxy/config change.
  let onChainDecimals: number;
  try {
    const encoded = await chainContext.rpcClient.call<string>("eth_call", [
      { to: token.address, data: ERC20_DECIMALS_SELECTOR },
      "latest",
    ]);
    if (!/^0x[0-9a-fA-F]{64}$/.test(encoded)) {
      throw new Error("decimals() returned a non-canonical ABI value");
    }
    const decoded = BigInt(encoded);
    if (decoded > 255n) {
      throw new Error("decimals() returned a value outside uint8 range");
    }
    onChainDecimals = Number(decoded);
  } catch (error) {
    throw new TransactionSpendingResolutionError(
      `Could not verify ERC-20 decimals for ${token.symbol}: ${error instanceof Error ? error.message : "RPC failure"}`,
    );
  }
  if (onChainDecimals !== token.decimals) {
    throw new TransactionSpendingResolutionError(
      `ERC-20 decimals mismatch for ${token.symbol}: token list says ${token.decimals}, contract says ${onChainDecimals}`,
    );
  }

  let priceUsd: number | null = null;
  // PriceService's ERC-20 address map is currently Ethereum-mainnet scoped.
  // Never apply that quote to an address collision on another chain.
  if (chainId === 1) {
    try {
      const price = await chainContext.priceService.getPrice(token.address);
      const fresh =
        price !== null &&
        Number.isFinite(price.lastUpdated) &&
        price.lastUpdated > 0 &&
        Date.now() - price.lastUpdated <= MAX_POLICY_PRICE_AGE_MS;
      if (
        price !== null &&
        price.address.toLowerCase() === token.address.toLowerCase() &&
        Number.isFinite(price.priceUsd) &&
        price.priceUsd > 0 &&
        fresh
      ) {
        priceUsd = price.priceUsd;
      }
    } catch {
      // PriceService is best-effort; the explicit high-risk path below is the
      // fail-safe when its authoritative provider is unavailable.
    }
  }

  const tokenFields = buildSpendingFields({
    to: decodedTransfer.recipient,
    valueWei: decodedTransfer.amountBaseUnits,
    decimals: onChainDecimals,
    symbol: token.symbol,
    priceUsd,
    ownAddresses,
    velocity,
  });
  if (
    decodedTransfer.amountBaseUnits > 0n &&
    (!Number.isFinite(tokenFields.amount) || tokenFields.amount <= 0)
  ) {
    throw new TransactionSpendingResolutionError(
      `ERC-20 amount for ${token.symbol} cannot be represented safely for policy evaluation`,
    );
  }
  if (tokenFields.amountUsd !== undefined && !Number.isFinite(tokenFields.amountUsd)) {
    throw new TransactionSpendingResolutionError(
      `ERC-20 USD value for ${token.symbol} cannot be represented safely for policy evaluation`,
    );
  }

  const requiresHighRiskReview = !tokenFields.priced && decodedTransfer.amountBaseUnits > 0n;
  const reviewWarnings = [
    `ERC-20 transfer: ${tokenFields.amount} ${token.symbol} to ${decodedTransfer.recipient}. Token contract: ${token.address}.`,
    ...(requiresHighRiskReview
      ? [
        `${token.symbol} has no fresh authoritative USD price. Explicit high-risk review is required; USD spend-limit and value-velocity checks are unavailable.`,
      ]
      : []),
  ];

  return {
    ...tokenFields,
    assetId: token.address.toLowerCase(),
    assetCategory: classifyPolicyToken(token.symbol),
    amountBaseUnits: decodedTransfer.amountBaseUnits,
    assetDecimals: onChainDecimals,
    tokenContract: token.address,
    decodedRecipient: decodedTransfer.recipient,
    requiresHighRiskReview,
    reviewWarnings,
  };
}

// Prune expired drafts on a timer to avoid memory accumulation
setInterval(async () => {
  const now = Date.now();
  for (const [id, draft] of draftTxs) {
    if (now - draft.createdAt > DRAFT_TX_TTL_MS) {
      draftTxs.delete(id);
      releaseDraftNonce(draft);
      await releaseVelocityReservation(draft.velocityReservationId, "draft expired");
    }
  }
}, 60_000);

/* ─── Per-chain transaction history (GAP I) ──────────────────
 * `TxManager` holds one in-memory list of pending transactions
 * scoped to the current chain. When we `switchChain()`, we
 * construct a NEW `TxManager` and the old one's list is lost.
 * This map remembers every tx we've tracked across chain switches
 * so the UI can surface history for any chain, not just the
 * currently-active one. Stored keyed by chainId.
 *
 * On switchChain() we snapshot the outgoing TxManager's list into
 * this map, then rehydrate the incoming TxManager from the map
 * entry for the new chainId. */
const txHistoryByChain = new Map<string, PendingTransaction[]>();

function snapshotCurrentChainTxHistory(chainId: string): void {
  try {
    txHistoryByChain.set(chainId, txManager.getAll());
  } catch { /* nothing to snapshot */ }
}

function restoreChainTxHistory(chainId: string): void {
  const list = txHistoryByChain.get(chainId);
  if (!list) return;
  for (const tx of list) {
    // Re-register the tracked tx on the new TxManager so getAll() returns it
    const restored = txManager.trackTransaction({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      nonce: tx.nonce,
      gasLimit: tx.gasLimit,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      gasPrice: tx.gasPrice,
      data: tx.data,
      chainId: tx.chainId,
    });
    // trackTransaction initializes lifecycle fields as a fresh pending send.
    // Restore the authoritative snapshot immediately so confirmed, failed,
    // and dropped records cannot be resurrected as pending after chain switch.
    Object.assign(restored, tx);
  }
}

/** Current manager wins over older chain snapshots for the same exact hash. */
function collectTrackedTransactions(): PendingTransaction[] {
  const byHash = new Map<string, PendingTransaction>();
  for (const list of txHistoryByChain.values()) {
    for (const transaction of list) {
      byHash.set(transaction.hash.toLowerCase(), transaction);
    }
  }
  for (const transaction of txManager.getAll()) {
    byHash.set(transaction.hash.toLowerCase(), transaction);
  }
  return Array.from(byHash.values()).sort(
    (left, right) => right.submittedAt - left.submittedAt,
  );
}

// ─── Chain Switching ──────────────────────────────────────────────
function switchChain(chainId: string): void {
  // Snapshot the outgoing chain's tracked txs before we replace TxManager
  snapshotCurrentChainTxHistory(networkManager.getActiveChainId());

  const network = networkManager.switchChain(chainId);
  rpcClient = new RpcClient({
    url: network.rpcUrl,
    timeoutMs: 15_000,
    maxRetries: 3,
  });
  balanceFetcher = new BalanceFetcher(rpcClient, network.nativeCurrency);
  stakingPositionFetcher = new StakingPositionFetcher(rpcClient);
  gasOracle = new GasOracle(rpcClient);
  txManager = new TxManager(rpcClient);
  // Fresh price service: the native-asset market id is per-network, and a
  // rebuilt cache prevents one chain's native price leaking onto another's.
  priceService = new PriceService({
    nativeCoingeckoId: network.nativeCoingeckoId ?? null,
  });
  // Restore any previously-tracked txs for the new chain
  restoreChainTxHistory(chainId);
  activeChainEpoch += 1;
}

// ─── State Builder ────────────────────────────────────────────────
function buildWalletState(): AethelredWalletState {
  const subject = subjectRegistry.getActive();
  const workspace = workspaceRegistry.getActive();
  const role = subject && workspace
    ? workspaceRegistry.getRole(subject.id, workspace.id) ?? "owner"
    : "owner";

  const accounts = keyManager.getAccounts().map((acc) => ({
    id: acc.id,
    label: acc.label,
    address: acc.address,
    namespace: acc.namespace,
    custody: "local" as const,
    assurance: "device-key" as const,
  }));

  // Resolve the active account id — if the stored id no longer exists
  // (e.g. user deleted the account), fall back to the first available.
  const resolvedActiveId = (() => {
    if (activeAccountId && accounts.some((a) => a.id === activeAccountId)) {
      return activeAccountId;
    }
    return accounts[0]?.id;
  })();

  // Preserve raw authoritative fields; presentation layers may derive human
  // units, but background history must never invent an amount or asset label.
  const txHistory = collectTrackedTransactions().slice(0, 100).map((tx) => ({
    ...tx,
  }));

  return {
    mode: workspace?.kind ?? "personal",
    locked: masterKey.isLocked(),
    subject: subject
      ? toSubjectSummary(subject)
      : { id: "unknown", displayName: "Unknown", kind: "person" },
    activeWorkspace: workspace
      ? toWorkspaceSummary(workspace, role)
      : { id: "default", name: "AETHELRED", kind: "personal", role: "owner", summary: "Default personal workspace" },
    accounts,
    activeAccountId: resolvedActiveId,
    policy: {
      mode: workspace ? getDefaultPolicyBundle(workspace.kind).mode : "guided",
      highlights: workspace
        ? getDefaultPolicyBundle(workspace.kind).rules.slice(0, 3).map((r) => r.message)
        : ["Personal mode with guided policy."],
    },
    sessions: sessionManager.toSummaries(),
    pendingApprovals: Array.from(pendingApprovals.values()).map((p) => p.summary),
    catalog: getWalletAppCatalog(),
    txHistory,
  };
}

// ─── Broadcast to popup ──────────────────────────────────────────
function broadcastState(): void {
  const state = buildWalletState();
  try {
    chrome.runtime.sendMessage({ kind: "state-update", correlationId: "", payload: state, timestamp: Date.now() }).catch(() => {});
  } catch { /* popup may not be open */ }
}

async function broadcastContactsUpdated(snapshot: ContactBookSnapshot): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      kind: "contacts-updated",
      correlationId: "",
      payload: snapshot,
      timestamp: Date.now(),
    });
  } catch {
    // The popup may not be open. The committed background snapshot remains
    // authoritative and will be returned by contacts-list on its next mount.
  }
}

/**
 * Broadcast the current lock state to the popup. The popup's App gate routes
 * on `lockState.initialized`/`lockState.locked`, but it only refreshes that
 * value from a `lock-state` message (or the one-time `popup-ready` response) —
 * `broadcastState` carries wallet data, not lock state. Without this, creating
 * or importing a wallet leaves the popup's `initialized` flag stale at false,
 * so finishing onboarding bounces the user back to the creation screen. Emit
 * this after every lock-state transition (init, import, unlock, lock).
 */
async function broadcastLockState(): Promise<void> {
  const payload = { locked: masterKey.isLocked(), initialized: await masterKey.isInitialized() };
  try {
    await chrome.runtime.sendMessage({ kind: "lock-state", correlationId: "", payload, timestamp: Date.now() });
  } catch { /* popup may not be open */ }

  // Saved recipients are private wallet data. Clear the popup projection on
  // lock and republish the authoritative snapshot on initialization/unlock.
  // PersistentAddressBook starts listening before its initial contacts-list
  // request, so this also completes hydration after an expected locked-state
  // refusal without requiring a second request race.
  const snapshot = contactBookController.snapshot();
  await broadcastContactsUpdated(
    payload.locked ? { ...snapshot, contacts: [] } : snapshot,
  );
}

function hasExactActiveProviderSession(sessionId: string, origin: string): boolean {
  const session = sessionManager.get(sessionId);
  return Boolean(
    session &&
    session.origin === origin &&
    isProviderSessionActive(session) &&
    sessionManager.getByOrigin(origin)?.id === sessionId,
  );
}

function providerEventDeliveryStillAuthorized(delivery: ProviderEventDelivery): boolean {
  const session = sessionManager.get(delivery.target.sessionId);
  if (!session || session.origin !== delivery.target.origin) return false;

  if (delivery.target.status === "revoked") {
    // Do not let a delayed revoke event clear a replacement session that the
    // same origin established before tabs.query completed.
    return session.status === "revoked" && !sessionManager.getByOrigin(session.origin);
  }

  if (!hasExactActiveProviderSession(session.id, session.origin)) {
    return false;
  }
  return (
    !delivery.requiredAccount ||
    session.accountAddresses.some(
      (address) => address.toLowerCase() === delivery.requiredAccount!.toLowerCase(),
    )
  );
}

/**
 * Deliver already-scoped EIP-1193 events only to tabs whose browser URL
 * matches the exact authorized origin. The session is revalidated inside the
 * asynchronous tabs callback so revoke/reconnect cannot redirect a stale
 * event to a replacement session for the same origin.
 */
function deliverProviderEvents(deliveries: readonly ProviderEventDelivery[]): void {
  if (deliveries.length === 0) return;
  try {
    chrome.tabs.query({}, (tabs: chrome.tabs.Tab[]) => {
      for (const delivery of deliveries) {
        if (!providerEventDeliveryStillAuthorized(delivery)) continue;
        for (const tab of tabs) {
          if (tab.id == null || !tabMatchesProviderEventOrigin(tab.url, delivery.target.origin)) continue;
          chrome.tabs.sendMessage(tab.id, delivery.message).catch(() => {
            // Tabs without the content script silently fail — expected.
          });
        }
      }
    });
  } catch {
    // chrome.tabs may be unavailable in tests.
  }
}

/**
 * Broadcast only across active, exact sessions. accountsChanged is
 * independently intersected with each session's approved addresses. Generic
 * `message` events fail closed unless an exact initiating session is supplied.
 */
function broadcastProviderEvent(
  event: string,
  payload: unknown,
  options: { exactSessionId?: string; requiredAccount?: string } = {},
): void {
  deliverProviderEvents(
    planProviderEventDeliveries(sessionManager.list(), event, payload, options),
  );
}

/** The one event intentionally delivered after revoke: accountsChanged([]). */
function broadcastRevokedAccounts(session: SessionGrant): void {
  deliverProviderEvents([planRevokedAccountsDelivery(session)]);
}

/**
 * Finish the non-authority side effects for grants that crossed expiresAt.
 * SessionManager revokes synchronously, so no request can use an expired
 * grant; this drains those transitions into durable/UI/subscription cleanup.
 */
function cleanupExpiredSessions(): void {
  sessionManager.revokeExpired();
  const expiredSessions = sessionManager.drainExpiredRevocations();
  if (expiredSessions.length === 0) return;

  for (const session of expiredSessions) {
    stopSubscriptionsForSession(session.id);
    const rejectedApprovals = rejectPendingApprovalsForOrigin(session.origin);
    auditCapture.record({
      kind: "session-revoked",
      subjectId: getPersistedPasskeySubjectId() ?? "unknown",
      workspaceId: workspaceRegistry.getActive()?.id ?? "unknown",
      appId: session.appId,
      detail: {
        sessionId: session.id,
        origin: session.origin,
        reason: "expired",
        rejectedApprovals,
      },
    });
  }
  persistState();
  void statePersistence.saveNow().catch((error) => {
    backgroundLogger.error(
      "sessions.expiredCleanup.persistFailed",
      "Failed to persist expired-session cleanup.",
      { error },
    );
  });
  broadcastState();
  for (const session of expiredSessions) broadcastRevokedAccounts(session);
}

// MasterKey owns the idle timer, while the background owns all observable
// wallet state. Keep the two in sync so an automatic lock is never an
// invisible keyring-only transition.
masterKey.setAutoLockHandler(async () => {
  custody.clearCache();
  persistState();
  auditCapture.record({
    kind: "lock-state-changed",
    subjectId: subjectRegistry.getActive()?.id ?? "unknown",
    workspaceId: workspaceRegistry.getActive()?.id ?? "unknown",
    detail: { locked: true, reason: "idle-timeout" },
  });
  broadcastState();
  await broadcastLockState();
  broadcastProviderEvent("disconnect", {
    code: 4900,
    message: "Wallet auto-locked after inactivity",
  });
  broadcastProviderEvent("accountsChanged", []);
});

// ─── Persist state on changes ─────────────────────────────────────
function persistState(): void {
  statePersistence.update({
    subjects: subjectRegistry.toSnapshot().subjects,
    activeSubjectId: subjectRegistry.toSnapshot().activeId,
    workspaces: workspaceRegistry.toSnapshot().workspaces,
    workspaceRoles: workspaceRegistry.toSnapshot().roles,
    activeWorkspaceId: workspaceRegistry.toSnapshot().activeId,
    sessions: sessionManager.toSnapshot(),
    activeChainId: networkManager.getActiveChainId(),
    auditSequence: auditCapture.getSequenceNumber(),
    auditLastHash: auditCapture.getPreviousHash(),
  });
}

// ─── Message Handler ──────────────────────────────────────────────
/*
 * Every bridge message blocks on `ensureBooted()` before the handler
 * runs. This is the MV3 cold-start fix: the first message after SW
 * wake would previously see `AuditCapture.sequenceNumber === 0` and
 * other stale state; now it waits for the lifecycle to rehydrate.
 *
 * Concurrent messages arriving during boot all await the SAME boot
 * promise — there is no thundering-herd amplification.
 */
chrome.runtime.onMessage.addListener(
  (message: BridgeMessage, sender, sendResponse) => {
    (async () => {
      try {
        await ensureInitialized();
        await swLifecycle.ensureBooted();
        const response = await handleMessage(message, sender);
        sendResponse(response);
      } catch (error) {
        sendResponse({
          kind: "rpc-response",
          correlationId: message.correlationId,
          payload: { error: { code: -32603, message: error instanceof Error ? error.message : "Internal error" } },
          timestamp: Date.now(),
        });
      }
    })();
    return true;
  }
);

async function handleMessage(
  message: BridgeMessage,
  sender: chrome.runtime.MessageSender
): Promise<BridgeMessage> {
  const respond = (payload: unknown): BridgeMessage => ({
    kind: "rpc-response",
    correlationId: message.correlationId,
    payload,
    timestamp: Date.now(),
  });

  if (DISABLED_WALLETCONNECT_KINDS.has(message.kind)) {
    return respond({
      error: {
        code: 4200,
        message: "WalletConnect is disabled until the audited WalletConnect v2 SDK transport is packaged",
      },
    });
  }

  const credentialReleaseError = getCredentialReleaseError(message.kind);
  if (credentialReleaseError) {
    return respond({ error: credentialReleaseError });
  }

  const tenantMigrationReleaseError = getTenantMigrationReleaseError(message.kind);
  if (tenantMigrationReleaseError) {
    return respond({ error: tenantMigrationReleaseError });
  }

  switch (message.kind) {
    case "get-state":
    case "popup-ready":
      return respond({
        result: buildWalletState(),
        lockState: { locked: masterKey.isLocked(), initialized: await masterKey.isInitialized() },
      });

    case "contacts-list": {
      if (!isTrustedWalletPage(sender)) {
        return respond({ error: { code: 4100, message: "Saved recipients are only available to trusted wallet pages" } });
      }
      if (masterKey.isLocked()) {
        return respond({ error: { code: 4100, message: "Unlock the wallet to view saved recipients" } });
      }
      return respond({ result: contactBookController.snapshot() });
    }

    case "contacts-add":
    case "contacts-update":
    case "contacts-delete": {
      if (!isTrustedWalletPage(sender)) {
        return respond({ error: { code: 4100, message: "Saved recipients are only available to trusted wallet pages" } });
      }
      if (masterKey.isLocked()) {
        return respond({ error: { code: 4100, message: "Unlock the wallet to edit saved recipients" } });
      }
      try {
        const snapshot = message.kind === "contacts-add"
          ? await contactBookController.add(message.payload)
          : message.kind === "contacts-update"
            ? await contactBookController.update(message.payload)
            : await contactBookController.delete(message.payload);
        return respond({ result: snapshot });
      } catch (error) {
        if (error instanceof ContactBookValidationError) {
          return respond({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    }

    case AUDIT_METRICS_SNAPSHOT_KIND:
      // PR #115 — popup-side debug visibility into audit observability
      // counters. No-op heavy; just reads the in-memory meter state.
      // Available regardless of whether VITE_AUDIT_METRICS_OTLP_URL
      // was set at build time (the snapshot reflects the local
      // accumulated state).
      return respond({
        result: getAuditMetricsSnapshot(
          auditMeter,
          auditMetricsExporter,
          AUDIT_METRICS_OTLP_URL,
        ),
      });

    case "init-wallet": {
      const { password, label } = message.payload as { password: string; label?: string };
      await masterKey.initialize(password);
      let created: Awaited<ReturnType<typeof keyManager.createWallet>>;
      try {
        created = await keyManager.createWallet(label);
      } catch (error) {
        await keyManager.discardFailedInitialization();
        custody.clearCache();
        await masterKey.rollbackInitialization();
        throw error;
      }
      const { mnemonic, account } = created;

      const subjectId = `subject-${account.id}`;
      subjectRegistry.create({ id: subjectId, displayName: "Wallet Owner", kind: "person", workspaceIds: [], credentialIds: [], createdAt: Date.now() });
      const workspace = workspaceRegistry.createWorkspace("AETHELRED", "personal", "Default personal workspace.", subjectId);
      workspaceRegistry.addAccountToWorkspace(workspace.id, account.id);

      auditCapture.record({ kind: "wallet-initialized", subjectId, workspaceId: workspace.id, detail: { address: account.address } });
      persistState();
      broadcastState();
      await broadcastLockState();
      return respond({ result: { mnemonic, address: account.address } });
    }

    case "import-wallet": {
      const { password, mnemonic, label } = message.payload as { password: string; mnemonic: string[]; label?: string };
      await masterKey.initialize(password);
      let imported: Awaited<ReturnType<typeof keyManager.importFromMnemonic>>;
      try {
        imported = await keyManager.importFromMnemonic(mnemonic, label);
      } catch (error) {
        await keyManager.discardFailedInitialization();
        custody.clearCache();
        await masterKey.rollbackInitialization();
        throw error;
      }
      const { account } = imported;

      const subjectId = `subject-${account.id}`;
      subjectRegistry.create({ id: subjectId, displayName: "Wallet Owner", kind: "person", workspaceIds: [], credentialIds: [], createdAt: Date.now() });
      const ws = workspaceRegistry.createWorkspace("AETHELRED", "personal", "Default personal workspace.", subjectId);
      workspaceRegistry.addAccountToWorkspace(ws.id, account.id);

      auditCapture.record({ kind: "wallet-initialized", subjectId, workspaceId: ws.id, detail: { address: account.address, imported: true } });
      persistState();
      broadcastState();
      await broadcastLockState();
      return respond({ result: { address: account.address } });
    }

    case "verify-password": {
      const { password } = message.payload as { password?: string };
      if (!masterKey.isLocked()) {
        return respond({ error: { code: 4001, message: "Wallet is already unlocked" } });
      }
      if (!password) {
        return respond({ error: { code: -32602, message: "Password is required" } });
      }
      await masterKey.verifyPassword(password);
      return respond({ result: { ok: true } });
    }

    case "unlock-request": {
      const { password, passkeyGrant } = message.payload as {
        password: string;
        passkeyGrant?: string;
      };
      const subjectId = getPersistedPasskeySubjectId();
      await consumePasskeyUnlockGrant(subjectId, passkeyGrant, password);
      await keyManager.initialize();
      // Restore persisted state
      const persisted = statePersistence.getState();
      if (persisted.subjects.length > 0) {
        subjectRegistry.loadFromSnapshot(persisted.subjects as Subject[], persisted.activeSubjectId);
        workspaceRegistry.loadFromSnapshot(
          persisted.workspaces as Workspace[],
          persisted.workspaceRoles as RoleAssignment[],
          persisted.activeWorkspaceId,
        );
        sessionManager.loadFromSnapshot(persisted.sessions as SessionGrant[]);
        // A persisted chain id may reference a network that no longer exists
        // (e.g. a default that was renamed or removed between builds).
        // switchChain throws on an unknown id; fall back to the default active
        // network rather than failing the whole unlock.
        if (persisted.activeChainId) {
          try {
            switchChain(persisted.activeChainId);
          } catch {
            /* keep the default active network */
          }
        }
      }
      auditCapture.record({ kind: "lock-state-changed", subjectId: subjectRegistry.getActive()?.id ?? "unknown", workspaceId: workspaceRegistry.getActive()?.id ?? "unknown", detail: { locked: false } });
      broadcastState();
      await broadcastLockState();
      // EIP-1193: dApps see a "connect" event with the active chain id
      broadcastProviderEvent("connect", { chainId: networkManager.getActiveChainId() });
      // And the fresh account list
      broadcastProviderEvent(
        "accountsChanged",
        keyManager.getAccounts().map((a) => a.address),
      );
      return respond({ result: { locked: false } });
    }

    case "lock-request": {
      masterKey.lock();
      custody.clearCache();
      persistState();
      auditCapture.record({ kind: "lock-state-changed", subjectId: subjectRegistry.getActive()?.id ?? "unknown", workspaceId: workspaceRegistry.getActive()?.id ?? "unknown", detail: { locked: true } });
      broadcastState();
      await broadcastLockState();
      // EIP-1193: tell dApps the wallet is gone
      broadcastProviderEvent("disconnect", { code: 4900, message: "Wallet locked" });
      broadcastProviderEvent("accountsChanged", []);
      return respond({ result: { locked: true } });
    }

    case "get-recovery-phrase":
      return respond({ result: await keyManager.getRecoveryPhrase() });

    case "approval-response": {
      const { approvalId, decision } = message.payload as { approvalId: string; decision: "approved" | "rejected" };
      const pending = pendingApprovals.get(approvalId);
      if (pending) {
        // Update status on the summary BEFORE resolve so the popup sees
        // the final state on its next state-update (useful for UI state
        // transitions that need to know what happened).
        pending.summary.status = decision;
        pending.resolve(decision);
        pendingApprovals.delete(approvalId);
        persistPendingApprovals().catch(() => {});
        broadcastState();
        auditCapture.record({
          kind: "approval-decided",
          subjectId: subjectRegistry.getActive()?.id ?? "unknown",
          workspaceId: workspaceRegistry.getActive()?.id ?? "unknown",
          detail: { approvalId, decision, kind: pending.summary.detail?.kind ?? "unknown" },
        });
        return respond({ result: { ok: true, approvalId, decision } });
      }
      // A stale card is not a successful no-op. Refresh the authoritative
      // queue and return an error so the popup cannot show a success morph or
      // navigate away after approving a request whose resolver no longer
      // exists (expired, already resolved, or discarded on SW restart).
      broadcastState();
      return respond({
        error: {
          code: -32002,
          message: "This approval is no longer pending. The approval queue was refreshed.",
        },
      });
    }

    /* ─── set-active-account (GAP H) ──────────────────────────────
     * Changes the active account id (which account "from" defaults
     * to in send.tsx / swap.tsx / eth_sendTransaction). Persists
     * across SW restarts via statePersistence. Emits accountsChanged
     * so connected dApps see the change immediately. */
    case "set-active-account": {
      const { accountId } = message.payload as { accountId: string };
      const account = keyManager.getAccounts().find((a) => a.id === accountId);
      if (!account) {
        return respond({ error: { code: -32602, message: `Account not found: ${accountId}` } });
      }
      activeAccountId = accountId;
      persistState();
      broadcastState();
      // Selecting an account outside a site's exact grant must produce an
      // empty value for that site, never the rest of the keyring.
      broadcastProviderEvent("accountsChanged", [account.address]);
      return respond({ result: { ok: true, accountId, address: account.address } });
    }

    /* ─── prepare-tx (GAP C — popup-initiated send) ───────────────
     * The popup's own send.tsx uses this path instead of the RPC
     * `eth_sendTransaction` path to avoid the deadlock where the view
     * would unmount while awaiting its own approval. This call:
     *   1. Computes nonce, gas, simulation
     *   2. Evaluates policy
     *   3. Returns the ApprovalDetail so send.tsx can render a rich
     *      inline confirm screen
     *   4. Stores the draft keyed by a fresh draftId so a subsequent
     *      execute-tx call can look it up
     *
     * Unlike the RPC path, this does NOT block on a pendingApproval —
     * the caller (popup) IS the reviewer, and the send view renders the
     * confirm UI inline. If policy says "approval-required" (a second
     * reviewer is needed via workflowEngine), we return that info and
     * let the popup render a "Waiting for N-of-M approval" state. */
    case "prepare-tx": {
      const result = await handlePrepareTx(message.payload as Record<string, unknown>);
      return respond(result);
    }

    /* ─── execute-tx (GAP C pt 2) ────────────────────────────────
     * Step 2 of the popup-initiated send flow. Takes a draftId from
     * a previous prepare-tx call, signs the stored draft, and
     * broadcasts. Returns the real tx hash.
     */
    case "execute-tx": {
      const result = await handleExecuteTx(message.payload as { draftId: string });
      return respond(result);
    }

    /* ─── cancel-tx ────────────────────────────────────────────────
     * User closed the confirm screen without approving. Removes the
     * draft and releases any reserved nonce so it can be reused. */
    case "cancel-tx": {
      const { draftId } = message.payload as { draftId: string };
      const draft = draftTxs.get(draftId);
      if (draft) {
        draftTxs.delete(draftId);
        releaseDraftNonce(draft);
        await releaseVelocityReservation(draft.velocityReservationId, "popup draft cancelled");
      }
      return respond({ result: { ok: true } });
    }

    // ── Chain data handlers (wired to packages/chain) ──

    case "get-balances": {
      const { address, tokens } = message.payload as { address: string; tokens?: Array<{ address: string; symbol: string; name: string; decimals: number }> };
      try {
        const defaultTokens = tokenListService.getTokensForChain(parseInt(networkManager.getActiveChainId(), 16)).filter(t => !t.isNative).map(t => ({ address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals }));
        const balances = await balanceFetcher.getMultipleBalances(address, tokens ?? defaultTokens);
        const prices = await priceService.getPrices(balances.map(b => b.address));
        const enriched = balances.map(b => {
          const price = prices.get(b.address.toLowerCase());
          // PriceService only caches successful provider responses. A
          // market-less native asset (AETHEL) therefore remains unpriced.
          const priceUsd = price?.priceUsd ?? null;
          // NOTE: `value` uses the numeric amount from raw base units — the
          // human-readable `balance` string is locale-formatted and
          // parseFloat truncates it at the first separator.
          const amount = baseUnitsToAmount(BigInt(b.rawBalance || "0x0"), b.decimals);
          return {
            ...b,
            priceUsd,
            change24h: price?.change24h ?? null,
            value: priceUsd === null ? null : amount * priceUsd,
          };
        });
        return respond({ result: enriched });
      } catch (error) {
        return respond({ result: [], error: error instanceof Error ? error.message : "Failed to fetch balances" });
      }
    }

    case "get-staking-position": {
      // Live Cruzible staking reader (portfolio Staking tab). The stAETHEL
      // token entry on the ACTIVE chain is the only configuration — the
      // vault address is discovered on-chain from the token's public
      // immutable, so it can never drift from the token. No token entry →
      // null (the UI shows an honest "no staking token on this network").
      const { address } = message.payload as { address: string };
      try {
        const chainId = parseInt(networkManager.getActiveChainId(), 16);
        const stToken = tokenListService
          .getTokensForChain(chainId)
          .find((t) => t.symbol === "stAETHEL");
        if (!stToken) return respond({ result: null });
        const position = await stakingPositionFetcher.getPosition(address, stToken.address);
        return respond({ result: position });
      } catch (error) {
        return respond({
          result: null,
          error: error instanceof Error ? error.message : "Failed to read staking position",
        });
      }
    }

    case "get-gas": {
      const { tx } = message.payload as { tx: { from: string; to?: string; value?: string; data?: string } };
      try {
        const estimate = await gasOracle.getFullEstimate(tx);
        const tiers = await gasOracle.getGasTiers();
        return respond({ result: { estimate: { gasLimit: estimate.gasLimit.toString(), baseFee: estimate.baseFee.toString(), maxFeePerGas: estimate.maxFeePerGas.toString(), maxPriorityFeePerGas: estimate.maxPriorityFeePerGas.toString(), estimatedCostEth: estimate.estimatedCostEth }, tiers: { slow: { ...tiers.slow, maxFeePerGas: tiers.slow.maxFeePerGas.toString(), maxPriorityFeePerGas: tiers.slow.maxPriorityFeePerGas.toString() }, standard: { ...tiers.standard, maxFeePerGas: tiers.standard.maxFeePerGas.toString(), maxPriorityFeePerGas: tiers.standard.maxPriorityFeePerGas.toString() }, fast: { ...tiers.fast, maxFeePerGas: tiers.fast.maxFeePerGas.toString(), maxPriorityFeePerGas: tiers.fast.maxPriorityFeePerGas.toString() } } } });
      } catch (error) {
        return respond({ result: null, error: error instanceof Error ? error.message : "Gas estimation failed" });
      }
    }

    case "derive-account": {
      const { label } = message.payload as { label?: string };
      try {
        const { account } = await keyManager.deriveNextAccount(label);
        const ws = workspaceRegistry.getActive();
        if (ws) workspaceRegistry.addAccountToWorkspace(ws.id, account.id);
        auditCapture.record({ kind: "account-created", subjectId: subjectRegistry.getActive()?.id ?? "unknown", workspaceId: ws?.id ?? "unknown", detail: { address: account.address, label: account.label } });
        persistState();
        broadcastState();
        // Derivation changes the wallet keyring, not any existing site's
        // exact account grant. Do not reveal the new address or wallet
        // activity through a provider event.
        return respond({ result: { address: account.address, label: account.label, id: account.id } });
      } catch (error) {
        return respond({ error: { code: -32603, message: error instanceof Error ? error.message : "Failed to derive account" } });
      }
    }

    case "add-token": {
      const token = message.payload as { address: string; symbol: string; name: string; decimals: number; chainId: number; logoColor: string };
      tokenListService.addCustomToken(token);
      persistState();
      return respond({ result: { ok: true } });
    }

    case "remove-token": {
      const { address } = message.payload as { address: string };
      tokenListService.removeCustomToken(address);
      persistState();
      return respond({ result: { ok: true } });
    }

    case "get-tokens": {
      const chainId = parseInt(networkManager.getActiveChainId(), 16);
      return respond({ result: tokenListService.getTokensForChain(chainId) });
    }

    case "get-networks": {
      return respond({ result: { networks: networkManager.listNetworks(), active: networkManager.getActiveChainId() } });
    }

    case "switch-network": {
      const { chainId } = message.payload as { chainId: string };
      try {
        switchChain(chainId);
        persistState();
        broadcastState();
        // EIP-1193: dApps need the chainChanged event
        broadcastProviderEvent("chainChanged", chainId);
        return respond({ result: { chainId, network: networkManager.getActive() } });
      } catch {
        return respond({ error: { code: 4902, message: `Network ${chainId} not found` } });
      }
    }

    /* ─── update-network-rpc ───
     * Points an existing network at a different RPC endpoint — how a user
     * brings their own node, or how a local devnet sharing a public chain id
     * (anvil as 7332) becomes reachable. Popup-context only, like the other
     * wallet-management kinds. If the edited network is active, the
     * RPC-scoped services are rebuilt immediately so the very next call —
     * including a pending broadcast — hits the new endpoint. */
    case "update-network-rpc": {
      const { chainId, rpcUrl } = message.payload as { chainId: string; rpcUrl: string };
      let parsed: URL;
      try {
        parsed = new URL(rpcUrl);
      } catch {
        return respond({ error: { code: -32602, message: `Invalid RPC URL: ${rpcUrl}` } });
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return respond({ error: { code: -32602, message: "RPC URL must be http(s)" } });
      }
      // Authenticate the endpoint before trusting it: the node must REPORT
      // the chain id it is being assigned to. A mistyped or malicious
      // endpoint serving another chain's state is rejected instead of
      // silently backing balances, simulations, and broadcasts.
      try {
        const probe = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
          signal: AbortSignal.timeout(7_000),
        });
        const reported = ((await probe.json()) as { result?: string }).result ?? "";
        if (reported.toLowerCase() !== chainId.toLowerCase()) {
          return respond({
            error: {
              code: -32603,
              message: `RPC endpoint reports chain ${reported || "unknown"}, expected ${chainId} — not saved`,
            },
          });
        }
      } catch {
        return respond({
          error: { code: -32603, message: "RPC endpoint unreachable or not an EVM JSON-RPC — not saved" },
        });
      }
      try {
        const network = networkManager.updateNetworkRpc(chainId, rpcUrl);
        if (networkManager.getActiveChainId() === chainId) {
          switchChain(chainId); // rebuild rpcClient/txManager/gasOracle on the new URL
        }
        auditCapture.record({
          kind: "network-rpc-updated",
          subjectId: subjectRegistry.getActive()?.id ?? "unknown",
          workspaceId: workspaceRegistry.getActive()?.id ?? "unknown",
          detail: { chainId, rpcUrl },
        });
        persistState();
        broadcastState();
        return respond({ result: { network } });
      } catch {
        return respond({ error: { code: 4902, message: `Network ${chainId} not found` } });
      }
    }

    case "get-tx-history": {
      return respond({ result: collectTrackedTransactions() });
    }

    case "get-tx": {
      const { hash } = message.payload as { hash?: unknown };
      if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
        return respond({
          error: {
            code: -32602,
            message: "A complete 32-byte transaction hash is required",
          },
        });
      }
      const normalizedHash = hash.toLowerCase();
      const transaction = collectTrackedTransactions().find(
        (candidate) => candidate.hash.toLowerCase() === normalizedHash,
      );
      return respond({ result: transaction ? { ...transaction } : null });
    }

    case "rename-account": {
      const { id, label } = message.payload as { id: string; label: string };
      await keyManager.renameAccount(id, label);
      persistState();
      broadcastState();
      return respond({ result: { ok: true } });
    }

    case "get-audit-events": {
      const query = message.payload as {
        kind?: string;
        limit?: number;
        includeIntegrity?: boolean;
      } | undefined;
      const events = auditStore.query({ kind: query?.kind as AuditEventKind | undefined, limit: query?.limit ?? 50 });
      if (!query?.includeIntegrity) return respond({ result: events });

      return respond({
        result: {
          events,
          integrity: inspectAuditChainIntegrity(
            auditStore.getAll(),
            auditChainRehydrationState,
          ),
        },
      });
    }

    case "get-security-settings": {
      const subjectId = getPersistedPasskeySubjectId();
      const passkeyRequirement = await resolvePasskeyRequirement(subjectId);
      return respond({
        result: {
          autoLockMs: masterKey.getAutoLockMs(),
          passkeyCount: passkeyRequirement.passkeys.length,
          passkeyRequired: passkeyRequirement.required,
          transactionReview: true,
          localKeyEncryption: true,
        },
      });
    }

    case "set-auto-lock": {
      const { autoLockMs } = message.payload as { autoLockMs?: number };
      const allowed = new Set([60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000]);
      if (typeof autoLockMs !== "number" || !allowed.has(autoLockMs)) {
        return respond({
          error: {
            code: -32602,
            message: "Auto-lock must be 1, 5, 15, 30, or 60 minutes",
          },
        });
      }
      masterKey.setAutoLockMs(autoLockMs);
      statePersistence.update({ autoLockMs });
      await statePersistence.saveNow();
      auditCapture.record({
        kind: "lock-state-changed",
        subjectId: getPersistedPasskeySubjectId() ?? "unknown",
        workspaceId: workspaceRegistry.getActive()?.id ?? "unknown",
        detail: { locked: masterKey.isLocked(), autoLockMs, reason: "settings-updated" },
      });
      return respond({ result: { autoLockMs } });
    }

    case "revoke-session": {
      if (!resolveExtensionWebAuthnContext(sender)) {
        return respond({ error: { code: 4001, message: "Sessions can only be revoked from the wallet extension" } });
      }
      const { sessionId } = message.payload as { sessionId?: string };
      if (!sessionId) {
        return respond({ error: { code: -32602, message: "sessionId is required" } });
      }
      const session = sessionManager.get(sessionId);
      if (!session || session.status !== "active") {
        return respond({ error: { code: 4001, message: "Active session not found" } });
      }
      sessionManager.revoke(sessionId);
      stopSubscriptionsForSession(sessionId);
      const rejectedApprovals = rejectPendingApprovalsForOrigin(session.origin);
      persistState();
      await statePersistence.saveNow();
      auditCapture.record({
        kind: "session-revoked",
        subjectId: getPersistedPasskeySubjectId() ?? "unknown",
        workspaceId: workspaceRegistry.getActive()?.id ?? "unknown",
        appId: session.appId,
        detail: {
          sessionId,
          origin: session.origin,
          reason: "user-disconnected",
          rejectedApprovals,
        },
      });
      broadcastState();
      broadcastRevokedAccounts(session);
      return respond({ result: { ok: true } });
    }

    /* ─── WebAuthn passkey 2FA ────────────────────────────────
     * WebAuthn ceremonies run in the focused popup; validation and
     * one-time challenge/grant state remain in the background. Once a
     * passkey is enrolled, every unlock requires both the password and a
     * fresh user-verified assertion. */

    case "passkey-enroll-begin": {
      let vaultEpoch: number;
      try {
        vaultEpoch = masterKey.captureUnlockedEpoch();
      } catch {
        return respond({ error: { code: 4001, message: "Unlock the wallet before enrolling a passkey" } });
      }
      const subject = subjectRegistry.getActive();
      const context = resolveExtensionWebAuthnContext(sender);
      if (!subject || !context) {
        return respond({ error: { code: 4001, message: "Passkey enrollment context is unavailable" } });
      }
      let enrollmentStart: {
        record: PasskeyEnrollmentChallengeRecord;
        excludedPasskeys: ReturnType<CredentialStore["listPasskeys"]>;
      };
      try {
        enrollmentStart = await withPasskeyBindingOperation(async () => {
          masterKey.assertUnlockedAtEpoch(vaultEpoch);
          const stored = await passkeyEphemeralAuthority.storeEnrollmentChallenge({
            id: randomBase64Url(18),
            subjectId: subject.id,
            challenge: randomBase64Url(32),
            rpId: context.effectiveRpId,
            origin: context.origin,
            vaultEpoch,
            expiresAt: Date.now() + PASSKEY_CHALLENGE_TTL_MS,
          });
          masterKey.assertUnlockedAtEpoch(vaultEpoch);
          return {
            record: stored,
            excludedPasskeys: credentialStore.listPasskeys(subject.id),
          };
        });
      } catch (error) {
        return respond({
          error: {
            code: error instanceof LockedError ? 4001 : -32603,
            message: error instanceof LockedError
              ? "Wallet locked while passkey enrollment was starting; unlock and try again"
              : error instanceof Error
                ? error.message
                : "Passkey enrollment could not start",
          },
        });
      }
      const { record, excludedPasskeys } = enrollmentStart;
      return respond({
        result: {
          challengeId: record.id,
          challenge: record.challenge,
          timeoutMs: PASSKEY_CHALLENGE_TTL_MS,
          excludeCredentials: excludedPasskeys.map((passkey) => ({
            id: passkey.metadata.credentialId,
            transports: passkey.metadata.transports ?? [],
          })),
        },
      });
    }

    case "passkey-enroll": {
      const subject = subjectRegistry.getActive();
      if (!subject) return respond({ error: { code: 4001, message: "No active subject" } });
      let completionVaultEpoch: number;
      try {
        completionVaultEpoch = masterKey.captureUnlockedEpoch();
      } catch {
        return respond({ error: { code: 4001, message: "Unlock the wallet before completing passkey enrollment" } });
      }
      const context = resolveExtensionWebAuthnContext(sender);
      if (!context) {
        return respond({ error: { code: 4001, message: "Passkeys can only be enrolled from the wallet extension" } });
      }
      const body = message.payload as {
        credentialId?: string;
        publicKeySpki?: string;
        rpId?: string;
        challengeId?: string;
        authenticatorData?: string;
        clientDataJSON?: string;
        label?: string;
        transports?: string[];
      };
      if (
        !body?.credentialId ||
        !body.publicKeySpki ||
        !body.rpId ||
        !body.challengeId ||
        !body.authenticatorData ||
        !body.clientDataJSON
      ) {
        return respond({ error: { code: -32602, message: "Complete passkey registration fields are required" } });
      }
      if (body.rpId !== context.effectiveRpId) {
        return respond({ error: { code: 4001, message: "Passkey RP ID does not match the wallet extension" } });
      }

      let challenge: PasskeyEnrollmentChallengeRecord;
      try {
        challenge = await passkeyEphemeralAuthority.takeEnrollmentChallenge(
          subject.id,
        );
      } catch (error) {
        return respond({
          error: {
            code: 4001,
            message:
              error instanceof Error
                ? error.message
                : "Passkey enrollment challenge is invalid",
          },
        });
      }
      if (
        challenge.id !== body.challengeId ||
        challenge.subjectId !== subject.id ||
        challenge.rpId !== context.effectiveRpId ||
        challenge.origin !== context.origin ||
        challenge.vaultEpoch !== completionVaultEpoch ||
        challenge.expiresAt < Date.now()
      ) {
        return respond({ error: { code: 4001, message: "Passkey enrollment challenge does not match this wallet" } });
      }

      let registration: { signCount: number; publicKeySpki: string };
      try {
        registration = await verifyWebAuthnRegistrationContext({
          authenticatorData: body.authenticatorData,
          clientDataJSON: body.clientDataJSON,
          credentialId: body.credentialId,
          publicKeySpki: body.publicKeySpki,
          expectedRpId: context.effectiveRpId,
          expectedChallenge: challenge.challenge,
          expectedOrigin: challenge.origin,
        });
      } catch (error) {
        return respond({
          error: {
            code: 4001,
            message: error instanceof Error ? error.message : "Passkey enrollment verification failed",
          },
        });
      }

      let cred: PasskeyCredential;
      try {
        cred = await withPasskeyBindingOperation(async () => {
          masterKey.assertUnlockedAtEpoch(challenge.vaultEpoch);
          await passkeyEphemeralAuthority.assertCurrentGeneration(
            subject.id,
            challenge.bindingGeneration,
          );
          masterKey.assertUnlockedAtEpoch(challenge.vaultEpoch);
          const priorPolicy = await masterKey.getPasskeyPolicy();
          masterKey.assertUnlockedAtEpoch(challenge.vaultEpoch);
          const previousSnapshot = captureCredentialSnapshot();
          return runVaultEpochBoundMutation({
            guard: masterKey,
            epoch: challenge.vaultEpoch,
            mutate: () => commitPasskeyBindingTransaction({
              previousPolicy: priorPolicy,
              targetPolicy: "required",
              captureSnapshot: captureCredentialSnapshot,
              restoreSnapshot: restoreCredentialSnapshot,
              persistSnapshot: persistCredentialSnapshot,
              setPolicy: (policy) => masterKey.setPasskeyPolicy(policy),
              mutate: () =>
                credentialStore.enrollPasskey({
                  subjectId: subject.id,
                  credentialId: body.credentialId!,
                  // Persist only the canonical key derived from and compared with
                  // the COSE key inside the attested authenticatorData.
                  publicKeySpki: registration.publicKeySpki,
                  rpId: body.rpId!,
                  label: body.label?.trim().slice(0, 60) || "Passkey",
                  transports: body.transports,
                  signCounter: registration.signCount,
                }),
            }),
            rollback: () => restorePasskeyBinding(previousSnapshot, priorPolicy),
          });
        });
      } catch (error) {
        return respond({
          error: {
            code: error instanceof LockedError ? 4001 : -32603,
            message: error instanceof LockedError
              ? "Wallet locked during passkey enrollment; unlock and start again"
              : error instanceof Error
                ? error.message
                : "Passkey enrollment failed",
          },
        });
      }
      auditCapture.record({
        kind: "credential-enrolled",
        subjectId: subject.id,
        workspaceId: workspaceRegistry.getActive()?.id ?? "",
        detail: { type: "passkey", credentialId: body.credentialId, label: cred.metadata.label },
      });
      return respond({ result: { ok: true, id: cred.id, label: cred.metadata.label } });
    }

    case "passkey-auth-begin": {
      if (!masterKey.isLocked()) {
        return respond({ error: { code: 4001, message: "Wallet is already unlocked" } });
      }
      const subjectId = getPersistedPasskeySubjectId();
      if (!subjectId) {
        return respond({ error: { code: 4001, message: "Passkey unlock identity binding is unavailable" } });
      }
      const context = resolveExtensionWebAuthnContext(sender);
      if (!context) {
        return respond({ error: { code: 4001, message: "Passkey unlock must start from the wallet extension" } });
      }
      const authStart = await withPasskeyBindingOperation(async () => {
        const requirement = await resolvePasskeyRequirementWithinBinding(subjectId);
        if (!requirement.required) return null;
        const usable = requirement.passkeys.filter(
          (passkey) =>
            passkey.metadata.rpId === context.effectiveRpId ||
            passkey.metadata.rpId === context.legacyHostRpId,
        );
        if (usable.length === 0) return { usable, record: null };
        const record = await passkeyEphemeralAuthority.storeAuthChallenge({
          id: randomBase64Url(18),
          subjectId,
          challenge: randomBase64Url(32),
          rpId: context.effectiveRpId,
          origin: context.origin,
          credentialIds: usable.map((passkey) => passkey.metadata.credentialId),
          expiresAt: Date.now() + PASSKEY_CHALLENGE_TTL_MS,
        });
        return { usable, record };
      });
      if (!authStart) return respond({ result: { required: false } });
      const { usable, record } = authStart;
      if (usable.length === 0) {
        return respond({
          error: {
            code: 4001,
            message: "No enrolled passkey matches this extension installation; restore with your recovery phrase",
          },
        });
      }
      if (!record) {
        return respond({ error: { code: 4001, message: "Passkey challenge is unavailable" } });
      }
      return respond({
        result: {
          required: true,
          challengeId: record.id,
          challenge: record.challenge,
          timeoutMs: PASSKEY_CHALLENGE_TTL_MS,
          allowCredentials: usable.map((passkey) => ({
            id: passkey.metadata.credentialId,
            transports: passkey.metadata.transports ?? [],
          })),
        },
      });
    }

    case "passkey-auth-complete": {
      if (!masterKey.isLocked()) {
        return respond({ error: { code: 4001, message: "Wallet is already unlocked" } });
      }
      const context = resolveExtensionWebAuthnContext(sender);
      const subjectId = getPersistedPasskeySubjectId();
      if (!context || !subjectId) {
        return respond({ error: { code: 4001, message: "Passkey unlock context is unavailable" } });
      }
      const body = message.payload as {
        challengeId?: string;
        credentialId?: string;
        authenticatorData?: string; // base64url
        clientDataJSON?: string;    // base64url
        signature?: string;         // base64url
      };
      if (!body?.challengeId || !body.credentialId || !body.authenticatorData || !body.clientDataJSON || !body.signature) {
        return respond({ error: { code: -32602, message: "challengeId and complete assertion fields are required" } });
      }

      let challenge: PasskeyAuthChallengeRecord;
      try {
        challenge = await passkeyEphemeralAuthority.takeAuthChallenge(subjectId);
      } catch (error) {
        return respond({
          error: {
            code: 4001,
            message:
              error instanceof Error
                ? error.message
                : "Passkey challenge is invalid; try again",
          },
        });
      }
      if (
        challenge.id !== body.challengeId ||
        challenge.subjectId !== subjectId ||
        challenge.expiresAt < Date.now() ||
        challenge.rpId !== context.effectiveRpId ||
        challenge.origin !== context.origin ||
        !challenge.credentialIds.includes(body.credentialId)
      ) {
        return respond({ error: { code: 4001, message: "Passkey challenge expired or does not match this wallet" } });
      }

      const cred = credentialStore.findPasskeyByCredentialId(body.credentialId);
      if (
        !cred ||
        cred.subjectId !== subjectId ||
        (cred.metadata.rpId !== context.effectiveRpId &&
          cred.metadata.rpId !== context.legacyHostRpId)
      ) {
        return respond({ error: { code: 4001, message: "Passkey not found for this wallet" } });
      }
      try {
        const result = await verifyWebAuthnAssertion({
          publicKeySpki: cred.metadata.publicKeySpki,
          authenticatorData: body.authenticatorData,
          clientDataJSON: body.clientDataJSON,
          signature: body.signature,
          expectedRpId: context.effectiveRpId,
          expectedChallenge: challenge.challenge,
          expectedOrigin: challenge.origin,
        });
        const grant = await withPasskeyBindingOperation(async () => {
          await passkeyEphemeralAuthority.assertCurrentGeneration(
            subjectId,
            challenge.bindingGeneration,
          );
          const currentCredential =
            credentialStore.findPasskeyByCredentialId(body.credentialId!);
          if (
            !currentCredential ||
            currentCredential.subjectId !== subjectId ||
            (currentCredential.metadata.rpId !== context.effectiveRpId &&
              currentCredential.metadata.rpId !== context.legacyHostRpId)
          ) {
            throw new Error("Passkey not found for this wallet");
          }
          await commitCredentialMutation(() =>
            credentialStore.bumpPasskeySignCounter(
              body.credentialId!,
              result.signCount,
            ),
          );
          return passkeyEphemeralAuthority.issueUnlockGrant({
            token: randomBase64Url(32),
            subjectId,
            credentialId: body.credentialId!,
            expiresAt: Date.now() + PASSKEY_UNLOCK_GRANT_TTL_MS,
          });
        });
        auditCapture.record({
          kind: "credential-verified",
          subjectId,
          workspaceId: workspaceRegistry.getActive()?.id ?? "",
          detail: { type: "passkey", credentialId: body.credentialId, signCount: result.signCount },
        });
        return respond({ result: { ok: true, unlockGrant: grant.token } });
      } catch (err) {
        auditCapture.record({
          kind: "credential-verification-failed",
          subjectId,
          workspaceId: workspaceRegistry.getActive()?.id ?? "",
          detail: { type: "passkey", credentialId: body.credentialId, error: err instanceof Error ? err.message : String(err) },
        });
        return respond({ error: { code: 4001, message: err instanceof Error ? err.message : "Passkey verification failed" } });
      }
    }

    case "passkey-verify":
      return respond({
        error: {
          code: -32601,
          message: "Direct passkey verification is disabled; use the one-time passkey-auth-begin/passkey-auth-complete ceremony",
        },
      });

    case "passkey-remove": {
      const subject = subjectRegistry.getActive();
      if (!subject) return respond({ error: { code: 4001, message: "No active subject" } });
      let removalVaultEpoch: number;
      try {
        removalVaultEpoch = masterKey.captureUnlockedEpoch();
      } catch {
        return respond({ error: { code: 4001, message: "Unlock the wallet before removing a passkey" } });
      }
      const body = message.payload as { credentialId?: string };
      if (!body?.credentialId) {
        return respond({ error: { code: -32602, message: "credentialId is required" } });
      }
      let removed: boolean;
      try {
        removed = await withPasskeyBindingOperation(async () => {
          masterKey.assertUnlockedAtEpoch(removalVaultEpoch);
          const existing = credentialStore.findPasskeyByCredentialId(body.credentialId!);
          if (!existing || existing.subjectId !== subject.id) return false;
          // Advance durable revocation state before touching the credential or
          // vault policy. If a later write fails and rolls back, invalidating
          // outstanding grants/challenges is harmless; the inverse ordering
          // could let a stale ceremony survive a committed removal.
          await passkeyEphemeralAuthority.invalidateSubject(subject.id);
          masterKey.assertUnlockedAtEpoch(removalVaultEpoch);
          const priorPolicy = await masterKey.getPasskeyPolicy();
          masterKey.assertUnlockedAtEpoch(removalVaultEpoch);
          const previousSnapshot = captureCredentialSnapshot();
          const removingLastPasskey = credentialStore.listPasskeys(subject.id).length === 1;
          return runVaultEpochBoundMutation({
            guard: masterKey,
            epoch: removalVaultEpoch,
            mutate: () => commitPasskeyBindingTransaction({
              previousPolicy: priorPolicy,
              targetPolicy: removingLastPasskey ? "none" : "required",
              captureSnapshot: captureCredentialSnapshot,
              restoreSnapshot: restoreCredentialSnapshot,
              persistSnapshot: persistCredentialSnapshot,
              setPolicy: (policy) => masterKey.setPasskeyPolicy(policy),
              mutate: () => credentialStore.removePasskey(body.credentialId!),
            }),
            rollback: () => restorePasskeyBinding(previousSnapshot, priorPolicy),
          });
        });
      } catch (error) {
        return respond({
          error: {
            code: error instanceof LockedError ? 4001 : -32603,
            message: error instanceof LockedError
              ? "Wallet locked while removing the passkey; unlock and try again"
              : error instanceof Error
                ? error.message
                : "Passkey removal failed",
          },
        });
      }
      if (removed) {
        auditCapture.record({
          kind: "credential-revoked",
          subjectId: subject.id,
          workspaceId: workspaceRegistry.getActive()?.id ?? "",
          detail: { type: "passkey", credentialId: body.credentialId },
        });
      }
      return respond({ result: { ok: removed } });
    }

    case "passkey-list": {
      const subject = subjectRegistry.getActive();
      if (!subject) return respond({ result: [] });
      const passkeys = credentialStore.listPasskeys(subject.id).map((p) => ({
        id: p.id,
        label: p.metadata.label,
        credentialId: p.metadata.credentialId,
        rpId: p.metadata.rpId,
        transports: p.metadata.transports,
        issuedAt: p.issuedAt,
        lastUsedAt: p.metadata.lastUsedAt,
      }));
      return respond({ result: passkeys });
    }

    case "passkey-set-label": {
      const subject = subjectRegistry.getActive();
      if (!subject) return respond({ error: { code: 4001, message: "No active subject" } });
      const body = message.payload as { credentialId?: string; label?: string };
      if (!body?.credentialId || typeof body.label !== "string") {
        return respond({ error: { code: -32602, message: "credentialId and label are required" } });
      }
      const renamed = await withPasskeyBindingOperation(async () => {
        const cred = credentialStore.findPasskeyByCredentialId(body.credentialId!);
        if (!cred || cred.subjectId !== subject.id) return null;
        return commitCredentialMutation(() =>
          credentialStore.renamePasskey(body.credentialId!, body.label!),
        );
      });
      if (!renamed) {
        return respond({ error: { code: 4001, message: "Passkey not found" } });
      }
      auditCapture.record({
        kind: "credential-enrolled",
        subjectId: subject.id,
        workspaceId: workspaceRegistry.getActive()?.id ?? "",
        detail: { type: "passkey", credentialId: body.credentialId, renamed: true, label: renamed.metadata.label },
      });
      return respond({ result: { ok: true } });
    }

    /* ─── Pending-tx management (gas bump / speed-up / cancel) ──
     * The popup's Activity view shows a "Pending" strip with bump
     * controls. `tx-pending-list` returns the PendingTxTracker's
     * view for the active account; `tx-speed-up` / `tx-cancel` build
     * a replacement tx, stash it as a draft, and return the draftId
     * — the caller then issues `execute-tx` to actually sign +
     * broadcast, so the existing policy engine is never bypassed. */
    case "tx-pending-list": {
      try {
        const body = (message.payload ?? {}) as { address?: string };
        const address = (body.address ?? getActiveAccount()?.address) as `0x${string}` | undefined;
        const list = address ? await pendingTxTracker.list(address) : await pendingTxTracker.list();
        return respond({ result: list.map(toPendingTxSummary) });
      } catch (err) {
        return respond({
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : "Failed to list pending transactions",
          },
        });
      }
    }

    case "tx-speed-up":
    case "tx-cancel": {
      const body = message.payload as { txHash?: string };
      const txHash = body?.txHash;
      if (!txHash || !txHash.startsWith("0x")) {
        return respond({ error: { code: -32602, message: "txHash is required" } });
      }
      try {
        const result = await handleTxReplacement(
          txHash as `0x${string}`,
          message.kind === "tx-speed-up" ? "speed-up" : "cancel",
        );
        return respond(result);
      } catch (err) {
        if (err instanceof PendingTxTrackerError) {
          return respond({ error: { code: -32602, message: err.message } });
        }
        if (err instanceof GasReplacementError) {
          return respond({ error: { code: -32602, message: err.message } });
        }
        return respond({
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : "Failed to build replacement tx",
          },
        });
      }
    }

    /* ─── Token allowances (ERC-20) ────────────────────────────
     * Never interpret an unconfigured source as zero approvals. */
    case "get-token-allowances": {
      return respond({
        error: {
          code: 4200,
          message: "Token approvals are unavailable until a complete on-chain allowance index is configured",
        },
      });
    }

    /* ─── WalletConnect v2 plumbing ─────────────────────────────
     * The real SDK wiring lives in the manager — these handlers
     * delegate. Every RPC surface goes through the approval pipeline
     * via the manager's `onRequest` config (see construction above). */
    case "wc-pair": {
      const body = message.payload as { uri?: string };
      if (!body?.uri) {
        return respond({ error: { code: -32602, message: "uri is required" } });
      }
      try {
        const manager = getWalletConnectManager();
        await manager.pair(body.uri);
        return respond({ result: { ok: true } });
      } catch (err) {
        return respond({
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : "WalletConnect pair failed",
          },
        });
      }
    }

    case "wc-sessions": {
      try {
        const manager = getWalletConnectManager();
        return respond({ result: manager.getActiveSessions() });
      } catch (err) {
        return respond({
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : "Failed to list WalletConnect sessions",
          },
        });
      }
    }

    case "wc-disconnect": {
      const body = message.payload as { topic?: string };
      if (!body?.topic) {
        return respond({ error: { code: -32602, message: "topic is required" } });
      }
      try {
        const manager = getWalletConnectManager();
        await manager.disconnectSession(body.topic);
        return respond({ result: { ok: true } });
      } catch (err) {
        return respond({
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : "WalletConnect disconnect failed",
          },
        });
      }
    }

    case "wc-approve-proposal": {
      const body = message.payload as {
        proposalId?: number;
        accounts?: string[];
        namespaces?: Record<string, { chains: string[]; methods: string[]; events: string[]; accounts: string[] }>;
      };
      if (typeof body?.proposalId !== "number" || !Array.isArray(body.accounts) || !body.namespaces) {
        return respond({
          error: {
            code: -32602,
            message: "proposalId, accounts, and namespaces are required",
          },
        });
      }
      try {
        const manager = getWalletConnectManager();
        await manager.approveProposal(body.proposalId, body.accounts, body.namespaces);
        return respond({ result: { ok: true } });
      } catch (err) {
        return respond({
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : "WalletConnect approve failed",
          },
        });
      }
    }

    case "wc-reject-proposal": {
      const body = message.payload as { proposalId?: number; reason?: string };
      if (typeof body?.proposalId !== "number") {
        return respond({ error: { code: -32602, message: "proposalId is required" } });
      }
      try {
        const manager = getWalletConnectManager();
        await manager.rejectProposal(body.proposalId, body.reason);
        return respond({ result: { ok: true } });
      } catch (err) {
        return respond({
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : "WalletConnect reject failed",
          },
        });
      }
    }

    /* ─── Verifiable Credentials (regulatory passport) ─────────
     * Protocol-reserved until verified issuer keys and an audited,
     * encrypted credential store are connected. */
    case "credentials-list":
    case "credentials-revoke":
    case "credential-presentation-prepare":
      // The release gate above returns 4200 before dispatch reaches these
      // protocol variants. Keeping the switch exhaustive avoids silently
      // re-enabling them when the bridge union changes.
      return respond({ error: getCredentialReleaseError(message.kind)! });

    /* Reserved deployment-migration protocol variants. The release gate
     * above returns 4200 before dispatch reaches these cases; retaining
     * exhaustive cases prevents a future bridge-union change from silently
     * making a reserved operation callable. */
    case "tenant-list":
    case "tenant-plan-migration":
    case "tenant-execute-migration":
    case "tenant-verify-continuity":
      return respond({ error: getTenantMigrationReleaseError(message.kind)! });

    case "rpc-request":
      return handleRpcRequest(message, sender);

    // ── Outbound-only kinds (never dispatched as requests) ─────────
    // These kinds flow background → popup / inpage / subscribers. If
    // one ever lands on the request dispatcher it is almost certainly
    // a bug in the caller — respond with the JSON-RPC "method not
    // found" envelope the inpage bridge expects, same as before.
    case "rpc-response":
    case "state-update":
    case "contacts-updated":
    case "approval-request":
    case "lock-state":
    case "content-ready":
    case "navigate-to-approval":
    case "provider-event":
    case "tx-updated":
    case "wc-session-proposal":
    case "merkle-batch-ready":
    case "handshake-init":
    case "handshake-ack":
    case "get-slo-snapshot":
      // Inpage handshake kinds are handled earlier by `maybeHandleHandshake`
      // before the switch statement runs (see the handshake guard near the
      // top of handleMessage). The SLO snapshot kind is currently served by
      // the pre-switch `maybeHandleSloSnapshot` hook; if either reaches
      // here, the caller mis-routed.
      return respond({ error: { code: -32601, message: `Unknown message kind: ${message.kind}` } });

    default:
      // Adding a new BridgeMessageKind without wiring a handler here
      // now trips `assertNever` at build time — preventing the silent
      // "message dropped, caller hangs forever" failure mode.
      return assertNever(message.kind, "background.handleMessage");
  }
}

/**
 * Build + stash a replacement transaction (speed-up or cancel) for an
 * existing pending tx. Returns a draftId that the caller passes to the
 * existing `execute-tx` handler — this ensures the policy engine, audit
 * trail, and signing flow are identical to a normal send.
 *
 * @param originalTxHash - hash of the pending tx to replace.
 * @param kind - "speed-up" preserves (to, value, data); "cancel" rewrites
 *   to a zero-value self-send at the same nonce.
 *
 * @example
 * ```ts
 * const { draftId } = await handleTxReplacement("0xabc", "speed-up");
 * await handleExecuteTx({ draftId });
 * ```
 */
async function handleTxReplacement(
  originalTxHash: `0x${string}`,
  kind: "speed-up" | "cancel",
): Promise<{
  result?: {
    draftId: string;
    detail: ApprovalDetail;
    replacementKind: "speed-up" | "cancel";
    originalTxHash: string;
  };
  error?: { code: number; message: string };
}> {
  const chainContext = captureTransactionChainContext();
  const subject = subjectRegistry.getActive();
  const workspace = workspaceRegistry.getActive();
  if (!subject || !workspace) {
    return { error: { code: 4001, message: "Wallet not configured" } };
  }
  const list = await pendingTxTracker.list();
  const tracked = list.find(
    (t) => t.txHash.toLowerCase() === originalTxHash.toLowerCase(),
  );
  if (!tracked) {
    return {
      error: {
        code: -32602,
        message: `No pending tx with hash ${originalTxHash}`,
      },
    };
  }
  if (tracked.replacedBy) {
    return {
      error: {
        code: -32602,
        message: `Tx ${originalTxHash} has already been replaced by ${tracked.replacedBy}`,
      },
    };
  }
  if (
    transactionChainContextChanged(chainContext) ||
    tracked.chainId !== parseInt(chainContext.chainId, 16)
  ) {
    return {
      error: {
        code: 4901,
        message: `Switch to chain 0x${tracked.chainId.toString(16)} before replacing this transaction.`,
      },
    };
  }

  // Ask the gas oracle for the current network base fee so the
  // replacement is guaranteed includeable — the core helpers do the
  // 11% mempool-rule math on top of that floor.
  let networkBaseFeePerGas: bigint | undefined;
  try {
    const estimate = await chainContext.gasOracle.getFullEstimate({
      from: tracked.fromAddress,
      to: tracked.original.to,
      value: "0x" + tracked.original.value.toString(16),
      data: tracked.original.data,
    });
    networkBaseFeePerGas = estimate.baseFee;
  } catch {
    // Fall through — computeReplacementGas is robust to a missing base fee.
  }
  const suggestion = computeReplacementGas(tracked.original, {
    bumpPercent: 11,
    networkBaseFeePerGas,
  });

  const replacement: OriginalTransaction =
    kind === "speed-up"
      ? buildSpeedUpTransaction(tracked.original, suggestion)
      : buildCancelTransaction(tracked.original, tracked.fromAddress, suggestion);

  // Stash the replacement as a draft so the existing `execute-tx`
  // handler can sign + broadcast. This reuses every check in the
  // send pipeline — no policy bypass.
  const keySlot = keyManager
    .getKeySlots()
    .find((s) => s.address.toLowerCase() === tracked.fromAddress.toLowerCase());
  if (!keySlot) {
    return { error: { code: 4001, message: "Signing key not found" } };
  }

  const draftId = `draft-repl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (transactionChainContextChanged(chainContext)) {
    return {
      error: {
        code: 4901,
        message: `Active chain changed while preparing the replacement. Review it again on ${chainContext.chainId}.`,
      },
    };
  }
  const chainIdHex = chainContext.chainId;
  const dataBytes = (() => {
    const hex = replacement.data.startsWith("0x") ? replacement.data.slice(2) : replacement.data;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  })();
  const maxFeePerGas = replacement.maxFeePerGas ?? suggestion.speedUp.maxFeePerGas;
  const maxPriorityFeePerGas =
    replacement.maxPriorityFeePerGas ?? suggestion.speedUp.maxPriorityFeePerGas;

  const account = keyManager.getAccountByAddress(tracked.fromAddress);
  if (!account) {
    return { error: { code: 4001, message: "Replacement signing account not found" } };
  }
  let spending: ResolvedTransactionSpending;
  try {
    spending = await resolveTransactionSpending(
      {
        to: replacement.to,
        value: `0x${replacement.value.toString(16)}`,
        data: replacement.data,
      },
      subject.id,
      chainContext,
    );
  } catch (error) {
    return {
      error: {
        code:
          error instanceof TransactionSpendingResolutionError
            ? error.code
            : 4001,
        message:
          error instanceof Error
            ? error.message
            : "Replacement spending context could not be established",
      },
    };
  }
  let replacementVelocity;
  try {
    replacementVelocity = await velocityTracker.reserveOperation({
      reservationId: draftId,
      subjectId: subject.id,
      amountUsd: spending.amountUsd ?? 0,
      assetSymbol: spending.assetSymbol,
      ttlMs: DRAFT_TX_TTL_MS,
    });
  } catch (error) {
    return {
      error: {
        code: 4001,
        message: `Replacement blocked because velocity policy could not be reserved: ${error instanceof Error ? error.message : "unknown error"}`,
      },
    };
  }
  const replacementPolicy = evaluate(
    buildPolicyContext({
      intent: {
        kind: "sign-transaction",
        method: "eth_sendTransaction",
        app: {
          id: "popup",
          name: "Aethelred Wallet",
          origin: "popup",
          trustLevel: "first-party",
        },
      },
      subjectId: subject.id,
      subjectRole: workspaceRegistry.getRole(subject.id, workspace.id) ?? "owner",
      workspace,
      account: {
        id: account.id,
        label: account.label,
        address: account.address,
        namespace: account.namespace,
        custody: "local",
        assurance: "device-key",
      },
      sessionExists: true,
      destination: spending.destination,
      destinationCategory: spending.destinationCategory,
      amount: spending.amount,
      amountUsd: spending.amountUsd,
      assetId: spending.assetId,
      assetSymbol: spending.assetSymbol,
      assetCategory: spending.assetCategory,
      requestedOperationCount24h: replacementVelocity.count24h,
      cumulativeValueSpentUsd24h: replacementVelocity.valueUsd24h,
    }),
    getDefaultPolicyBundle(workspace.kind),
  );
  if (replacementPolicy.outcome === "deny") {
    await releaseVelocityReservation(draftId, "replacement denied by policy");
    return {
      error: {
        code: 4001,
        message: replacementPolicy.warnings[0] ?? "Replacement denied by policy",
      },
    };
  }
  if (transactionChainContextChanged(chainContext)) {
    await releaseVelocityReservation(draftId, "replacement chain changed during policy evaluation");
    return {
      error: {
        code: 4901,
        message: `Active chain changed while preparing the replacement. Review it again on ${chainContext.chainId}.`,
      },
    };
  }

  draftTxs.set(draftId, {
    id: draftId,
    from: tracked.fromAddress,
    to: replacement.to,
    value: replacement.value,
    data: dataBytes,
    nonce: replacement.nonce,
    txManager: chainContext.txManager,
    ownsNonce: false,
    gasLimit: replacement.gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    chainId: chainIdHex,
    chainEpoch: chainContext.epoch,
    createdAt: Date.now(),
    keySlotId: keySlot.id,
    origin: "popup",
    subjectId: subject.id,
    workspaceId: workspace.id,
    velocityReservationId: draftId,
    spending,
    amountUsd: spending.amountUsd,
    assetSymbol: spending.assetSymbol,
  });

  // Track the intended replacement lineage. When execute-tx completes
  // and we know the replacement's actual hash, the caller should call
  // `pendingTxTracker.markReplaced(originalTxHash, newHash, kind)` —
  // we don't do it here because we don't know the new hash until sign
  // + broadcast.
  const detail: ApprovalDetail = {
    kind: "tx",
    chainId: chainIdHex,
    from: tracked.fromAddress,
    to: replacement.to,
    value: "0x" + replacement.value.toString(16),
    data: replacement.data,
    nonce: replacement.nonce,
    gasLimit: "0x" + replacement.gasLimit.toString(16),
    maxFeePerGas: "0x" + maxFeePerGas.toString(16),
    maxPriorityFeePerGas: "0x" + maxPriorityFeePerGas.toString(16),
    estimatedFee: "0x" + (replacement.gasLimit * maxFeePerGas).toString(16),
    simulationRisk: "low",
    warnings: [
      kind === "speed-up"
        ? `Speed-up replacement for ${originalTxHash}`
        : `Cancel replacement for ${originalTxHash}`,
    ],
    reviewedSpending: buildReviewedTxSpending(
      spending,
      replacement.to,
      `0x${replacement.value.toString(16)}`,
    ),
  };

  return {
    result: {
      draftId,
      detail,
      replacementKind: kind,
      originalTxHash,
    },
  };
}

/**
 * Typed view of a tracked pending transaction as it crosses the bridge.
 * Narrower than the full `TrackedPendingTransaction` export because the
 * popup only renders a subset.
 */
type TxPendingBridgeView = Pick<
  TrackedPendingTransaction,
  "txHash" | "nonce" | "fromAddress" | "chainId" | "submittedAt" | "replacedBy" | "replacementKind"
>;
void ({} as TxPendingBridgeView); // retained for future typed bridge wiring

type SensitiveDappRpcMethod =
  | "eth_sendTransaction"
  | "eth_sign"
  | "personal_sign"
  | "eth_signTypedData_v4";

const SENSITIVE_DAPP_RPC_PERMISSIONS: Readonly<
  Record<SensitiveDappRpcMethod, string>
> = {
  eth_sendTransaction: "eth_sendTransaction",
  eth_sign: "eth_sign",
  personal_sign: "personal_sign",
  eth_signTypedData_v4: "eth_signTypedData_v4",
};

interface RpcCallerAuthority {
  origin: string;
  trustedInternal: boolean;
  error?: { code: number; message: string };
}

interface SigningAuthorityRequirement {
  permission: string;
  fallbackPermission?: string;
  accountAddress?: string;
  accountRequired: boolean;
}

/**
 * Immutable authority captured when a sensitive dApp request enters the
 * wallet.  Holding only an origin is not sufficient: a site can disconnect
 * while its approval is resolving and later reconnect with a new session.
 * The old request must never inherit that replacement session's authority.
 */
interface DappSigningAuthoritySnapshot {
  method: string;
  origin: string;
  sessionId: string;
  grantedPermission: string;
  accountAddress: string;
}

interface DappPublicWalletState {
  locked: boolean;
  chainId: string;
  accounts: string[];
}

type DappSigningAuthorityResult =
  | { ok: true; authority?: DappSigningAuthoritySnapshot }
  | { ok: false; code: number; message: string };

/**
 * Resolve an RPC caller from browser-owned sender metadata. A page-provided
 * `message.origin` is useful for routing, but it is not an authority boundary:
 * a compromised content bridge must not be able to impersonate another
 * origin's durable grant.
 */
function resolveRpcCallerAuthority(
  message: BridgeMessage,
  sender: chrome.runtime.MessageSender,
): RpcCallerAuthority {
  const extensionContext = resolveExtensionWebAuthnContext(sender);
  if (extensionContext) {
    return {
      // Even an extension page must not be able to claim an arbitrary web
      // origin. Its browser-owned extension URL is the authority boundary.
      origin: extensionContext.origin,
      trustedInternal: true,
    };
  }

  const senderUrl = sender.url ?? sender.tab?.url;
  const claimedOrigin = message.origin
    ? normalizeOrigin(message.origin).origin
    : null;

  if (!senderUrl) {
    return {
      origin: claimedOrigin ?? "unknown",
      trustedInternal: false,
      error: {
        code: 4100,
        message: "Unable to establish the requesting application's origin",
      },
    };
  }

  const senderOrigin = normalizeOrigin(senderUrl).origin;
  if (claimedOrigin && claimedOrigin !== senderOrigin) {
    return {
      origin: senderOrigin,
      trustedInternal: false,
      error: {
        code: 4100,
        message: "The request origin does not match the browser sender origin",
      },
    };
  }

  return { origin: senderOrigin, trustedInternal: false };
}

function getSigningAuthorityRequirement(
  method: string,
  params: unknown[],
): SigningAuthorityRequirement | null {
  if (method in SENSITIVE_DAPP_RPC_PERMISSIONS) {
    const sensitiveMethod = method as SensitiveDappRpcMethod;
    let accountAddress: string | undefined;
    if (sensitiveMethod === "eth_sendTransaction") {
      const tx = params[0] as { from?: unknown } | undefined;
      if (typeof tx?.from === "string") accountAddress = tx.from;
    } else if (sensitiveMethod === "personal_sign") {
      if (typeof params[1] === "string") accountAddress = params[1];
    } else {
      // eth_sign and eth_signTypedData_v4 both put the signing account first.
      if (typeof params[0] === "string") accountAddress = params[0];
    }
    return {
      permission: SENSITIVE_DAPP_RPC_PERMISSIONS[sensitiveMethod],
      // EIP-1193 account access is the compatibility umbrella used by
      // MetaMask-style dApps: after eth_requestAccounts, each signing call
      // still gets its own approval prompt. Explicit method capabilities are
      // also accepted for callers that request a narrower EIP-2255 grant.
      fallbackPermission: "eth_accounts",
      accountAddress,
      accountRequired: true,
    };
  }

  if (method === "aethelred_requestIntent") {
    const intent = params[0] as Partial<IntentRequest> | undefined;
    if (intent?.kind !== "sign-message" && intent?.kind !== "sign-transaction") {
      return null;
    }
    const payload = intent.payload as
      | { from?: unknown; account?: unknown; address?: unknown }
      | undefined;
    const accountCandidate = payload?.from ?? payload?.account ?? payload?.address;
    return {
      permission: intent.kind,
      accountAddress:
        typeof accountCandidate === "string"
          ? accountCandidate
          : getActiveAccount()?.address,
      accountRequired: true,
    };
  }

  return null;
}

/**
 * Enforce durable per-origin session authority before any simulation,
 * approval creation, key lookup, or signing work is allowed to run.
 */
function authorizeDappSigningRequest(
  method: string,
  params: unknown[],
  origin: string,
  trustedInternal: boolean,
): DappSigningAuthorityResult {
  const requirement = getSigningAuthorityRequirement(method, params);
  if (!requirement || trustedInternal) return { ok: true };

  const session = sessionManager.getByOrigin(origin);
  if (!session || (session.expiresAt != null && session.expiresAt <= Date.now())) {
    if (session) sessionManager.revoke(session.id);
    return {
      ok: false,
      code: 4100,
      message: "The requesting origin is not connected. Connect the site before requesting a signature.",
    };
  }

  if (
    !session.permissions.includes(requirement.permission) &&
    (!requirement.fallbackPermission ||
      !session.permissions.includes(requirement.fallbackPermission))
  ) {
    return {
      ok: false,
      code: 4100,
      message: `The connected site is not authorized for ${requirement.permission}`,
    };
  }

  if (requirement.accountRequired && !requirement.accountAddress) {
    return {
      ok: false,
      code: -32602,
      message: "A signing account is required",
    };
  }

  if (
    requirement.accountAddress &&
    !session.accountAddresses.some(
      (address) => address.toLowerCase() === requirement.accountAddress!.toLowerCase(),
    )
  ) {
    return {
      ok: false,
      code: 4100,
      message: "The requested account is not authorized for this connected site",
    };
  }

  const grantedPermission = session.permissions.includes(requirement.permission)
    ? requirement.permission
    : requirement.fallbackPermission;
  if (!grantedPermission || !requirement.accountAddress) {
    // The checks above establish both values. Keep this branch fail-closed if
    // a future requirement variant changes those invariants.
    return {
      ok: false,
      code: 4100,
      message: "The connected site does not have complete signing authority",
    };
  }

  return {
    ok: true,
    authority: {
      method,
      origin,
      sessionId: session.id,
      grantedPermission,
      accountAddress: requirement.accountAddress.toLowerCase(),
    },
  };
}

/**
 * Revalidate the exact session that authorized the original request. This is
 * called after approval and again immediately before every sign/broadcast
 * primitive so revocation cannot race the approval pipeline. A newly-created
 * session for the same origin deliberately does not satisfy an old request.
 */
function revalidateDappSigningAuthority(
  authority: DappSigningAuthoritySnapshot | undefined,
): { ok: true } | { ok: false; code: 4100; message: string } {
  if (!authority) return { ok: true };

  const session = sessionManager.get(authority.sessionId);
  const activeForOrigin = sessionManager.getByOrigin(authority.origin);
  const expired = session?.expiresAt != null && session.expiresAt <= Date.now();
  if (expired && session) sessionManager.revoke(session.id);

  if (
    !session ||
    expired ||
    session.status !== "active" ||
    session.origin !== authority.origin ||
    activeForOrigin?.id !== authority.sessionId ||
    !session.permissions.includes(authority.grantedPermission) ||
    !session.accountAddresses.some(
      (address) => address.toLowerCase() === authority.accountAddress,
    )
  ) {
    return {
      ok: false,
      code: 4100,
      message: `Signing authority for ${authority.method} is no longer active`,
    };
  }

  return { ok: true };
}

/**
 * Return the deliberately-small state surface exposed to a connected page.
 * The popup/options pages use buildWalletState() instead; a website must
 * never learn subjects, workspaces, other sessions, pending approvals,
 * policy details, the app catalog, or transaction history.
 */
function buildDappPublicWalletState(origin: string):
  | { ok: true; state: DappPublicWalletState }
  | { ok: false; code: 4100; message: string } {
  const session = sessionManager.getByOrigin(origin);
  const expired = session?.expiresAt != null && session.expiresAt <= Date.now();
  if (expired && session) sessionManager.revoke(session.id);

  if (!session || expired || session.status !== "active") {
    return {
      ok: false,
      code: 4100,
      message: "The requesting origin is not connected",
    };
  }

  if (
    !session.permissions.includes("accounts") &&
    !session.permissions.includes("eth_accounts")
  ) {
    return {
      ok: false,
      code: 4100,
      message: "The connected site is not authorized to read wallet state",
    };
  }

  return {
    ok: true,
    state: {
      locked: masterKey.isLocked(),
      chainId: networkManager.getActiveChainId(),
      accounts: masterKey.isLocked() ? [] : [...session.accountAddresses],
    },
  };
}

// ─── RPC Request Handler (proxies real chain calls) ───────────────
async function handleRpcRequest(
  message: BridgeMessage,
  sender: chrome.runtime.MessageSender
): Promise<BridgeMessage> {
  const { method, params } = message.payload as { method: string; params?: unknown[] | object };

  const respond = (result: unknown) => ({
    kind: "rpc-response" as const,
    correlationId: message.correlationId,
    payload: { result },
    timestamp: Date.now(),
  });

  const respondError = (code: number, msg: string) => ({
    kind: "rpc-response" as const,
    correlationId: message.correlationId,
    payload: { error: { code, message: msg } },
    timestamp: Date.now(),
  });

  /*
   * ─── Request validation (EIP-1193 surface check) ────────────────
   * Validate the shape of the incoming request before doing any work.
   * This catches malformed calldata, unknown methods, and params that
   * don't match the expected type — a cheap first line of defence
   * against noisy dApps and exploit attempts targeting unsupported
   * methods. Unknown methods are rejected with the standard -32601
   * code per JSON-RPC 2.0.
   */
  const validation = validateRequest({ method, params: params as unknown[] });
  if (!validation.valid) {
    // Unknown-method and malformed-params produce different codes so
    // dApps can distinguish "wallet doesn't support this" from "caller
    // sent garbage".
    const isUnknownMethod = validation.errors.some((e) => e.startsWith("Unknown method"));
    return respondError(
      isUnknownMethod ? -32601 : -32602,
      validation.errors.join("; "),
    );
  }
  // Dispatch the detached canonical tuple produced by request validation.
  // Never return to `message.payload` after this point: it is caller-owned
  // input, while this copy is the exact tuple reviewed and signed below.
  const rpcParams = Array.isArray(validation.normalizedParams)
    ? [...validation.normalizedParams]
    : [];

  const caller = resolveRpcCallerAuthority(message, sender);
  if (caller.error) {
    return respondError(caller.error.code, caller.error.message);
  }
  const origin = caller.origin;
  cleanupExpiredSessions();

  // This provider owns nonce, policy, velocity, signing, and broadcast as one
  // fail-closed operation. Returning a detached signed transaction would
  // bypass those guarantees, so reject before authority checks, approval, or
  // nonce allocation and direct callers to the supported send pipeline.
  if (method === "eth_signTransaction") {
    return respondError(
      4200,
      "eth_signTransaction is not supported. Use eth_sendTransaction so the wallet can enforce policy and broadcast safely.",
    );
  }

  // Native Aethelred intents carry an app descriptor inside their payload.
  // Bind that claim to the browser-authenticated origin before a connect
  // intent can mint a session for some other site.
  if (method === "aethelred_requestIntent" && !caller.trustedInternal) {
    const intent = rpcParams[0] as Partial<IntentRequest> | undefined;
    if (!intent?.app?.origin) {
      return respondError(-32602, "Aethelred intents require an app origin");
    }
    if (normalizeOrigin(intent.app.origin).origin !== origin) {
      return respondError(4100, "The intent app origin does not match the browser sender origin");
    }
  }

  const signingAuthority = authorizeDappSigningRequest(
    method,
    rpcParams,
    origin,
    caller.trustedInternal,
  );
  if (!signingAuthority.ok) {
    return respondError(signingAuthority.code, signingAuthority.message);
  }

  // ── Wallet-specific methods ──
  /*
   * ─── dApp connection (EIP-1193) ─────────────────────────────────
   * eth_accounts is a passive read: expose ONLY the accounts this origin
   * has already been granted (empty when not connected). We never leak an
   * address to a site the user hasn't approved.
   */
  if (method === "eth_accounts") {
    if (masterKey.isLocked()) return respond([]);
    const session = sessionManager.getByOrigin(origin);
    return respond(session ? session.accountAddresses : []);
  }

  /*
   * eth_requestAccounts is the interactive connect. It requires the wallet
   * to be usable, reuses an existing grant, and otherwise asks the user to
   * approve THIS site before returning any address — the per-origin consent
   * every mainstream wallet enforces. Routed through the same
   * requestUserApproval + sessionManager machinery as the Aethelred Connect
   * intent and the EVM signing paths.
   */
  if (method === "eth_requestAccounts") {
    if (masterKey.isLocked()) {
      // A connect click is already an explicit user gesture. Bring the wallet
      // lock screen into view instead of requiring the user to discover and
      // open the toolbar action manually. The request still fails closed and
      // must be retried after unlock; no account is disclosed while locked.
      await openPopupSafely();
      return respondError(
        4001,
        "Wallet is locked. Unlock the Aethelred Wallet, then retry the connection.",
      );
    }
    const account = keyManager.getAccounts()[0];
    if (!account) {
      // Locked or not yet set up — the dApp cannot know an address until the
      // user opens and unlocks the wallet.
      return respondError(
        4001,
        "Wallet is locked or has no account. Open the Aethelred Wallet, unlock it and create/select an account, then try connecting again.",
      );
    }

    const app = resolveAppIdentity(origin);

    // Already connected → return the granted account(s), no re-prompt.
    const existing = sessionManager.getByOrigin(app.origin);
    if (existing && existing.accountAddresses.length > 0) {
      return respond(existing.accountAddresses);
    }

    // Ask the user to approve the connection (per-origin consent popup).
    const decision = await requestUserApproval({
      title: `${app.name} wants to connect`,
      summary: `${formatAppRequestLabel(app)} is requesting to see your account address and ask you to approve transactions.`,
      appName: app.name,
      origin: app.origin,
      detail: {
        kind: "connect",
        permissions: ["eth_accounts"],
        accountAddresses: [account.address],
      },
    });

    if (decision === "rejected") {
      return respondError(4001, "Connection request rejected");
    }

    masterKey.touchActivity();
    // Persist the grant so future eth_accounts / reconnects are silent, and
    // the connection shows up in the Connected Sites view for revocation.
    sessionManager.createSession({
      appId: app.id,
      appName: app.name,
      origin: app.origin,
      trustLevel: app.trustLevel,
      permissions: ["eth_accounts", "eth_sendTransaction"],
      accountAddresses: [account.address],
    });
    persistState();
    broadcastState();
    return respond([account.address]);
  }

  if (method === "eth_chainId") {
    return respond(networkManager.getActiveChainId());
  }

  if (method === "net_version") {
    const chainId = networkManager.getActiveChainId();
    return respond(String(parseInt(chainId, 16)));
  }

  if (method === "wallet_switchEthereumChain") {
    const chainId = (rpcParams[0] as { chainId?: string })?.chainId;
    if (!chainId) return respondError(-32602, "chainId required");
    try {
      switchChain(chainId);
      persistState();
      broadcastState();
      // EIP-1193: notify all connected dApps that the chain changed
      broadcastProviderEvent("chainChanged", chainId);
      return respond(null);
    } catch {
      return respondError(4902, `Chain ${chainId} not found`);
    }
  }

  /* ─── wallet_addEthereumChain (EIP-3085) ───
   * Previously silently fell through to "Unsupported method". Now accepts
   * a chain config and registers it in the NetworkManager, then requests
   * user approval before switching to it. */
  if (method === "wallet_addEthereumChain") {
    const appIdentity = resolveAppIdentity(origin);
    const cfg = rpcParams[0] as {
      chainId?: string;
      chainName?: string;
      rpcUrls?: string[];
      nativeCurrency?: { name: string; symbol: string; decimals: number };
      blockExplorerUrls?: string[];
      iconUrls?: string[];
    };
    if (!cfg?.chainId || !cfg.rpcUrls?.length || !cfg.nativeCurrency) {
      return respondError(-32602, "Invalid chain config: chainId, rpcUrls, and nativeCurrency are required");
    }
    // Check if the chain is already known
    const existing = networkManager.listNetworks().find((n) => n.chainId.toLowerCase() === cfg.chainId!.toLowerCase());
    if (existing) {
      // Already known — just switch
      try {
        switchChain(cfg.chainId);
        persistState();
        broadcastState();
        broadcastProviderEvent("chainChanged", cfg.chainId);
        return respond(null);
      } catch (err) {
        return respondError(-32603, err instanceof Error ? err.message : "Switch failed");
      }
    }
    // Ask user approval before adding a new chain (safety)
    const decision = await requestUserApproval({
      title: "Add new network",
      summary: `${formatAppRequestLabel(appIdentity)} wants to add "${cfg.chainName ?? cfg.chainId}" as a new network.`,
      appName: appIdentity.name,
      origin,
      detail: {
        kind: "wallet_addEthereumChain",
        chainId: cfg.chainId,
        chainName: cfg.chainName ?? cfg.chainId,
        rpcUrls: cfg.rpcUrls,
        nativeCurrency: cfg.nativeCurrency,
        blockExplorerUrls: cfg.blockExplorerUrls,
      },
    });
    if (decision === "rejected") return respondError(4001, "User rejected");

    try {
      networkManager.addCustomNetwork({
        chainId: cfg.chainId,
        name: cfg.chainName ?? cfg.chainId,
        rpcUrl: cfg.rpcUrls[0],
        nativeCurrency: cfg.nativeCurrency,
        blockExplorerUrl: cfg.blockExplorerUrls?.[0],
        isTestnet: false,
      });
      switchChain(cfg.chainId);
      persistState();
      broadcastState();
      broadcastProviderEvent("chainChanged", cfg.chainId);
      return respond(null);
    } catch (err) {
      return respondError(-32603, err instanceof Error ? err.message : "Failed to add chain");
    }
  }

  /* ─── wallet_watchAsset (EIP-747) ───
   * Lets dApps request to add a token to the user's list. */
  if (method === "wallet_watchAsset") {
    const appIdentity = resolveAppIdentity(origin);
    const req = rpcParams[0] as {
      type?: string;
      options?: { address?: string; symbol?: string; decimals?: number; image?: string };
    } | { type?: string; options?: unknown };
    const reqOpts = (req as { options?: { address?: string; symbol?: string; decimals?: number; image?: string } }).options;
    if ((req as { type?: string }).type !== "ERC20" || !reqOpts?.address || !reqOpts.symbol || reqOpts.decimals == null) {
      return respondError(-32602, "Invalid asset: expected ERC20 with address, symbol, decimals");
    }
    const decision = await requestUserApproval({
      title: "Watch token",
      summary: `${formatAppRequestLabel(appIdentity)} wants to add ${reqOpts.symbol} to your tokens.`,
      appName: appIdentity.name,
      origin,
      detail: {
        kind: "wallet_watchAsset",
        tokenAddress: reqOpts.address,
        symbol: reqOpts.symbol,
        decimals: reqOpts.decimals,
        chainId: networkManager.getActiveChainId(),
      },
    });
    if (decision === "rejected") return respond(false);
    tokenListService.addCustomToken({
      address: reqOpts.address,
      symbol: reqOpts.symbol,
      name: reqOpts.symbol,
      decimals: reqOpts.decimals,
      chainId: parseInt(networkManager.getActiveChainId(), 16),
      logoColor: "#c41e1e",
    });
    persistState();
    return respond(true);
  }

  /* ─── eth_sendRawTransaction ───
   * Some dApps (and wallet-less integrations) sign locally and ask us
   * to broadcast. We proxy straight to the RpcClient — no additional
   * confirmation needed because the signature is already committed. */
  if (method === "eth_sendRawTransaction") {
    const signedTx = rpcParams[0] as string;
    if (!signedTx?.startsWith("0x")) {
      return respondError(-32602, "Expected 0x-prefixed signed tx");
    }
    try {
      const hash = await rpcClient.call("eth_sendRawTransaction", [signedTx]);
      return respond(hash);
    } catch (err) {
      return respondError(-32603, err instanceof Error ? err.message : "Broadcast failed");
    }
  }

  if (method === "wallet_getCapabilities") {
    return respond({
      intents: ["connect", "sign-message", "sign-transaction", "switch-workspace"],
      policyModes: ["guided", "approval-required", "dual-control", "committee"],
      namespaces: ["eip155", "aethelred"],
      chains: networkManager.listNetworks().map((n) => n.chainId),
      methods: [
        // EIP-1193
        "eth_requestAccounts",
        "eth_accounts",
        "eth_chainId",
        "eth_sendTransaction",
        "eth_sendRawTransaction",
        "personal_sign",
        "eth_signTypedData_v4",
        "eth_getBalance",
        "eth_getTransactionCount",
        "eth_blockNumber",
        "eth_gasPrice",
        "eth_estimateGas",
        "eth_call",
        "eth_getTransactionReceipt",
        "eth_getTransactionByHash",
        "eth_getBlockByNumber",
        "eth_getBlockByHash",
        "eth_getLogs",
        "eth_getCode",
        "net_version",
        // EIP-3085 / EIP-747
        "wallet_switchEthereumChain",
        "wallet_addEthereumChain",
        "wallet_watchAsset",
        // EIP-2255
        "wallet_getPermissions",
        "wallet_requestPermissions",
        "wallet_revokePermissions",
      ],
    });
  }

  /* ─── EIP-2255 wallet_getPermissions ────────────────────
   * Returns the list of capabilities the dApp session currently has. */
  if (method === "wallet_getPermissions") {
    const session = sessionManager.getByOrigin(origin);
    if (!session) return respond([]);
    // Shape per EIP-2255: { parentCapability, invoker, caveats }
    const caps = session.permissions.map((cap) => ({
      parentCapability: cap,
      invoker: origin,
      caveats: [],
    }));
    return respond(caps);
  }

  /* ─── EIP-2255 wallet_requestPermissions ──────────────
   * dApp asks for specific capabilities; we prompt the user,
   * create/update the session, and return the granted list. */
  if (method === "wallet_requestPermissions") {
    const appIdentity = resolveAppIdentity(origin);
    const req = rpcParams[0] as Record<string, unknown>;
    if (!req || typeof req !== "object") {
      return respondError(-32602, "Expected object with capability names as keys");
    }
    const requestedCaps = Object.keys(req);
    if (requestedCaps.length === 0) {
      return respondError(-32602, "At least one capability is required");
    }
    const existing = sessionManager.getByOrigin(origin);
    const account = getActiveAccount();
    const grantedAccounts = existing?.accountAddresses.length
      ? existing.accountAddresses
      : account
        ? [account.address]
        : [];
    if (grantedAccounts.length === 0) {
      return respondError(4001, "Wallet is locked or has no account");
    }
    // eth_accounts is the canonical permission MetaMask uses; accept
    // that and any others the dApp asks for. Real implementations
    // enforce an allowlist here.
    const decision = await requestUserApproval({
      title: "Connect to site",
      summary: `${formatAppRequestLabel(appIdentity)} is requesting permissions: ${requestedCaps.join(", ")}`,
      appName: appIdentity.name,
      origin,
      detail: {
        kind: "connect",
        permissions: requestedCaps,
        accountAddresses: keyManager.getAccounts().map((a) => a.address),
      },
    });
    if (decision === "rejected") {
      return respondError(4001, "User rejected permission request");
    }
    // Create or update the session with the granted caps. Re-requesting a
    // capability must actually amend the durable grant; the previous code
    // returned success while silently leaving existing sessions unchanged.
    const grantedCaps = Array.from(new Set([
      ...(existing?.permissions ?? []),
      ...requestedCaps,
    ]));
    if (existing) stopSubscriptionsForSession(existing.id);
    sessionManager.createSession({
      appId: existing?.appId ?? appIdentity.id,
      appName: existing?.appName ?? appIdentity.name,
      origin,
      trustLevel: existing?.trustLevel ?? appIdentity.trustLevel,
      permissions: grantedCaps,
      accountAddresses: grantedAccounts,
    });
    persistState();
    broadcastState();
    return respond(
      grantedCaps.map((cap) => ({ parentCapability: cap, invoker: origin, caveats: [] })),
    );
  }

  /* ─── EIP-2255 wallet_revokePermissions ────────────
   * dApp disconnects itself. We remove the session and
   * broadcast accountsChanged([]) so the dApp's UI clears. */
  if (method === "wallet_revokePermissions") {
    const existing = sessionManager.getByOrigin(origin);
    if (existing) {
      sessionManager.revoke(existing.id);
      stopSubscriptionsForSession(existing.id);
      rejectPendingApprovalsForOrigin(origin);
      persistState();
      broadcastState();
      broadcastRevokedAccounts(existing);
    }
    return respond(null);
  }

  if (method === "aethelred_getState") {
    if (caller.trustedInternal) {
      return respond(buildWalletState());
    }
    const publicState = buildDappPublicWalletState(origin);
    if (!publicState.ok) {
      return respondError(publicState.code, publicState.message);
    }
    return respond(publicState.state);
  }

  if (method === "aethelred_requestIntent") {
    return handleIntentRequest(message, origin, signingAuthority.authority);
  }

  // ── Chain-proxied methods (real RPC calls) ──
  if (method === "eth_getBalance" || method === "eth_getTransactionCount" ||
      method === "eth_blockNumber" || method === "eth_getCode" ||
      method === "eth_call" || method === "eth_getTransactionByHash" ||
      method === "eth_getTransactionReceipt" || method === "eth_getLogs" ||
      method === "eth_getBlockByNumber" || method === "eth_getBlockByHash") {
    try {
      const result = await rpcClient.call(method, rpcParams);
      return respond(result);
    } catch (error) {
      return respondError(-32603, error instanceof Error ? error.message : "RPC call failed");
    }
  }

  // ── Gas estimation ──
  if (method === "eth_gasPrice") {
    try {
      const gasPrice = await gasOracle.getGasPrice();
      return respond("0x" + gasPrice.toString(16));
    } catch (error) {
      return respondError(-32603, error instanceof Error ? error.message : "Gas price fetch failed");
    }
  }

  if (method === "eth_estimateGas") {
    try {
      const tx = rpcParams[0] as { from: string; to?: string; value?: string; data?: string };
      const gasLimit = await gasOracle.estimateGas(tx);
      return respond("0x" + gasLimit.toString(16));
    } catch (error) {
      return respondError(-32603, error instanceof Error ? error.message : "Gas estimation failed");
    }
  }

  /*
   * ─── EIP-1559 fee estimation ────────────────────────────────────
   * viem/wagmi/ethers call these during EVERY contract-write preflight on a
   * 1559 chain (Aethelred is one). Without them the wallet is unusable for
   * any dApp transaction — the client can't compute maxFeePerGas and the
   * write hangs/fails. `eth_maxPriorityFeePerGas` is served from the gas
   * oracle (which itself falls back gracefully); `eth_feeHistory` proxies to
   * the node.
   */
  if (method === "eth_maxPriorityFeePerGas") {
    try {
      const fee = await gasOracle.getMaxPriorityFee();
      return respond("0x" + fee.toString(16));
    } catch (error) {
      return respondError(-32603, error instanceof Error ? error.message : "Priority fee fetch failed");
    }
  }

  if (method === "eth_feeHistory") {
    try {
      const result = await rpcClient.call(method, rpcParams);
      return respond(result);
    } catch (error) {
      return respondError(-32603, error instanceof Error ? error.message : "Fee history fetch failed");
    }
  }

  // ── Transaction sending ──
  if (method === "eth_sendTransaction") {
    return handleSendTransaction(message, rpcParams, origin, signingAuthority.authority);
  }

  // ── Signing ──
  if (method === "personal_sign") {
    return handlePersonalSign(message, rpcParams, origin, signingAuthority.authority);
  }

  if (method === "eth_sign") {
    // eth_sign orders params as [account, data], while personal_sign uses
    // [data, account]. Normalize before entering the shared EIP-191 flow so
    // the account checked above is the account that actually signs.
    return handlePersonalSign(
      message,
      [rpcParams[1], rpcParams[0]],
      origin,
      signingAuthority.authority,
    );
  }

  if (method === "eth_signTypedData_v4") {
    return handleSignTypedData(message, rpcParams, origin, signingAuthority.authority);
  }

  /* ─── eth_subscribe / eth_unsubscribe ──────────────────────
   *
   * Polling-backed implementation of the Alchemy/Infura subscription
   * protocol. Real WebSocket subscriptions require a persistent
   * connection which MV3 service workers can't keep open. Instead we
   * poll the RPC at a reasonable interval and fire synthetic events
   * via an exact-session provider `message` in the shape dApps expect.
   *
   * Supported subscription types:
   *   - `newHeads`     → `eth_blockNumber` every 12s
   *   - `logs`         → `eth_getLogs` with the filter every 12s
   *   - `newPendingTransactions` → not supported (most RPCs don't)
   */
  if (method === "eth_subscribe") {
    const [subType, filter] = rpcParams as [string, unknown?];
    if (subType !== "newHeads" && subType !== "logs") {
      return respondError(-32601, `Unsupported subscription type: ${subType}`);
    }
    const session = sessionManager.getByOrigin(origin);
    if (!session || !isProviderSessionActive(session)) {
      return respondError(4100, "Connect this site before creating a subscription");
    }
    const id = `0x${Math.random().toString(16).slice(2, 18)}`;
    let subscription: Subscription;
    try {
      subscription = await startSubscription(
        id,
        subType,
        filter,
        session.id,
        session.origin,
      );
    } catch {
      return respondError(4100, "The subscription session is no longer active");
    }
    subscriptions.set(id, subscription);
    return respond(id);
  }

  if (method === "eth_unsubscribe") {
    const [id] = rpcParams as [string];
    const sub = subscriptions.get(id);
    const activeSession = sessionManager.getByOrigin(origin);
    if (
      sub &&
      sub.origin === origin &&
      activeSession?.id === sub.sessionId &&
      hasExactActiveProviderSession(sub.sessionId, sub.origin)
    ) {
      sub.stop();
      subscriptions.delete(id);
      return respond(true);
    }
    return respond(false);
  }

  return respondError(4200, `Unsupported method: ${method}`);
}

/* ─── eth_subscribe polling infrastructure ──────────────────── */
interface Subscription {
  id: string;
  type: "newHeads" | "logs";
  sessionId: string;
  origin: string;
  stop: () => void;
}
const subscriptions = new Map<string, Subscription>();

function stopSubscriptionsForSession(sessionId: string): void {
  for (const [id, subscription] of subscriptions) {
    if (subscription.sessionId !== sessionId) continue;
    subscription.stop();
    subscriptions.delete(id);
  }
}

async function startSubscription(
  id: string,
  type: "newHeads" | "logs",
  filter: unknown,
  sessionId: string,
  origin: string,
): Promise<Subscription> {
  let lastBlock = "0x0";
  try {
    lastBlock = await rpcClient.call<string>("eth_blockNumber", []);
  } catch { /* empty */ }

  if (!hasExactActiveProviderSession(sessionId, origin)) {
    throw new Error("Provider session is no longer active");
  }

  const intervalId = setInterval(async () => {
    try {
      if (!hasExactActiveProviderSession(sessionId, origin)) {
        clearInterval(intervalId);
        subscriptions.delete(id);
        return;
      }
      if (type === "newHeads") {
        const current = await rpcClient.call<string>("eth_blockNumber", []);
        if (current !== lastBlock) {
          lastBlock = current;
          const block = await rpcClient.call("eth_getBlockByNumber", [current, false]);
          broadcastProviderEvent(
            "message",
            {
              type: "eth_subscription",
              data: { subscription: id, result: block },
            },
            { exactSessionId: sessionId },
          );
        }
      } else if (type === "logs") {
        const logs = await rpcClient.call("eth_getLogs", [filter]);
        if (Array.isArray(logs) && logs.length > 0) {
          for (const log of logs) {
            broadcastProviderEvent(
              "message",
              {
                type: "eth_subscription",
                data: { subscription: id, result: log },
              },
              { exactSessionId: sessionId },
            );
          }
        }
      }
    } catch {
      // Silent — subscription will keep trying
    }
  }, 12_000);

  return {
    id,
    type,
    sessionId,
    origin,
    stop: () => clearInterval(intervalId),
  };
}

/* ─── Popup-initiated transaction flow (GAP C) ─────────────────────
 *
 * The `handlePrepareTx` + `handleExecuteTx` pair implements the
 * popup-owned send flow that avoids the deadlock caused by awaiting
 * eth_sendTransaction from inside send.tsx. See the detailed comment
 * on GAP C in the architecture notes: the popup-initiated send
 * separates "propose + compute + simulate" from "user confirms +
 * sign + broadcast" so the send view can render confirm UI inline
 * without ever navigating away and unmounting itself.
 *
 * Both helpers use the SAME underlying signing + broadcast primitives
 * as `handleSendTransaction` — no duplicate crypto logic, no divergent
 * code paths. The only difference is the approval delivery mechanism:
 *   - `handleSendTransaction` (dApp path): creates a pendingApproval
 *     and awaits the popup's decision
 *   - `handlePrepareTx` (popup path): computes + returns the detail,
 *     the UI renders confirm inline, then `handleExecuteTx` signs
 *     without creating an approval entry
 */

/**
 * Compute gas + nonce + simulation + detail for a popup-initiated
 * transaction. Returns a `draftId` the popup can pass to `execute-tx`
 * plus a full `ApprovalDetail.kind="tx"` for rich inline confirmation.
 */
async function handlePrepareTx(
  params: Record<string, unknown>,
): Promise<{
  result?: {
    draftId: string;
    detail: ApprovalDetail;
    requiresReview: boolean;
    /** Policy verdict for the review screen: outcome + human warnings. */
    policy: {
      outcome: string;
      warnings: string[];
      amount: number;
      amountUsd?: number;
      assetId: string;
      assetSymbol: string;
      destination?: string;
    };
  };
  error?: { code: number; message: string };
}> {
  const tx = params as {
    from?: string;
    to?: string;
    value?: string;
    data?: string;
    gas?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  };
  const chainContext = captureTransactionChainContext();

  const subject = subjectRegistry.getActive();
  const workspace = workspaceRegistry.getActive();
  if (!subject || !workspace) {
    return { error: { code: 4001, message: "Wallet not configured" } };
  }

  // Resolve the "from" address — use active account if unset
  const resolvedFrom = tx.from ?? getActiveAccount()?.address;
  if (!resolvedFrom) {
    return { error: { code: 4001, message: "No active account" } };
  }
  const fromAccount = keyManager.getAccountByAddress(resolvedFrom);
  if (!fromAccount) {
    return { error: { code: 4001, message: `Account ${resolvedFrom} not found` } };
  }
  const keySlot = keyManager
    .getKeySlots()
    .find((s) => s.address.toLowerCase() === resolvedFrom.toLowerCase());
  if (!keySlot) {
    return { error: { code: 4001, message: "Signing key not found" } };
  }

  // Simulate + heuristic risk
  const simulation = await txSimulator.simulate({
    from: resolvedFrom,
    to: tx.to,
    value: tx.value,
    data: tx.data,
    chainId: chainContext.chainId,
  });

  // Gas
  let gasEstimate;
  try {
    gasEstimate = await chainContext.gasOracle.getFullEstimate({
      from: resolvedFrom,
      to: tx.to,
      value: tx.value,
      data: tx.data,
    });
  } catch (err) {
    return {
      error: { code: -32603, message: `Gas estimation failed: ${err instanceof Error ? err.message : "unknown"}` },
    };
  }

  // The popup-selected fee tier is untrusted bridge input just like dApp
  // transaction fields. Resolve and validate it once, then use this immutable
  // tuple for both the approval detail and the eventual signed transaction.
  let gasParameters;
  try {
    gasParameters = resolveEffectiveEip1559GasParameters(tx, gasEstimate);
  } catch (error) {
    return {
      error: {
        code:
          error instanceof Eip1559GasValidationError && error.source === "caller"
            ? -32602
            : -32603,
        message: error instanceof Error ? error.message : "Invalid EIP-1559 gas parameters",
      },
    };
  }

  // Nonce (uses the nonce-lock from the chain package hardening work)
  let nonce: number;
  try {
    nonce = await chainContext.txManager.getNonce(resolvedFrom);
  } catch (err) {
    return {
      error: { code: -32603, message: `Nonce fetch failed: ${err instanceof Error ? err.message : "unknown"}` },
    };
  }
  let nonceOwned = true;
  const releasePreparedNonce = () => {
    if (!nonceOwned) return;
    chainContext.txManager.releaseNonce(resolvedFrom, nonce);
    nonceOwned = false;
  };

  // Policy check. Spending context (value, destination, 24h velocity) is
  // assembled here so the bundles' spend-limit/destination/velocity rules
  // actually evaluate — before this wiring they were dead code because no
  // caller supplied the fields (disclosed in PR #190).
  const role = workspaceRegistry.getRole(subject.id, workspace.id) ?? "owner";
  const policyBundle = getDefaultPolicyBundle(workspace.kind);
  let spending: ResolvedTransactionSpending;
  try {
    spending = await resolveTransactionSpending(tx, subject.id, chainContext);
  } catch (error) {
    releasePreparedNonce();
    const resolutionError = error as TransactionSpendingResolutionError;
    return {
      error: {
        code:
          resolutionError instanceof TransactionSpendingResolutionError
            ? resolutionError.code
            : -32602,
        message:
          error instanceof Error
            ? error.message
            : "Transaction spending context could not be established",
      },
    };
  }
  const draftId = `draft-${Date.now().toString(36)}-${crypto.randomUUID()}`;
  let reservedVelocity;
  try {
    reservedVelocity = await velocityTracker.reserveOperation({
      reservationId: draftId,
      subjectId: subject.id,
      amountUsd: spending.amountUsd ?? 0,
      assetSymbol: spending.assetSymbol,
      ttlMs: DRAFT_TX_TTL_MS,
    });
  } catch (error) {
    releasePreparedNonce();
    return {
      error: {
        code: 4001,
        message: `Transaction blocked because velocity policy could not be reserved: ${error instanceof Error ? error.message : "unknown error"}`,
      },
    };
  }
  const policyResult = evaluate(
    buildPolicyContext({
      intent: {
        kind: "sign-transaction",
        method: "eth_sendTransaction",
        app: { id: "popup", name: "Aethelred Wallet", origin: "popup", trustLevel: "first-party" },
      },
      subjectId: subject.id,
      subjectRole: role,
      workspace,
      account: {
        id: fromAccount.id,
        label: fromAccount.label,
        address: fromAccount.address,
        namespace: fromAccount.namespace,
        custody: "local",
        assurance: "device-key",
      },
      sessionExists: true,
      destination: spending.destination,
      destinationCategory: spending.destinationCategory,
      amount: spending.amount,
      amountUsd: spending.amountUsd,
      assetId: spending.assetId,
      assetSymbol: spending.assetSymbol,
      assetCategory: spending.assetCategory,
      // Candidate-inclusive totals close the concurrent-request and threshold
      // off-by-one gap (the 201st request sees count=201, not 200).
      requestedOperationCount24h: reservedVelocity.count24h,
      cumulativeValueSpentUsd24h: reservedVelocity.valueUsd24h,
    }),
    policyBundle,
  );
  // An unpriceable transfer must not silently skip value rules. Known ERC-20s
  // additionally force explicit high-risk review; unknown token metadata was
  // already rejected by resolveTransactionSpending.
  const policyWarnings = Array.from(
    new Set([
      ...policyResult.warnings,
      ...(!spending.priced && spending.amount > 0
        ? [UNPRICED_POLICY_NOTICE]
        : []),
      ...spending.reviewWarnings,
    ]),
  );

  if (policyResult.outcome === "deny") {
    releasePreparedNonce();
    await releaseVelocityReservation(draftId, "popup prepare denied by policy");
    return {
      error: { code: 4001, message: policyResult.warnings[0] ?? "Denied by policy" },
    };
  }

  if (transactionChainContextChanged(chainContext)) {
    releasePreparedNonce();
    await releaseVelocityReservation(draftId, "chain changed during popup prepare");
    return {
      error: {
        code: 4901,
        message: `Active chain changed while preparing the transaction. Review it again on ${chainContext.chainId}.`,
      },
    };
  }

  // Store the draft
  const chainIdHex = chainContext.chainId;
  let draft: DraftTx;
  try {
    draft = {
      id: draftId,
      from: resolvedFrom,
      to: tx.to ? tx.to : null,
      value: hexToBigInt(tx.value),
      data: hexToBytes(tx.data),
      nonce,
      txManager: chainContext.txManager,
      ownsNonce: true,
      gasLimit: gasParameters.gasLimit,
      maxFeePerGas: gasParameters.maxFeePerGas,
      maxPriorityFeePerGas: gasParameters.maxPriorityFeePerGas,
      chainId: chainIdHex,
      chainEpoch: chainContext.epoch,
      createdAt: Date.now(),
      keySlotId: keySlot.id,
      origin: "popup",
      subjectId: subject.id,
      workspaceId: workspace.id,
      velocityReservationId: draftId,
      spending,
      amountUsd: spending.amountUsd,
      assetSymbol: spending.assetSymbol,
    };
  } catch (error) {
    releasePreparedNonce();
    await releaseVelocityReservation(draftId, "popup draft construction failed");
    return {
      error: {
        code: -32602,
        message: `Invalid transaction fields: ${error instanceof Error ? error.message : "unknown error"}`,
      },
    };
  }
  draftTxs.set(draftId, draft);
  nonceOwned = false; // ownership transferred to the stored draft

  const simWarnings: string[] = Array.isArray((simulation as unknown as { warnings?: string[] }).warnings)
    ? (simulation as unknown as { warnings: string[] }).warnings
    : [];
  const decoded = (simulation as unknown as {
    decodedCall?: { method?: string; params?: Record<string, unknown> };
  }).decodedCall;

  const simulationRisk = simulation.overallRisk;
  const detail: ApprovalDetail = {
    kind: "tx",
    chainId: chainIdHex,
    from: resolvedFrom,
    to: tx.to ?? null,
    value: `0x${hexToBigInt(tx.value ?? "0x0").toString(16)}`,
    data: tx.data ?? "0x",
    nonce,
    gasLimit: "0x" + draft.gasLimit.toString(16),
    maxFeePerGas: "0x" + draft.maxFeePerGas.toString(16),
    maxPriorityFeePerGas: "0x" + draft.maxPriorityFeePerGas.toString(16),
    estimatedFee: "0x" + (draft.gasLimit * draft.maxFeePerGas).toString(16),
    simulationRisk:
      spending.requiresHighRiskReview && (simulationRisk === "low" || simulationRisk === "medium")
        ? "high"
        : simulationRisk,
    warnings: Array.from(new Set([...simWarnings, ...policyWarnings])),
    decodedMethod: spending.tokenContract ? "transfer" : decoded?.method,
    decodedParams: spending.tokenContract
      ? {
          recipient: spending.decodedRecipient ?? "",
          amount: formatExactBaseUnits(spending.amountBaseUnits, spending.assetDecimals),
          amountBaseUnits: spending.amountBaseUnits.toString(),
          symbol: spending.assetSymbol,
          tokenContract: spending.tokenContract,
        }
      : decoded?.params
        ? Object.fromEntries(Object.entries(decoded.params).map(([k, v]) => [k, String(v)]))
        : undefined,
    reviewedSpending: buildReviewedTxSpending(
      spending,
      tx.to ?? null,
      tx.value ?? "0x0",
    ),
    amountUsd: spending.amountUsd,
    assetSymbol: spending.assetSymbol,
  };

  const effectivePolicyOutcome = spending.requiresHighRiskReview
    ? "approval-required"
    : policyResult.outcome;

  return {
    result: {
      draftId,
      detail,
      requiresReview: effectivePolicyOutcome === "approval-required",
      policy: {
        outcome: effectivePolicyOutcome,
        warnings: policyWarnings,
        amount: spending.amount,
        amountUsd: spending.amountUsd,
        assetId: spending.assetId,
        assetSymbol: spending.assetSymbol,
        destination: spending.destination,
      },
    },
  };
}

/**
 * Sign + broadcast a previously-prepared draft tx. Caller passes the
 * `draftId` from `handlePrepareTx`. Returns the real tx hash from the
 * chain. Deletes the draft on success or failure.
 */
async function handleExecuteTx(
  params: { draftId: string },
): Promise<{
  result?: { hash: string; draftId: string };
  error?: { code: number; message: string };
}> {
  const draft = draftTxs.get(params.draftId);
  if (!draft) {
    return { error: { code: -32602, message: `Draft not found or expired: ${params.draftId}` } };
  }
  // Atomically claim the draft before the first await. Execute is one-shot:
  // concurrent execute/cancel/expiry handlers can no longer release or
  // broadcast the same nonce while this attempt is in flight.
  draftTxs.delete(draft.id);
  if (transactionChainContextChanged({ chainId: draft.chainId, epoch: draft.chainEpoch })) {
    releaseDraftNonce(draft);
    await releaseVelocityReservation(draft.velocityReservationId, "popup execute chain mismatch");
    return {
      error: {
        code: 4901,
        message: `Active chain changed after this transaction was reviewed. Prepare it again on ${draft.chainId}.`,
      },
    };
  }
  const draftTxManager = draft.txManager;
  // Policy token for the signer
  const policyToken = { intentId: `popup-tx-${Date.now()}`, outcome: "allow" as const, timestamp: Date.now() };

  const subject = subjectRegistry.getActive();
  const workspace = workspaceRegistry.getActive();
  if (
    !subject ||
    !workspace ||
    subject.id !== draft.subjectId ||
    workspace.id !== draft.workspaceId
  ) {
    draftTxs.delete(draft.id);
    releaseDraftNonce(draft);
    await releaseVelocityReservation(draft.velocityReservationId, "popup execute identity changed");
    return {
      error: {
        code: 4001,
        message: "Active wallet identity or workspace changed. Prepare and review the transaction again.",
      },
    };
  }

  const account = keyManager.getAccountByAddress(draft.from);
  if (!account) {
    draftTxs.delete(draft.id);
    releaseDraftNonce(draft);
    await releaseVelocityReservation(draft.velocityReservationId, "popup execute account missing");
    return { error: { code: 4001, message: "Draft signing account is no longer available" } };
  }

  // A prepared policy verdict is not an execution capability. Revalidate the
  // persisted reservation against current committed + in-flight totals so a
  // later draft cannot bypass work that arrived after preparation.
  let executeVelocity;
  try {
    executeVelocity = await velocityTracker.renewReservation(
      draft.velocityReservationId,
      DRAFT_TX_TTL_MS,
    );
  } catch (error) {
    draftTxs.delete(draft.id);
    releaseDraftNonce(draft);
    return {
      error: {
        code: 4001,
        message: `Transaction must be prepared again because its velocity reservation is unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
      },
    };
  }
  const executePolicy = evaluate(
    buildPolicyContext({
      intent: {
        kind: "sign-transaction",
        method: "eth_sendTransaction",
        app: {
          id: "popup",
          name: "Aethelred Wallet",
          origin: "popup",
          trustLevel: "first-party",
        },
      },
      subjectId: subject.id,
      subjectRole: workspaceRegistry.getRole(subject.id, workspace.id) ?? "owner",
      workspace,
      account: {
        id: account.id,
        label: account.label,
        address: account.address,
        namespace: account.namespace,
        custody: "local",
        assurance: "device-key",
      },
      sessionExists: true,
      destination: draft.spending.destination,
      destinationCategory: draft.spending.destinationCategory,
      amount: draft.spending.amount,
      amountUsd: draft.spending.amountUsd,
      assetId: draft.spending.assetId,
      assetSymbol: draft.spending.assetSymbol,
      assetCategory: draft.spending.assetCategory,
      requestedOperationCount24h: executeVelocity.count24h,
      cumulativeValueSpentUsd24h: executeVelocity.valueUsd24h,
    }),
    getDefaultPolicyBundle(workspace.kind),
  );
  if (executePolicy.outcome === "deny") {
    draftTxs.delete(draft.id);
    releaseDraftNonce(draft);
    await releaseVelocityReservation(draft.velocityReservationId, "popup execute denied by policy");
    return {
      error: {
        code: 4001,
        message: executePolicy.warnings[0] ?? "Denied by policy during execution revalidation",
      },
    };
  }

  let signedOutput;
  try {
    signedOutput = await buildAndSignEip1559Tx(
      {
        chainId: hexToBigInt(draft.chainId),
        nonce: BigInt(draft.nonce),
        maxPriorityFeePerGas: draft.maxPriorityFeePerGas,
        maxFeePerGas: draft.maxFeePerGas,
        gasLimit: draft.gasLimit,
        to: draft.to ? addressToBytes(draft.to) : null,
        value: draft.value,
        data: draft.data,
        accessList: [],
      },
      signer,
      draft.keySlotId,
      policyToken,
    );
  } catch (err) {
    draftTxs.delete(draft.id);
    releaseDraftNonce(draft);
    await releaseVelocityReservation(draft.velocityReservationId, "popup signing failed");
    return {
      error: { code: -32603, message: `Signing failed: ${err instanceof Error ? err.message : "unknown"}` },
    };
  }

  if (transactionChainContextChanged({ chainId: draft.chainId, epoch: draft.chainEpoch })) {
    draftTxs.delete(draft.id);
    releaseDraftNonce(draft);
    await releaseVelocityReservation(draft.velocityReservationId, "popup chain changed before broadcast");
    return {
      error: {
        code: 4901,
        message: `Active chain changed before broadcast. Prepare and review the transaction again on ${draft.chainId}.`,
      },
    };
  }

  try {
    await velocityTracker.markBroadcastPending(draft.velocityReservationId);
  } catch (error) {
    draftTxs.delete(draft.id);
    releaseDraftNonce(draft);
    await releaseVelocityReservation(draft.velocityReservationId, "popup broadcast reservation failed");
    return {
      error: {
        code: 4001,
        message: `Transaction was not broadcast because velocity state could not be made durable: ${error instanceof Error ? error.message : "unknown error"}`,
      },
    };
  }

  let broadcastHash: string;
  try {
    // From the moment raw submission starts, transport failure is ambiguous;
    // the nonce must never return to the reusable pool.
    draft.ownsNonce = false;
    broadcastHash = await draftTxManager.broadcast(signedOutput.rawTx);
  } catch (err) {
    draftTxs.delete(draft.id);
    // Submission may have reached the node before its response was lost.
    // Retain the durable full-window reservation and consumed nonce.
    return {
      error: { code: -32603, message: `Broadcast failed: ${err instanceof Error ? err.message : "unknown"}` },
    };
  }

  let velocityCommitError: string | undefined;
  try {
    await velocityTracker.commitReservation(
      draft.velocityReservationId,
      broadcastHash,
    );
  } catch (error) {
    // The full-window broadcast-pending reservation was persisted before the
    // network call, so this failure remains fail-closed across MV3 restart.
    velocityCommitError = error instanceof Error ? error.message : "unknown error";
    console.error("[velocity] popup broadcast commit failed", error);
  }

  // Track
  draftTxManager.trackTransaction({
    hash: broadcastHash,
    from: draft.from,
    to: draft.to ?? "",
    value: "0x" + draft.value.toString(16),
    nonce: draft.nonce,
    gasLimit: "0x" + draft.gasLimit.toString(16),
    maxFeePerGas: "0x" + draft.maxFeePerGas.toString(16),
    maxPriorityFeePerGas: "0x" + draft.maxPriorityFeePerGas.toString(16),
    data: "0x" + Array.from(draft.data, (b) => b.toString(16).padStart(2, "0")).join(""),
    chainId: draft.chainId,
  });

  // Poll for receipt in the background (same pattern as handleSendTransaction)
  draftTxManager
    .pollReceipt(broadcastHash)
    .then((receipt) => {
      const status = receipt?.status === "0x1" ? "confirmed" : receipt ? "failed" : "dropped";
      const payload = {
        hash: broadcastHash,
        status,
        blockNumber: receipt?.blockNumber,
        gasUsed: receipt?.gasUsed,
        chainId: draft.chainId,
      };
      try {
        chrome.runtime
          .sendMessage({ kind: "tx-updated", correlationId: "", payload, timestamp: Date.now() })
          .catch(() => {});
      } catch { /* popup may be closed */ }
      // Popup-owned transactions have no dApp session attribution. Keep the
      // receipt update extension-internal rather than leaking it to pages.
      broadcastState();
    })
    .catch(() => {});

  if (subject && workspace) {
    auditCapture.record({
      kind: "signing-executed",
      subjectId: subject.id,
      workspaceId: workspace.id,
      detail: {
        method: "popup-send-tx",
        nonce: draft.nonce,
        hash: broadcastHash,
        velocityCommitError,
      },
    });
  }

  draftTxs.delete(draft.id);
  persistState();
  broadcastState();
  return { result: { hash: broadcastHash, draftId: draft.id } };
}

/**
 * ─── eth_sendTransaction handler (REAL IMPLEMENTATION) ──────────────
 *
 * Previously this handler signed a JSON blob, generated a random
 * 32-byte hex string, returned that as the "hash" to the dApp, and
 * never broadcast anything. The wallet literally lied to callers about
 * whether their transactions had been sent.
 *
 * The new pipeline:
 *   1. Parse the incoming hex-encoded tx fields (from, to, value, data, gas)
 *   2. Fetch the current nonce from the chain (via RpcClient)
 *   3. Fetch gas tiers from the gas oracle (maxFee / maxPriorityFee)
 *   4. Simulate + heuristic analysis for the approval UI
 *   5. Run the policy engine (auto-deny / auto-allow / prompt)
 *   6. REQUIRE user approval in the popup (the auto-sign path was the
 *      single biggest security hole — any dApp could drain any account)
 *   7. Build the unsigned EIP-1559 RLP preimage + keccak256 digest
 *   8. Sign via `Signer.signTransaction` → `LocalCustodyBackend.sign`
 *   9. Assemble the signed RLP 0x02 payload
 *   10. Broadcast via `TxManager.broadcast` → `eth_sendRawTransaction`
 *   11. Return the REAL tx hash from the node, track it for receipt polling
 */
async function handleSendTransaction(
  message: BridgeMessage,
  params: unknown[],
  origin: string,
  signingAuthority: DappSigningAuthoritySnapshot | undefined,
): Promise<BridgeMessage> {
  const incomingTx = params[0] as {
    from: string;
    to?: string;
    value?: string;
    data?: string;
    gas?: string;
    gasLimit?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    gasPrice?: string;
  };
  // Snapshot every caller-controlled primitive at request entry. In
  // particular, never read gas overrides again after the approval has been
  // displayed: the bridge payload is untrusted mutable input.
  const tx = Object.freeze({
    from: incomingTx.from,
    to: incomingTx.to,
    value: incomingTx.value,
    data: incomingTx.data,
    gas: incomingTx.gas,
    gasLimit: incomingTx.gasLimit,
    maxFeePerGas: incomingTx.maxFeePerGas,
    maxPriorityFeePerGas: incomingTx.maxPriorityFeePerGas,
    gasPrice: incomingTx.gasPrice,
  });
  const chainContext = captureTransactionChainContext();
  const subject = subjectRegistry.getActive();
  const workspace = workspaceRegistry.getActive();

  const respondError = (code: number, msg: string): BridgeMessage => ({
    kind: "rpc-response",
    correlationId: message.correlationId,
    payload: { error: { code, message: msg } },
    timestamp: Date.now(),
  });

  if (!subject || !workspace) {
    return respondError(4001, "Wallet not configured");
  }

  // ── 1. Simulate + heuristic risk analysis ──
  const simulation = await txSimulator.simulate({
    from: tx.from,
    to: tx.to,
    value: tx.value,
    data: tx.data,
    chainId: chainContext.chainId,
  });

  // ── 2. Gas estimate ──
  let gasEstimate;
  try {
    gasEstimate = await chainContext.gasOracle.getFullEstimate({
      from: tx.from,
      to: tx.to,
      value: tx.value,
      data: tx.data,
    });
  } catch (err) {
    // RPC failure — we cannot safely broadcast without a gas estimate
    return respondError(
      -32603,
      `Gas estimation failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }

  let gasParameters;
  try {
    gasParameters = resolveEffectiveEip1559GasParameters(tx, gasEstimate);
  } catch (error) {
    return respondError(
      error instanceof Eip1559GasValidationError && error.source === "caller"
        ? -32602
        : -32603,
      error instanceof Error ? error.message : "Invalid EIP-1559 gas parameters",
    );
  }

  // ── 3. Nonce ──
  let nonce: number;
  try {
    nonce = await chainContext.txManager.getNonce(tx.from);
  } catch (err) {
    return respondError(
      -32603,
      `Nonce fetch failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }
  let nonceOwned = true;
  const releaseDappNonce = () => {
    if (!nonceOwned) return;
    chainContext.txManager.releaseNonce(tx.from, nonce);
    nonceOwned = false;
  };

  const account = keyManager.getAccountByAddress(tx.from);
  if (!account) {
    releaseDappNonce();
    return respondError(4001, `Account ${tx.from} not found`);
  }

  const role = workspaceRegistry.getRole(subject.id, workspace.id) ?? "owner";
  const policyBundle = getDefaultPolicyBundle(workspace.kind);
  const appIdentity = resolveAppIdentity(origin);
  const gasLimitHex = "0x" + gasParameters.gasLimit.toString(16);
  const maxFeePerGasHex = "0x" + gasParameters.maxFeePerGas.toString(16);
  const maxPriorityFeePerGasHex = "0x" + gasParameters.maxPriorityFeePerGas.toString(16);
  const estimatedFeeWei = gasParameters.estimatedFee;
  const simWarnings: string[] = Array.isArray((simulation as unknown as { warnings?: string[] }).warnings)
    ? (simulation as unknown as { warnings: string[] }).warnings
    : [];
  const decoded = (simulation as unknown as {
    decodedCall?: { method?: string; params?: Record<string, unknown> };
  }).decodedCall;
  let dappSpending: ResolvedTransactionSpending;
  try {
    dappSpending = await resolveTransactionSpending(tx, subject.id, chainContext);
  } catch (error) {
    releaseDappNonce();
    const resolutionError = error as TransactionSpendingResolutionError;
    return respondError(
      resolutionError instanceof TransactionSpendingResolutionError
        ? resolutionError.code
        : -32602,
      error instanceof Error
        ? error.message
        : "Transaction spending context could not be established",
    );
  }
  const simulationRisk = simulation.overallRisk;
  const spendingWarnings = Array.from(
    new Set([
      ...(!dappSpending.priced && dappSpending.amount > 0
        ? [UNPRICED_POLICY_NOTICE]
        : []),
      ...dappSpending.reviewWarnings,
    ]),
  );
  const txApproval = applyTerraQuraApprovalPresentation({
    app: appIdentity,
    mode: "send",
    defaultTitle: "Confirm transaction",
    defaultSummary: `${formatAppRequestLabel(appIdentity)} is asking to send a transaction from ${account.label}.`,
    detail: {
      kind: "tx",
      chainId: chainContext.chainId,
      from: tx.from,
      to: tx.to ?? null,
      value: `0x${hexToBigInt(tx.value ?? "0x0").toString(16)}`,
      data: tx.data ?? "0x",
      nonce,
      gasLimit: gasLimitHex,
      maxFeePerGas: maxFeePerGasHex,
      maxPriorityFeePerGas: maxPriorityFeePerGasHex,
      estimatedFee: "0x" + estimatedFeeWei.toString(16),
      simulationRisk:
        dappSpending.requiresHighRiskReview &&
        (simulationRisk === "low" || simulationRisk === "medium")
          ? "high"
          : simulationRisk,
      warnings: Array.from(new Set([...simWarnings, ...spendingWarnings])),
      decodedMethod: dappSpending.tokenContract ? "transfer" : decoded?.method,
      decodedParams: dappSpending.tokenContract
        ? {
            recipient: dappSpending.decodedRecipient ?? "",
            amount: formatExactBaseUnits(
              dappSpending.amountBaseUnits,
              dappSpending.assetDecimals,
            ),
            amountBaseUnits: dappSpending.amountBaseUnits.toString(),
            symbol: dappSpending.assetSymbol,
            tokenContract: dappSpending.tokenContract,
          }
        : decoded?.params
          ? Object.fromEntries(
              Object.entries(decoded.params).map(([k, v]) => [k, String(v)]),
            )
          : undefined,
      reviewedSpending: buildReviewedTxSpending(
        dappSpending,
        tx.to ?? null,
        tx.value ?? "0x0",
      ),
      amountUsd: dappSpending.amountUsd,
      assetSymbol: dappSpending.assetSymbol,
    },
  });
  const terraquraTxAssessment = inspectTerraQuraTransaction(appIdentity, txApproval.detail);

  // ── 4. Audit request + policy eval ──
  auditCapture.record({
    kind: "request-received",
    subjectId: subject.id,
    workspaceId: workspace.id,
    appId: appIdentity.id,
    detail: {
      method: "eth_sendTransaction",
      to: tx.to,
      value: tx.value,
      origin,
      simulation: simulation.overallRisk,
      nonce,
      decodedMethod: txApproval.detail.decodedMethod,
      targetContractAddress: txApproval.detail.to,
      targetContractLabel: terraquraTxAssessment.targetContractLabel,
      targetContractTrust: terraquraTxAssessment.contractTrust,
      appSurface: terraquraTxAssessment.actionLabel,
      policyDestination: dappSpending.destination,
      policyAmount: dappSpending.amount,
      policyAmountUsd: dappSpending.amountUsd,
      policyAssetId: dappSpending.assetId,
      policyAssetSymbol: dappSpending.assetSymbol,
      policyPriceEstablished: dappSpending.priced,
    },
  });

  const velocityReservationId = `dapp-${message.correlationId}-${crypto.randomUUID()}`;
  let reservedVelocity;
  try {
    reservedVelocity = await velocityTracker.reserveOperation({
      reservationId: velocityReservationId,
      subjectId: subject.id,
      amountUsd: dappSpending.amountUsd ?? 0,
      assetSymbol: dappSpending.assetSymbol,
    });
  } catch (error) {
    releaseDappNonce();
    return respondError(
      4001,
      `Transaction blocked because velocity policy could not be reserved: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const policyResult = evaluate(
    buildPolicyContext({
      intent: {
        kind: "sign-transaction",
        method: "eth_sendTransaction",
        app: appIdentity,
      },
      subjectId: subject.id,
      subjectRole: role,
      workspace,
      account: {
        id: account.id,
        label: account.label,
        address: account.address,
        namespace: account.namespace,
        custody: "local",
        assurance: "device-key",
      },
      sessionExists: !!sessionManager.getByOrigin(origin),
      destination: dappSpending.destination,
      destinationCategory: dappSpending.destinationCategory,
      amount: dappSpending.amount,
      amountUsd: dappSpending.amountUsd,
      assetId: dappSpending.assetId,
      assetSymbol: dappSpending.assetSymbol,
      assetCategory: dappSpending.assetCategory,
      requestedOperationCount24h: reservedVelocity.count24h,
      cumulativeValueSpentUsd24h: reservedVelocity.valueUsd24h,
    }),
    policyBundle,
  );
  const effectivePolicyOutcome =
    dappSpending.requiresHighRiskReview && policyResult.outcome !== "deny"
      ? "approval-required"
      : policyResult.outcome;

  auditCapture.record({
    kind: "policy-evaluated",
    subjectId: subject.id,
    workspaceId: workspace.id,
    appId: appIdentity.id,
    detail: {
      outcome: effectivePolicyOutcome,
      risk: txApproval.detail.simulationRisk,
      decodedMethod: txApproval.detail.decodedMethod,
      targetContractLabel: terraquraTxAssessment.targetContractLabel,
      targetContractTrust: terraquraTxAssessment.contractTrust,
      destination: dappSpending.destination,
      amount: dappSpending.amount,
      amountUsd: dappSpending.amountUsd,
      assetId: dappSpending.assetId,
      assetSymbol: dappSpending.assetSymbol,
      priceEstablished: dappSpending.priced,
    },
  });

  if (policyResult.outcome === "deny") {
    releaseDappNonce();
    await releaseVelocityReservation(velocityReservationId, "dApp send denied by policy");
    return respondError(4001, policyResult.warnings[0] ?? "Denied by policy");
  }

  if (transactionChainContextChanged(chainContext)) {
    releaseDappNonce();
    await releaseVelocityReservation(velocityReservationId, "dApp chain changed during policy evaluation");
    return respondError(
      4901,
      `Active chain changed while evaluating the transaction. Submit it again on ${chainContext.chainId}.`,
    );
  }

  /* ── 4a. Workflow engine (enterprise / high-value approvals) ──
   *
   * When the policy engine returns "approval-required" we create a
   * `WorkflowRequest` so the approval lifecycle is auditable, expirable,
   * and — for enterprise workspaces — reviewer-scoped. This gives the
   * approval queue proper quorum/escalation semantics even in the
   * single-reviewer personal case (the template falls through to
   * personalApprovalTemplate). The subsequent `requestUserApproval`
   * still drives the popup UI; the engine is the system of record
   * for the decision trail.
   *
   * Without this wiring, the `workflowEngine` instance was dead code
   * and enterprise approvals had no persistent decision trail — a
   * SOC-2 audit failure.
   */
  let workflowRequestId: string | null = null;
  if (effectivePolicyOutcome === "approval-required") {
    try {
      const template = getApprovalTemplate(
        workspace.kind,
        dappSpending.requiresHighRiskReview ||
          (dappSpending.amountUsd ?? 0) > 100_000 ||
          gasParameters.estimatedFee > 10_000_000_000_000_000n,
      );
      const wfRequest = workflowEngine.createRequest({
        title: "Transaction approval",
        summary: `${appIdentity.name} — ${txApproval.detail.decodedMethod ?? "send"} from ${account.label ?? account.address}`,
        workspaceId: workspace.id,
        requesterId: subject.id,
        appId: appIdentity.id,
        appOrigin: origin,
        intentId: `tx-${Date.now()}`,
        intentKind: "sign-transaction",
        template,
        reviewers: [
          { subjectId: subject.id, displayName: subject.displayName ?? "You", role: role as WorkspaceRole },
        ],
        context: {
          operationType: txApproval.detail.decodedMethod ?? "eth_sendTransaction",
          amount: dappSpending.amount.toString(),
          asset: dappSpending.assetSymbol,
          destination: dappSpending.destination,
          riskLevel: txApproval.detail.simulationRisk,
          riskSignals: terraquraTxAssessment.trustWarning
            ? [{
                title: terraquraTxAssessment.contractTrust === "unpinned"
                  ? "Unpinned TerraQura deployment"
                  : "Untrusted TerraQura contract",
                description: terraquraTxAssessment.trustWarning,
              }]
            : undefined,
          policyMode: policyBundle.mode,
          matchedPolicyRules: policyResult.matchedRules.map((r) => r.id),
          simulationSummary: txApproval.detail.decodedMethod
            ? `${txApproval.detail.decodedMethod} ${dappSpending.amount} ${dappSpending.assetSymbol} to ${dappSpending.destination ?? "contract"} via ${terraquraTxAssessment.targetContractLabel ?? tx.to ?? "contract"}`
            : `send ${dappSpending.amount} ${dappSpending.assetSymbol} → ${dappSpending.destination ?? "contract"}`,
          targetContractAddress: txApproval.detail.to ?? undefined,
          targetContractLabel: terraquraTxAssessment.targetContractLabel,
          targetContractTrust: terraquraTxAssessment.contractTrust,
          appSurface: terraquraTxAssessment.actionLabel,
        } satisfies ApprovalContext,
      });
      workflowRequestId = wfRequest.id;
    } catch (err) {
      // Workflow failures must not block the popup flow — we log,
      // fall through to the popup, and let the audit trail catch it.
      console.warn("[workflowEngine] createRequest failed", err);
    }
  }

  // ── 5. REQUIRE user approval (the security fix) ──
  let approvalDecision: "approved" | "rejected";
  try {
    approvalDecision = await requestUserApproval({
      title: txApproval.title,
      summary: txApproval.summary,
      appName: appIdentity.name,
      origin,
      detail: txApproval.detail,
    });
  } catch (error) {
    releaseDappNonce();
    await releaseVelocityReservation(velocityReservationId, "dApp approval failed");
    return respondError(
      4001,
      `Transaction approval failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  // Report the popup's decision back to the workflow engine so the
  // request's reviewer trail is complete. For single-reviewer personal
  // this resolves the workflow immediately; enterprise quorum logic
  // would aggregate decisions across reviewers.
  if (workflowRequestId) {
    try {
      workflowEngine.submitDecision(workflowRequestId, {
        reviewerId: subject.id,
        reviewerName: subject.displayName ?? "You",
        decision: approvalDecision === "approved" ? "approved" : "rejected",
        reason: approvalDecision === "rejected" ? "User rejected in popup" : "User approved in popup",
      });
    } catch (err) {
      console.warn("[workflowEngine] submitDecision failed", err);
    }
  }

  if (approvalDecision === "rejected") {
    auditCapture.record({
      kind: "response-sent",
      subjectId: subject.id,
      workspaceId: workspace.id,
      detail: { method: "eth_sendTransaction", outcome: "rejected" },
    });
    releaseDappNonce();
    await releaseVelocityReservation(velocityReservationId, "dApp approval rejected");
    return respondError(4001, "User rejected the request");
  }

  const authorityAfterApproval = revalidateDappSigningAuthority(signingAuthority);
  if (!authorityAfterApproval.ok) {
    auditCapture.record({
      kind: "response-sent",
      subjectId: subject.id,
      workspaceId: workspace.id,
      detail: {
        method: "eth_sendTransaction",
        outcome: "session-authority-revoked-after-approval",
        sessionId: signingAuthority?.sessionId,
      },
    });
    releaseDappNonce();
    await releaseVelocityReservation(velocityReservationId, "dApp session authority revoked");
    return respondError(authorityAfterApproval.code, authorityAfterApproval.message);
  }

  if (transactionChainContextChanged(chainContext)) {
    auditCapture.record({
      kind: "response-sent",
      subjectId: subject.id,
      workspaceId: workspace.id,
      detail: {
        method: "eth_sendTransaction",
        outcome: "chain-changed",
        expectedChainId: chainContext.chainId,
        activeChainId: networkManager.getActiveChainId(),
      },
    });
    releaseDappNonce();
    await releaseVelocityReservation(velocityReservationId, "dApp chain changed after approval");
    return respondError(
      4901,
      `Active chain changed after approval. Submit and review the transaction again on ${chainContext.chainId}.`,
    );
  }

  // ── 6. Locate signing key slot ──
  const keySlot = keyManager
    .getKeySlots()
    .find((s) => s.address.toLowerCase() === tx.from.toLowerCase());
  if (!keySlot) {
    releaseDappNonce();
    await releaseVelocityReservation(velocityReservationId, "dApp signing key missing");
    return respondError(4001, "Signing key not found");
  }

  // ── 7. Build + sign + broadcast (REAL) ──
  const policyToken = { intentId: `tx-${Date.now()}`, outcome: "allow" as const, timestamp: Date.now() };
  const chainIdHex = chainContext.chainId;

  let signedOutput;
  try {
    const authorityBeforeSigning = revalidateDappSigningAuthority(signingAuthority);
    if (!authorityBeforeSigning.ok) {
      releaseDappNonce();
      await releaseVelocityReservation(velocityReservationId, "dApp authority revoked before signing");
      return respondError(authorityBeforeSigning.code, authorityBeforeSigning.message);
    }
    signedOutput = await buildAndSignEip1559Tx(
      {
        chainId: hexToBigInt(chainIdHex),
        nonce: BigInt(nonce),
        maxPriorityFeePerGas: gasParameters.maxPriorityFeePerGas,
        maxFeePerGas: gasParameters.maxFeePerGas,
        gasLimit: gasParameters.gasLimit,
        to: addressToBytes(tx.to ?? null),
        value: hexToBigInt(tx.value),
        data: hexToBytes(tx.data),
        accessList: [],
      },
      signer,
      keySlot.id,
      policyToken,
    );
  } catch (err) {
    auditCapture.record({
      kind: "response-sent",
      subjectId: subject.id,
      workspaceId: workspace.id,
      detail: { method: "eth_sendTransaction", outcome: "sign-failed", error: err instanceof Error ? err.message : "unknown" },
    });
    releaseDappNonce();
    await releaseVelocityReservation(velocityReservationId, "dApp signing failed");
    return respondError(-32603, `Signing failed: ${err instanceof Error ? err.message : "unknown"}`);
  }

  if (transactionChainContextChanged(chainContext)) {
    auditCapture.record({
      kind: "response-sent",
      subjectId: subject.id,
      workspaceId: workspace.id,
      detail: {
        method: "eth_sendTransaction",
        outcome: "chain-changed-before-broadcast",
        expectedChainId: chainContext.chainId,
        activeChainId: networkManager.getActiveChainId(),
      },
    });
    releaseDappNonce();
    await releaseVelocityReservation(velocityReservationId, "dApp chain changed before broadcast");
    return respondError(
      4901,
      `Active chain changed before broadcast. Submit and review the transaction again on ${chainContext.chainId}.`,
    );
  }

  auditCapture.record({
    kind: "signing-executed",
    subjectId: subject.id,
    workspaceId: workspace.id,
    detail: { method: "eth_sendTransaction", nonce, expectedHash: signedOutput.hash },
  });

  // ── 8. Broadcast via eth_sendRawTransaction (REAL) ──
  const authorityBeforeBroadcast = revalidateDappSigningAuthority(signingAuthority);
  if (!authorityBeforeBroadcast.ok) {
    releaseDappNonce();
    await releaseVelocityReservation(velocityReservationId, "dApp authority revoked before broadcast");
    return respondError(authorityBeforeBroadcast.code, authorityBeforeBroadcast.message);
  }
  try {
    // Persist a full-window fallback before entering the network uncertainty
    // window. If MV3 is evicted or the hash commit fails, this send still
    // consumes velocity capacity after restart.
    await velocityTracker.markBroadcastPending(velocityReservationId);
  } catch (error) {
    releaseDappNonce();
    await releaseVelocityReservation(velocityReservationId, "dApp broadcast reservation failed");
    return respondError(
      4001,
      `Transaction was not broadcast because velocity state could not be made durable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  // The durable storage write above yields to other extension events. A site
  // can be revoked (or the active chain can change) while it is pending, so
  // this is the true final authorization boundary before network submission.
  const authorityAfterBroadcastReservation =
    revalidateDappSigningAuthority(signingAuthority);
  if (!authorityAfterBroadcastReservation.ok) {
    releaseDappNonce();
    await releaseVelocityReservation(
      velocityReservationId,
      "dApp authority revoked after broadcast reservation",
    );
    return respondError(
      authorityAfterBroadcastReservation.code,
      authorityAfterBroadcastReservation.message,
    );
  }
  if (transactionChainContextChanged(chainContext)) {
    releaseDappNonce();
    await releaseVelocityReservation(
      velocityReservationId,
      "dApp chain changed after broadcast reservation",
    );
    return respondError(
      4901,
      `Active chain changed before broadcast. Submit and review the transaction again on ${chainContext.chainId}.`,
    );
  }

  let broadcastHash: string;
  try {
    // Once RPC submission begins, a transport error is ambiguous: the node may
    // have accepted the transaction before the response was lost. Never reuse
    // that nonce on the broadcast-error path.
    nonceOwned = false;
    broadcastHash = await chainContext.txManager.broadcast(signedOutput.rawTx);
  } catch (err) {
    auditCapture.record({
      kind: "response-sent",
      subjectId: subject.id,
      workspaceId: workspace.id,
      detail: { method: "eth_sendTransaction", outcome: "broadcast-failed", error: err instanceof Error ? err.message : "unknown" },
    });
    // Raw submission is ambiguous after transport failure. Retain the durable
    // full-window reservation and consumed nonce across MV3 restart.
    return respondError(
      -32603,
      `Broadcast failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }

  let velocityCommitError: string | undefined;
  try {
    await velocityTracker.commitReservation(velocityReservationId, broadcastHash);
  } catch (error) {
    // The pre-broadcast full-window reservation is already durable, so future
    // policy checks remain fail-closed even though conversion to the hash
    // record failed. Return the real hash: retrying a broadcast would be worse.
    velocityCommitError = error instanceof Error ? error.message : "unknown error";
    console.error("[velocity] dApp broadcast commit failed", error);
  }

  // ── 9. Track for receipt polling ──
  chainContext.txManager.trackTransaction({
    hash: broadcastHash,
    from: tx.from,
    to: tx.to ?? "",
    value: tx.value ?? "0x0",
    nonce,
    gasLimit: gasLimitHex,
    maxFeePerGas: maxFeePerGasHex,
    maxPriorityFeePerGas: maxPriorityFeePerGasHex,
    data: tx.data ?? "0x",
    chainId: chainIdHex,
  });

  // Poll for receipt in the background — don't block the dApp response.
  // The non-standard receipt signal is returned only to the exact session
  // and account that initiated the transaction. Other connected origins
  // must not learn the hash, status, chain, or timing.
  chainContext.txManager
    .pollReceipt(broadcastHash)
    .then((receipt) => {
      const status = receipt?.status === "0x1" ? "confirmed" : receipt ? "failed" : "dropped";
      const payload = {
        hash: broadcastHash,
        status,
        blockNumber: receipt?.blockNumber,
        gasUsed: receipt?.gasUsed,
        chainId: chainIdHex,
      };
      // Popup listeners (useWalletState, tx history view)
      try {
        chrome.runtime
          .sendMessage({
            kind: "tx-updated",
            correlationId: "",
            payload,
            timestamp: Date.now(),
          })
          .catch(() => {});
      } catch { /* popup may be closed */ }
      // Exact-session provider event for the initiating dApp only. A revoke,
      // reconnect, expiry, or account-grant change before receipt resolution
      // causes the event planner/send-time revalidation to drop it.
      broadcastProviderEvent(
        "message",
        {
          type: "aethelred:tx-updated",
          data: payload,
        },
        {
          exactSessionId: signingAuthority?.sessionId,
          requiredAccount: tx.from,
        },
      );
      broadcastState();
    })
    .catch((err) => {
      console.info("[background] pollReceipt error for", broadcastHash);
      console.error(err);
    });

  auditCapture.record({
    kind: "response-sent",
    subjectId: subject.id,
    workspaceId: workspace.id,
    detail: {
      method: "eth_sendTransaction",
      txHash: broadcastHash,
      velocityCommitError,
    },
  });

  persistState();
  broadcastState();
  return {
    kind: "rpc-response",
    correlationId: message.correlationId,
    payload: { result: broadcastHash },
    timestamp: Date.now(),
  };
}

/**
 * Show the user a prompt for a dApp request and wait for their decision.
 * Uses the existing `pendingApprovals` Map + the popup's approvals UI.
 * Times out after 5 minutes and auto-rejects.
 */
const APPROVAL_TTL_MS = 5 * 60 * 1000;

/**
 * Show the user a typed approval prompt and wait for their decision.
 *
 * This is THE single entry point for gating any dApp-initiated or
 * popup-initiated signing operation. Every path that produces a
 * signature (eth_sendTransaction, personal_sign, eth_signTypedData_v4,
 * wallet_addEthereumChain, wallet_watchAsset, connect) funnels through
 * here so we have one auditable gate with one predictable UX.
 *
 * The `detail` argument is a discriminated union from
 * `@aethelred/wallet-connect` — it carries the kind-specific payload
 * (amount, recipient, gas for a tx; primaryType + domain for a typed
 * data sign; chain config for addEthereumChain; etc.). The approval
 * UI uses `detail.kind` to pick the right renderer.
 *
 * Side effects:
 *   - Creates a pending entry keyed by a random id
 *   - Pushes the entry to `chrome.storage.session` so SW death
 *     doesn't lose it
 *   - Attempts to open the popup via `chrome.action.openPopup()` so
 *     the user sees the prompt even if the popup was closed
 *   - Broadcasts updated state so an already-open popup rerenders
 *
 * Auto-rejects after `APPROVAL_TTL_MS` (5 minutes).
 */
async function requestUserApproval(params: {
  title: string;
  summary: string;
  appName: string;
  origin?: string;
  detail: ApprovalDetail;
}): Promise<"approved" | "rejected"> {
  const appIdentity = resolveAppIdentity(params.origin ?? params.appName);
  const approvalId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = Date.now();
  const expiresAt = createdAt + APPROVAL_TTL_MS;

  const approval: ApprovalSummary = {
    id: approvalId,
    title: params.title,
    summary: params.summary,
    appName: appIdentity.name,
    origin: appIdentity.origin,
    trustLevel: appIdentity.trustLevel,
    requiredAction: "one reviewer",
    status: "pending",
    createdAt,
    expiresAt,
    detail: params.detail,
  };

  // Synthesize an IntentRequest for the legacy Connect path callers —
  // this keeps the shape non-null without leaking raw detail.
  const intentRequest = {
    id: approvalId,
    kind: params.detail.kind === "personal_sign" || params.detail.kind === "eth_signTypedData_v4"
      ? "sign-message"
      : "sign-transaction",
    method: params.detail.kind,
    app: {
      id: appIdentity.id,
      name: appIdentity.name,
      origin: appIdentity.origin,
      trustLevel: appIdentity.trustLevel,
    },
    payload: {},
  } as unknown as IntentRequest;

  return new Promise<"approved" | "rejected">((resolve) => {
    pendingApprovals.set(approvalId, {
      summary: approval,
      intentRequest,
      createdAt,
      expiresAt,
      resolve,
    });

    // Kick off persistence + popup-open in parallel; neither blocks
    // the resolve chain — if they fail, the approval still works.
    persistPendingApprovals().catch(() => {});
    openPopupSafely().catch(() => {});
    broadcastState();

    setTimeout(() => {
      if (pendingApprovals.has(approvalId)) {
        pendingApprovals.delete(approvalId);
        persistPendingApprovals().catch(() => {});
        resolve("rejected");
        broadcastState();
      }
    }, APPROVAL_TTL_MS);
  });
}

/**
 * ─── personal_sign handler (REAL) ─────────────────────────────────
 * `personal_sign` spec: the signer computes keccak256 of
 *   "\x19Ethereum Signed Message:\n" + len + message
 * and signs that digest. The existing `Signer.signMessage` does the
 * prefixing + keccak256 correctly — we just need to (a) NOT auto-sign
 * and (b) not pass wrong bytes to it. The previous version also had
 * an off-by-one where the message hex was flattened to UTF-8 bytes
 * incorrectly when the dApp sent raw hex.
 */
async function handlePersonalSign(
  message: BridgeMessage,
  params: unknown[],
  origin: string,
  signingAuthority: DappSigningAuthoritySnapshot | undefined,
): Promise<BridgeMessage> {
  const [msgHex, from] = params as [string, string];
  const subject = subjectRegistry.getActive();
  const workspace = workspaceRegistry.getActive();
  const appIdentity = resolveAppIdentity(origin);

  const respondError = (code: number, msg: string): BridgeMessage => ({
    kind: "rpc-response",
    correlationId: message.correlationId,
    payload: { error: { code, message: msg } },
    timestamp: Date.now(),
  });

  if (!subject || !workspace) return respondError(4001, "Wallet not configured");

  // Phishing heuristic
  const analysis = messageAnalyzer.analyze(msgHex, origin);

  auditCapture.record({
    kind: "request-received",
    subjectId: subject.id,
    workspaceId: workspace.id,
    detail: { method: "personal_sign", origin, riskLevel: analysis.overallRisk, isPermit: analysis.isPermit },
  });

  // Decode the message — dApps can send either a hex-encoded blob or
  // a plain UTF-8 string. Hex is the EIP-191 canonical form.
  const data = typeof msgHex === "string" && msgHex.startsWith("0x")
    ? hexToBytes(msgHex)
    : new TextEncoder().encode(msgHex);
  const preview = new TextDecoder("utf-8", { fatal: false })
    .decode(data)
    .slice(0, 200);

  // Require explicit user approval — this was the biggest security hole
  // (previously any dApp could sign any message silently). The detail
  // now carries enough data for the UI to render a proper preview
  // instead of a generic "Sign message" card.
  const rawHex = typeof msgHex === "string" && msgHex.startsWith("0x")
    ? msgHex
    : "0x" + Array.from(new TextEncoder().encode(msgHex), (b) => b.toString(16).padStart(2, "0")).join("");
  const approvalDecision = await requestUserApproval({
    title: analysis.isPermit ? "⚠ Sign token permit" : "Sign message",
    summary: `${formatAppRequestLabel(appIdentity)} is asking you to sign a message.`,
    appName: appIdentity.name,
    origin,
    detail: {
      kind: "personal_sign",
      from: (from as string) ?? "",
      preview,
      rawHex,
      isPermit: analysis.isPermit,
      risk: analysis.overallRisk,
    },
  });
  if (approvalDecision === "rejected") {
    return respondError(4001, "User rejected the request");
  }

  const authorityAfterApproval = revalidateDappSigningAuthority(signingAuthority);
  if (!authorityAfterApproval.ok) {
    return respondError(authorityAfterApproval.code, authorityAfterApproval.message);
  }

  const keySlot = keyManager.getKeySlots().find((s) => s.address.toLowerCase() === (from as string).toLowerCase());
  if (!keySlot) return respondError(4001, "Signing key not found");

  const policyToken = { intentId: `sign-${Date.now()}`, outcome: "allow" as const, timestamp: Date.now() };

  let sigResult;
  try {
    const authorityBeforeSigning = revalidateDappSigningAuthority(signingAuthority);
    if (!authorityBeforeSigning.ok) {
      return respondError(authorityBeforeSigning.code, authorityBeforeSigning.message);
    }
    sigResult = await signer.signMessage({ keySlotId: keySlot.id, data, type: "message" }, policyToken);
  } catch (err) {
    return respondError(-32603, `Sign failed: ${err instanceof Error ? err.message : "unknown"}`);
  }
  const authorityAfterSigning = revalidateDappSigningAuthority(signingAuthority);
  if (!authorityAfterSigning.ok) {
    sigResult.signature.fill(0);
    return respondError(authorityAfterSigning.code, authorityAfterSigning.message);
  }
  const sigHex = "0x" + Array.from(sigResult.signature, (b) => b.toString(16).padStart(2, "0")).join("");

  auditCapture.record({
    kind: "signing-executed",
    subjectId: subject.id,
    workspaceId: workspace.id,
    detail: { method: "personal_sign", sigPrefix: sigHex.slice(0, 18), risk: analysis.overallRisk },
  });

  return { kind: "rpc-response", correlationId: message.correlationId, payload: { result: sigHex }, timestamp: Date.now() };
}

/**
 * ─── eth_signTypedData_v4 handler (REAL) ──────────────────────────
 *
 * Previously this encoded the raw JSON string as UTF-8 bytes and
 * passed them to the signer, which then signed garbage. The new flow:
 *
 *   1. Parse the typed-data JSON and compute the EIP-712 digest:
 *        keccak256(0x1901 || domainSeparator || structHash(message))
 *   2. Require explicit user approval (the security hole)
 *   3. Pass the 32-byte digest to `Signer.signTypedData` → custody
 *   4. Return the 65-byte recoverable signature as hex
 *
 * The digest is what `ecrecover` needs to verify the signature against
 * the signer's address — without this, permits/meta-txs are unverifiable.
 */
async function handleSignTypedData(
  message: BridgeMessage,
  params: unknown[],
  origin: string,
  signingAuthority: DappSigningAuthoritySnapshot | undefined,
): Promise<BridgeMessage> {
  // EIP-712 payload may be either a JSON string (MetaMask canonical) or
  // a pre-parsed object (common in wagmi/rainbow). Accept both.
  const [from, typedDataParam] = params as [string, string | Record<string, unknown>];
  const subject = subjectRegistry.getActive();
  const workspace = workspaceRegistry.getActive();
  const appIdentity = resolveAppIdentity(origin);

  const respondError = (code: number, msg: string): BridgeMessage => ({
    kind: "rpc-response",
    correlationId: message.correlationId,
    payload: { error: { code, message: msg } },
    timestamp: Date.now(),
  });

  if (!subject || !workspace) return respondError(4001, "Wallet not configured");

  // Compute the real EIP-712 digest — throws if the payload is malformed
  let digest: Uint8Array;
  let parsedTypedData: { types: Record<string, Array<{ name: string; type: string }>>; primaryType: string; domain: Record<string, unknown>; message: Record<string, unknown> };
  try {
    if (typeof typedDataParam === "string") {
      parsedTypedData = JSON.parse(typedDataParam);
      digest = hashTypedDataV4Json(typedDataParam);
    } else if (typedDataParam && typeof typedDataParam === "object") {
      parsedTypedData = typedDataParam as typeof parsedTypedData;
      // Re-stringify into the JSON hasher to avoid duplicating the logic
      digest = hashTypedDataV4Json(JSON.stringify(typedDataParam));
    } else {
      throw new Error("typedData must be a JSON string or object");
    }
  } catch (err) {
    return respondError(
      -32602,
      `Invalid EIP-712 payload: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }
  const parsedDomain = parsedTypedData.domain;
  const parsedPrimaryType = parsedTypedData.primaryType;
  const parsedMessage = parsedTypedData.message;
  // Preserve the original JSON for audit/analysis (hash heuristic checker
  // expects a string).
  const typedDataJson = typeof typedDataParam === "string"
    ? typedDataParam
    : JSON.stringify(typedDataParam);

  const analysis = messageAnalyzer.analyze(typedDataJson, origin);

  auditCapture.record({
    kind: "request-received",
    subjectId: subject.id,
    workspaceId: workspace.id,
    detail: { method: "eth_signTypedData_v4", origin, isPermit: analysis.isPermit, riskLevel: analysis.overallRisk, primaryType: parsedPrimaryType },
  });

  // Require user approval — permit signatures in particular are
  // extremely dangerous (unlimited token approvals). The detail carries
  // the full message + domain so the approval UI can render it richly
  // with an explicit ⚠ permit warning when applicable.
  const domainForDetail: {
    name?: string;
    version?: string;
    chainId?: string | number;
    verifyingContract?: string;
  } = {};
  if (typeof parsedDomain?.name === "string") domainForDetail.name = parsedDomain.name;
  if (typeof parsedDomain?.version === "string") domainForDetail.version = parsedDomain.version;
  if (parsedDomain?.chainId != null) {
    domainForDetail.chainId = parsedDomain.chainId as string | number;
  }
  if (typeof parsedDomain?.verifyingContract === "string") {
    domainForDetail.verifyingContract = parsedDomain.verifyingContract;
  }
  const approvalDecision = await requestUserApproval({
    title: analysis.isPermit ? "⚠ Signing a token permit" : "Sign typed data",
    summary: `${formatAppRequestLabel(appIdentity)} wants you to sign ${parsedPrimaryType ?? "a typed message"}.`,
    appName: appIdentity.name,
    origin,
    detail: {
      kind: "eth_signTypedData_v4",
      from: from ?? "",
      primaryType: parsedPrimaryType,
      domain: domainForDetail,
      message: parsedMessage,
      isPermit: analysis.isPermit,
      risk: analysis.overallRisk,
    },
  });
  if (approvalDecision === "rejected") {
    return respondError(4001, "User rejected the request");
  }

  const authorityAfterApproval = revalidateDappSigningAuthority(signingAuthority);
  if (!authorityAfterApproval.ok) {
    return respondError(authorityAfterApproval.code, authorityAfterApproval.message);
  }

  const keySlot = keyManager.getKeySlots().find((s) => s.address.toLowerCase() === from.toLowerCase());
  if (!keySlot) return respondError(4001, "Signing key not found");

  const policyToken = { intentId: `typed-${Date.now()}`, outcome: "allow" as const, timestamp: Date.now() };

  let sigResult;
  try {
    // Pass the 32-byte digest — signer.signTypedData forwards it to
    // custody.sign unchanged (custody now enforces a 32-byte length check)
    const authorityBeforeSigning = revalidateDappSigningAuthority(signingAuthority);
    if (!authorityBeforeSigning.ok) {
      return respondError(authorityBeforeSigning.code, authorityBeforeSigning.message);
    }
    sigResult = await signer.signTypedData(
      { keySlotId: keySlot.id, data: digest, type: "typed-data" },
      policyToken,
    );
  } catch (err) {
    return respondError(-32603, `Sign failed: ${err instanceof Error ? err.message : "unknown"}`);
  }

  const authorityAfterSigning = revalidateDappSigningAuthority(signingAuthority);
  if (!authorityAfterSigning.ok) {
    sigResult.signature.fill(0);
    return respondError(authorityAfterSigning.code, authorityAfterSigning.message);
  }

  const sigHex = "0x" + Array.from(sigResult.signature, (b) => b.toString(16).padStart(2, "0")).join("");

  auditCapture.record({
    kind: "signing-executed",
    subjectId: subject.id,
    workspaceId: workspace.id,
    detail: { method: "eth_signTypedData_v4", sigPrefix: sigHex.slice(0, 18), isPermit: analysis.isPermit, primaryType: parsedPrimaryType },
  });

  return { kind: "rpc-response", correlationId: message.correlationId, payload: { result: sigHex }, timestamp: Date.now() };
}

// ─── Intent handler (Aethelred Connect protocol) ──────────────────
async function handleIntentRequest(
  message: BridgeMessage,
  origin: string,
  signingAuthority: DappSigningAuthoritySnapshot | undefined,
): Promise<BridgeMessage> {
  const { params } = message.payload as { method: string; params: unknown[] };
  const intent = params[0] as IntentRequest;
  const intentId = intent.id ?? `intent-${Date.now().toString(36)}`;
  const respondError = (code: number, errorMessage: string): BridgeMessage => ({
    kind: "rpc-response",
    correlationId: message.correlationId,
    payload: { error: { code, message: errorMessage } },
    timestamp: Date.now(),
  });

  const subject = subjectRegistry.getActive();
  const workspace = workspaceRegistry.getActive();
  const activeAccount = getActiveAccount();
  const appIdentity = resolveAppIdentity(origin);
  const account = signingAuthority
    ? keyManager.getAccounts().find(
        (candidate) =>
          candidate.address.toLowerCase() === signingAuthority.accountAddress,
      )
    : activeAccount;

  if (!subject || !workspace || !account) {
    return { kind: "rpc-response", correlationId: message.correlationId, payload: { error: { code: 4001, message: "Wallet not configured" } }, timestamp: Date.now() };
  }

  const authorityAtStart = revalidateDappSigningAuthority(signingAuthority);
  if (!authorityAtStart.ok) {
    return respondError(authorityAtStart.code, authorityAtStart.message);
  }

  const role = workspaceRegistry.getRole(subject.id, workspace.id) ?? "owner";
  const session = signingAuthority
    ? sessionManager.get(signingAuthority.sessionId)
    : sessionManager.getByOrigin(origin);
  // Browser-owned sender metadata is the identity boundary. Never let a
  // native intent promote itself to a first-party app (or change the audit /
  // approval label) with its mutable payload.
  const canonicalIntent: IntentRequest = {
    ...intent,
    method:
      intent.kind === "sign-message" || intent.kind === "sign-transaction"
        ? intent.kind
        : intent.method,
    app: appIdentity,
  };

  auditCapture.record({ kind: "request-received", subjectId: subject.id, workspaceId: workspace.id, appId: appIdentity.id, intentId, detail: { kind: canonicalIntent.kind, method: canonicalIntent.method, origin } });

  if (intent.kind !== "connect" && intent.kind !== "sign-message") {
    const message = intent.kind === "sign-transaction"
      ? "Aethelred Connect `sign-transaction` is unsupported; use `eth_sendTransaction` via window.ethereum"
      : `Unsupported Aethelred intent: ${intent.kind}`;
    return respondError(4200, message);
  }

  const policyBundle = getDefaultPolicyBundle(workspace.kind);
  const policyResult = evaluate(
    buildPolicyContext({ intent: canonicalIntent, subjectId: subject.id, subjectRole: role, workspace, account: { id: account.id, label: account.label, address: account.address, namespace: account.namespace, custody: "local", assurance: "device-key" }, sessionExists: !!session, sessionId: session?.id }),
    policyBundle
  );

  auditCapture.record({ kind: "policy-evaluated", subjectId: subject.id, workspaceId: workspace.id, appId: appIdentity.id, intentId, detail: { outcome: policyResult.outcome, warnings: policyResult.warnings } });

  if (policyResult.outcome === "deny") {
    return { kind: "rpc-response", correlationId: message.correlationId, payload: { result: { intentId, outcome: "deny", summary: policyResult.warnings[0] ?? "Denied by policy.", warnings: policyResult.warnings } satisfies IntentResponse }, timestamp: Date.now() };
  }

  // Connect
  if (intent.kind === "connect") {
    const requiredPermissions = ["accounts", "sign-message"];
    const reusableSession = sessionManager.getByOrigin(origin);
    const canReuse =
      reusableSession != null &&
      requiredPermissions.every((permission) =>
        reusableSession.permissions.includes(permission),
      ) &&
      reusableSession.accountAddresses.some(
        (address) => address.toLowerCase() === account.address.toLowerCase(),
      );

    if (!canReuse) {
      const decision = await requestUserApproval({
        title: "Connect to site",
        summary: `${formatAppRequestLabel(appIdentity)} is requesting account and message-signing access.`,
        appName: appIdentity.name,
        origin: appIdentity.origin,
        detail: {
          kind: "connect",
          permissions: requiredPermissions,
          accountAddresses: [account.address],
        },
      });
      auditCapture.record({
        kind: "approval-decided",
        subjectId: subject.id,
        workspaceId: workspace.id,
        appId: appIdentity.id,
        intentId,
        detail: { decision, kind: "connect", method: canonicalIntent.method },
      });
      if (decision === "rejected") {
        return {
          kind: "rpc-response",
          correlationId: message.correlationId,
          payload: {
            result: {
              intentId,
              outcome: "deny",
              summary: "Connection rejected by the user.",
              warnings: policyResult.warnings,
            } satisfies IntentResponse,
          },
          timestamp: Date.now(),
        };
      }
    }

    const currentSession = sessionManager.getByOrigin(origin);
    const permissions = Array.from(new Set([
      ...(currentSession?.permissions ?? []),
      ...requiredPermissions,
    ]));
    const accountAddresses = Array.from(new Set([
      ...(currentSession?.accountAddresses ?? []),
      account.address,
    ]));
    if (!canReuse) {
      sessionManager.createSession({
        appId: appIdentity.id,
        appName: appIdentity.name,
        origin,
        trustLevel: appIdentity.trustLevel,
        permissions,
        accountAddresses,
      });
    }
    auditCapture.record({ kind: "session-created", subjectId: subject.id, workspaceId: workspace.id, appId: appIdentity.id, intentId, detail: { origin } });
    persistState();
    broadcastState();
    return { kind: "rpc-response", correlationId: message.correlationId, payload: { result: { intentId, outcome: policyResult.outcome === "warn" ? "warn" : "allow", summary: canReuse ? "Application session already active." : "Application session approved.", warnings: policyResult.warnings, result: { accounts: accountAddresses } } satisfies IntentResponse }, timestamp: Date.now() };
  }

  const nativeMessagePayload = (intent.payload ?? {}) as { message?: unknown };
  const nativeMessageValue = typeof nativeMessagePayload === "string"
    ? nativeMessagePayload
    : typeof nativeMessagePayload.message === "string"
      ? nativeMessagePayload.message
      : JSON.stringify(nativeMessagePayload);
  let nativeMessageData: Uint8Array | undefined;
  if (intent.kind === "sign-message") {
    try {
      nativeMessageData = nativeMessageValue.startsWith("0x")
        ? hexToBytes(nativeMessageValue)
        : new TextEncoder().encode(nativeMessageValue);
    } catch (error) {
      return respondError(
        -32602,
        `Invalid message payload: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  // Policy can add warnings or deny, but it can never silently authorize a
  // signature. Every native message signature gets a fresh human approval.
  if (policyResult.outcome === "approval-required" || intent.kind === "sign-message") {
    const rawHex = nativeMessageData
      ? `0x${Array.from(nativeMessageData, (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("")}`
      : undefined;
    const decision = await requestUserApproval({
      title: intent.kind === "sign-message" ? "Sign message" : `${appIdentity.name} requires approval`,
      summary: intent.kind === "sign-message"
        ? `${formatAppRequestLabel(appIdentity)} is asking you to sign a message.`
        : `Review ${intent.kind} from ${appIdentity.origin}.`,
      appName: appIdentity.name,
      origin: appIdentity.origin,
      detail: intent.kind === "sign-message"
        ? {
            kind: "personal_sign",
            from: account.address,
            preview: new TextDecoder("utf-8", { fatal: false })
              .decode(nativeMessageData)
              .slice(0, 200),
            rawHex: rawHex!,
            isPermit: false,
            risk: "medium",
          }
        : {
            kind: "connect",
            permissions: [intent.kind, canonicalIntent.method],
            accountAddresses: [account.address],
          },
    });

    auditCapture.record({
      kind: "approval-decided",
      subjectId: subject.id,
      workspaceId: workspace.id,
      appId: appIdentity.id,
      intentId,
      detail: { decision, kind: intent.kind, method: canonicalIntent.method },
    });
    if (decision === "rejected") {
      return {
        kind: "rpc-response",
        correlationId: message.correlationId,
        payload: {
          result: {
            intentId,
            outcome: "deny",
            summary: "Rejected by reviewer.",
            warnings: [],
          } satisfies IntentResponse,
        },
        timestamp: Date.now(),
      };
    }

    const authorityAfterApproval = revalidateDappSigningAuthority(signingAuthority);
    if (!authorityAfterApproval.ok) {
      return respondError(authorityAfterApproval.code, authorityAfterApproval.message);
    }
  }

  // Sign
  if (intent.kind === "sign-message") {
    const signingPayload = intent.payload as
      | { from?: unknown; account?: unknown; address?: unknown }
      | undefined;
    const requestedAccount = signingPayload?.from ?? signingPayload?.account ?? signingPayload?.address;
    const signingAddress = signingAuthority?.accountAddress ?? (
      typeof requestedAccount === "string" ? requestedAccount : account.address
    );
    const keySlot = keyManager.getKeySlots().find(
      (slot) => slot.address.toLowerCase() === signingAddress.toLowerCase(),
    );
    if (!keySlot) {
      return { kind: "rpc-response", correlationId: message.correlationId, payload: { error: { code: 4001, message: "No signing key" } }, timestamp: Date.now() };
    }

    const policyToken = { intentId, outcome: "allow" as const, timestamp: Date.now() };

    // Sign the reviewed message through the EIP-191 path. Opaque native
    // transaction intents are rejected above instead of signing JSON bytes.
    const authorityBeforeSigning = revalidateDappSigningAuthority(signingAuthority);
    if (!authorityBeforeSigning.ok) {
      return respondError(authorityBeforeSigning.code, authorityBeforeSigning.message);
    }
    const sigResult = await signer.signMessage(
      { keySlotId: keySlot.id, data: nativeMessageData!, type: "message" },
      policyToken,
    );

    const authorityAfterSigning = revalidateDappSigningAuthority(signingAuthority);
    if (!authorityAfterSigning.ok) {
      sigResult.signature.fill(0);
      return respondError(authorityAfterSigning.code, authorityAfterSigning.message);
    }

    const sigHex = "0x" + Array.from(sigResult.signature, (b) => b.toString(16).padStart(2, "0")).join("");
    auditCapture.record({ kind: "signing-executed", subjectId: subject.id, workspaceId: workspace.id, appId: appIdentity.id, intentId, detail: { kind: intent.kind, sigPrefix: sigHex.slice(0, 18) } });
    auditCapture.record({ kind: "response-sent", subjectId: subject.id, workspaceId: workspace.id, appId: appIdentity.id, intentId, detail: { outcome: "allow" } });

    return { kind: "rpc-response", correlationId: message.correlationId, payload: { result: { intentId, outcome: policyResult.outcome === "warn" ? "warn" : "allow", summary: "Message signed.", warnings: policyResult.warnings, result: { signature: sigHex } } satisfies IntentResponse }, timestamp: Date.now() };
  }

  return respondError(4200, `Unsupported Aethelred intent: ${intent.kind}`);
}

// ─── Lifecycle stage registration ─────────────────────────────────
/*
 * Stages are registered in priority order. See
 * ./background/stages/index.ts for the canonical priority map.
 *
 * Each subsystem declares how it survives MV3 SW wake: some stages
 * hydrate on startup (audit chain, pending txs), some persist on
 * suspend (Merkle open batch flush), some do both.
 */
swLifecycle.registerStage(
  buildStoragePersistenceStage({ storage: storageAdapter }),
);
swLifecycle.registerStage(
  buildAuditChainRehydrationStage({
    auditCapture,
    auditStore,
    onStatusChanged: (state) => {
      auditChainRehydrationState = state;
    },
  }),
);
swLifecycle.registerStage(
  buildMerkleBatchRestorationStage({ coordinator: merkleBatchCoordinator }),
);
// The pending-approvals stage was built early (before the declarations
// below) so the persist/rehydrate helpers can be called from RPC
// handlers. Register it here in priority order.
swLifecycle.registerStage(pendingApprovalsStageInstance);
swLifecycle.registerStage(
  buildNonceManagerStage({
    storage: storageAdapter,
    // txManager is reassigned on switchChain — the thunk always
    // reads the current binding. The cast bridges `TxManager` (concrete)
    // to `NonceHost` (empty-shape opaque surface) — the stage reaches
    // into the `nonceCache` private field via `reachIntoCache()`.
    getTxManager: () => txManager as unknown as import("./background/stages").NonceHost,
    getActiveChainId: () => {
      const hex = networkManager.getActiveChainId();
      return parseInt(hex, 16);
    },
  }),
);
swLifecycle.registerStage(
  buildPendingTxTrackerStage({
    tracker: pendingTxTracker,
    getReceiptProbe: () => ({
      async getTransactionReceipt(hash) {
        const result = await rpcClient.call<{
          status: string;
          blockNumber: string;
        } | null>("eth_getTransactionReceipt", [hash]);
        return result ?? null;
      },
    }),
  }),
);
swLifecycle.registerStage(
  buildCredentialStoreStage({
    storage: storageAdapter,
    getStore: () => credentialStore,
    onHydrationState: (state) => {
      credentialStoreHydrationState = state;
    },
  }),
);
if (!import.meta.env.PROD) {
  swLifecycle.registerStage(
    buildWalletConnectSessionStage({
      storage: storageAdapter,
      getManager: () => walletConnectManager,
    }),
  );
}
swLifecycle.registerStage(
  buildVelocityTrackerStage({
    // The live tracker that feeds requestedOperationCount24h /
    // cumulativeValueSpentUsd24h into every send-path policy evaluation;
    // hydrating on boot closes the SW-wake → first-eval blind spot.
    tracker: velocityTracker,
    getActiveSubjectId: () => subjectRegistry.getActive()?.id ?? null,
  }),
);
swLifecycle.registerStage(
  buildWorkflowEngineStage({
    engine: workflowEngine,
    storage: storageAdapter,
  }),
);

// ─── Initialization ───────────────────────────────────────────────
async function restrictExtensionStorageToTrustedContexts(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage) return;
  const restrictions: Promise<void>[] = [];
  if (chrome.storage.local?.setAccessLevel) {
    restrictions.push(
      chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    );
  }
  if (chrome.storage.session?.setAccessLevel) {
    restrictions.push(
      chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    );
  }
  await Promise.all(restrictions);
}

async function init(): Promise<void> {
  // Chrome exposes storage areas to content scripts unless explicitly
  // restricted. Apply this before reading any wallet state so a failed
  // restriction blocks the service worker instead of running insecurely.
  await restrictExtensionStorageToTrustedContexts();

  // StatePersistence is a cross-cutting subsystem that many stages
  // consult — load it FIRST so downstream stages see non-default
  // values during their rehydration path.
  await statePersistence.load();

  // Restore chain selection BEFORE lifecycle boot so the
  // nonce-manager stage hydrates into the correct active chain.
  const persisted = statePersistence.getState();
  try {
    masterKey.setAutoLockMs(persisted.autoLockMs);
  } catch {
    masterKey.setAutoLockMs(5 * 60_000);
    statePersistence.update({ autoLockMs: 5 * 60_000 });
  }
  if (persisted.activeChainId && persisted.activeChainId !== "0x1") {
    try { switchChain(persisted.activeChainId); } catch { /* keep default */ }
  }

  // Boot the lifecycle — runs every stage's onInstalled (if applicable)
  // and onStartup in priority order. Stages handle audit chain
  // rehydration, Merkle batch restoration, pending-approval rehydration,
  // etc., all in one auditable place.
  await swLifecycle.boot();

  // Start price refresh interval
  priceService.refreshPrices().catch(() => {});
  setInterval(() => priceService.refreshPrices().catch(() => {}), 60_000);

  backgroundLogger.info(
    "background.initialized",
    "Aethelred Wallet background initialized.",
    { rpcUrl: rpcClient.getActiveUrl() },
  );
}

function ensureInitialized(): Promise<void> {
  if (!initializationPromise) initializationPromise = init();
  return initializationPromise;
}

// ─── MV3 lifecycle listeners ──────────────────────────────────────
// Wire the Chrome runtime events into SwLifecycle. `onInstalled` fires
// once per install / update / reload; `onStartup` fires on browser
// restart; `onSuspend` fires ~5s before Chrome evicts the SW.
try {
  chrome.runtime?.onInstalled?.addListener((details) => {
    swLifecycle.recordInstallTrigger({
      reason: details.reason as "install" | "update" | "chrome_update" | "shared_module_update",
      previousVersion: details.previousVersion,
    });
    ensureInitialized().catch((err) => {
      backgroundLogger.error(
        "background.onInstalled.failed",
        "Lifecycle boot from onInstalled threw.",
        { error: err instanceof Error ? err.message : String(err) },
      );
    });
  });
  chrome.runtime?.onStartup?.addListener(() => {
    ensureInitialized().catch((err) => {
      backgroundLogger.error(
        "background.onStartup.failed",
        "Lifecycle boot from onStartup threw.",
        { error: err instanceof Error ? err.message : String(err) },
      );
    });
  });
  chrome.runtime?.onSuspend?.addListener(() => {
    swLifecycle.shutdown().catch((err) => {
      backgroundLogger.error(
        "background.onSuspend.failed",
        "Lifecycle shutdown from onSuspend threw.",
        { error: err instanceof Error ? err.message : String(err) },
      );
    });
    // Belt-and-suspenders — force-persist the WalletConnect session
    // snapshot directly so even if the stage throws we have a fallback
    // write. The helper is idempotent.
    if (!import.meta.env.PROD) {
      persistWalletConnectSessions(storageAdapter, walletConnectManager).catch(
        () => {},
      );
    }
  });
} catch {
  // Non-Chrome environment (vitest, node) — listeners are optional.
  // `boot()` will still be called by init() below.
}

// Start one shared cold-start barrier. Every incoming message awaits this
// same promise, including state persistence and credential rehydration.
void ensureInitialized().catch((error) => {
  backgroundLogger.error(
    "background.initialization.failed",
    "Wallet background initialization failed; requests will remain blocked.",
    { error: error instanceof Error ? error.message : String(error) },
  );
});
