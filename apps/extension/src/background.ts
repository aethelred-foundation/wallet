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
  // Real EIP-712 typed-data hasher
  hashTypedDataV4Json,
} from "@aethelred/wallet-core";
import {
  SubjectRegistry,
  WorkspaceRegistry,
  CredentialStore,
  toSubjectSummary,
  toWorkspaceSummary,
  type Subject,
  type Workspace,
  type RoleAssignment,
} from "@aethelred/wallet-identity";
import { evaluate, getDefaultPolicyBundle, buildPolicyContext } from "@aethelred/wallet-policy";
import { AuditCapture, AuditStore, type AuditEventKind } from "@aethelred/wallet-audit";
import { assertNever, InMemoryMeter } from "@aethelred/wallet-observability";
import { buildAuditMetricsRecorder } from "./lib/audit-metrics-bridge";
import {
  RpcClient,
  BalanceFetcher,
  GasOracle,
  TxManager,
  PriceService,
  TokenListService,
  StatePersistence,
  PendingTxTracker,
  PendingTxTrackerError,
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
import { TokenAllowanceResolver, type TokenAllowance } from "./background/token-allowance-resolver";
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
  persistWalletConnectSessions,
} from "./background/stages";
import {
  CredentialManager,
  CredentialError,
  type VerifiableCredential,
  type PresentationRequest,
} from "@aethelred/wallet-credentials";
import {
  WorkflowEngine,
  getApprovalTemplate,
  type ApprovalContext,
} from "@aethelred/wallet-approval";
import { DeploymentManager } from "@aethelred/wallet-deployment";
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

// ─── Storage ──────────────────────────────────────────────────────
const storageAdapter = typeof chrome !== "undefined" && chrome.storage?.local
  ? {
      get: (key: string) => new Promise<string | null>((resolve) => {
        chrome.storage.local.get(key, (result) => resolve((result[key] as string) ?? null));
      }),
      set: (key: string, value: string) => new Promise<void>((resolve) => {
        chrome.storage.local.set({ [key]: value }, resolve);
      }),
      delete: (key: string) => new Promise<void>((resolve) => {
        chrome.storage.local.remove(key, resolve);
      }),
    }
  : new MemoryStorageAdapter();

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

// ─── Observability — metrics meter (PR #110) ─────────────────────
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
 * Service-worker eviction resets the meter — counters accumulate
 * since last instantiation. Future PR adds an OTLP exporter that
 * polls + pushes before eviction risk; until then, debug visibility
 * comes from `auditMeter.toPrometheus()` invoked manually via the
 * popup or test harness.
 */
const auditMeter = new InMemoryMeter();
const auditMetrics = buildAuditMetricsRecorder({
  meter: auditMeter,
  defaultLabels: { service: "wallet-extension-background" },
});

// ─── Audit ────────────────────────────────────────────────────────
const auditCapture = new AuditCapture();
const auditStore = new AuditStore(
  storageAdapter,
  undefined, // maxEvents — package default
  null, // encryptedStorage — wired via rotateKey() after master key unlocks
  auditMetrics, // PR #110 — wires storage failure metrics to the meter
);
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
let balanceFetcher = new BalanceFetcher(rpcClient);
let gasOracle = new GasOracle(rpcClient);
let txManager = new TxManager(rpcClient);
const priceService = new PriceService();
const tokenListService = new TokenListService();

/* ─── Pending transaction tracker (gas-bump / speed-up / cancel) ───
 * Durable ledger of broadcast-but-not-yet-confirmed txs, including
 * the `original → replacement` lineage the popup's Activity view
 * needs to render Speed-up / Cancel buttons. Persists independently
 * of `txManager` (which is per-chain and reset on switchChain). */
const pendingTxTracker = new PendingTxTracker(storageAdapter);

/* ─── Verifiable credentials (regulatory passport) ────────────
 * The CredentialManager holds the user's received credentials
 * (KYC, jurisdiction, accredited-investor tier, VASP licence) and
 * builds selective-disclosure presentations on demand. The default
 * in-memory store is upgraded to a keyring-backed store by passing
 * a custom `store` in production. */
const credentialManager = new CredentialManager();

/* ─── Token allowance resolver ─────────────────────────────────
 * Typed surface for on-chain ERC-20 allowance discovery. Today a
 * stub that returns []; production plugs in a live log-scan
 * resolver without changing the bridge handler. */
let tokenAllowanceResolver = new TokenAllowanceResolver(rpcClient);

/* ─── WalletConnect v2 session manager ─────────────────────────
 * Lazily initialized the first time a popup issues a `wc-pair` or
 * `wc-sessions` call — keeps the scaffold out of the hot path for
 * users who never use WalletConnect. The init is idempotent so
 * repeated calls are cheap. The SDK wiring itself is deferred
 * (the stub returns empty session lists and logs operations). */
let walletConnectManager: WalletConnectManager | null = null;
function getWalletConnectManager(): WalletConnectManager {
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
        id: "walletconnect",
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
const deploymentManager = new DeploymentManager("shared-cloud");

// ─── State Persistence ────────────────────────────────────────────
const statePersistence = new StatePersistence(storageAdapter);

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
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  chainId: string;
  createdAt: number;
  keySlotId: string;
  origin: string;
}
const draftTxs = new Map<string, DraftTx>();
const DRAFT_TX_TTL_MS = 10 * 60 * 1000;

// Prune expired drafts on a timer to avoid memory accumulation
setInterval(() => {
  const now = Date.now();
  for (const [id, draft] of draftTxs) {
    if (now - draft.createdAt > DRAFT_TX_TTL_MS) {
      draftTxs.delete(id);
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
const txHistoryByChain = new Map<string, Array<import("@aethelred/wallet-chain").PendingTransaction>>();

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
    txManager.trackTransaction({
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
  }
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
  balanceFetcher = new BalanceFetcher(rpcClient);
  gasOracle = new GasOracle(rpcClient);
  txManager = new TxManager(rpcClient);
  // The allowance resolver is rpcClient-scoped — swap in the new
  // client so subsequent `get-token-allowances` calls hit the right
  // chain.
  tokenAllowanceResolver = new TokenAllowanceResolver(rpcClient);

  // Restore any previously-tracked txs for the new chain
  restoreChainTxHistory(chainId);
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

  // Aggregate tx history across all chains we've seen. The current
  // chain's pending list comes from `txManager.getAll()`; historical
  // chains come from `txHistoryByChain`. Dedupe on hash so a restored
  // current-chain entry doesn't appear twice.
  const currentChainId = networkManager.getActiveChainId();
  const allTxs = new Map<string, import("@aethelred/wallet-chain").PendingTransaction>();
  try {
    for (const t of txManager.getAll()) allTxs.set(t.hash, t);
  } catch { /* empty */ }
  for (const [, list] of txHistoryByChain) {
    for (const t of list) {
      if (!allTxs.has(t.hash)) allTxs.set(t.hash, t);
    }
  }
  const txHistory = Array.from(allTxs.values())
    .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0))
    .slice(0, 100)
    .map((t) => ({
      hash: t.hash,
      from: t.from,
      to: t.to,
      value: t.value,
      nonce: t.nonce,
      status: t.status,
      chainId: t.chainId,
      submittedAt: t.submittedAt,
      confirmedAt: t.confirmedAt,
    }));
  void currentChainId; // retained for future chain-scoped filtering

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
    catalog: [
      { id: "cruzible", name: "Cruzible", category: "treasury", trustLevel: "first-party", readiness: "live", integrationMode: "evm", summary: "Liquid staking vault with TEE-verified validators." },
      { id: "zeroid", name: "ZeroID", category: "identity", trustLevel: "first-party", readiness: "planned", integrationMode: "evm", summary: "Self-sovereign identity with recovery and delegation." },
      { id: "terraqura", name: "TerraQura", category: "carbon", trustLevel: "first-party", readiness: "design", integrationMode: "evm", summary: "M-of-N multisig for carbon credit governance." },
      { id: "shiora", name: "Shiora", category: "health", trustLevel: "first-party", readiness: "design", integrationMode: "compatibility", summary: "Privacy-preserving health data with consent management." },
      { id: "noblepay", name: "NoblePay", category: "payments", trustLevel: "first-party", readiness: "design", integrationMode: "evm", summary: "Compliance-gated cross-border payments." },
    ],
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

/**
 * Broadcast an EIP-1193 provider event to every tab that has an
 * injected inpage provider listening. The content-bridge forwards
 * the message to the page where `inpage.ts` re-emits it via its
 * own `on(event, ...)` listener registry.
 *
 * Events we dispatch:
 *   - "accountsChanged" (string[])  — new active accounts
 *   - "chainChanged"    (string)    — new chain id (hex)
 *   - "connect"         ({chainId}) — wallet just unlocked
 *   - "disconnect"      ({code,message}) — wallet locked / session revoked
 */
function broadcastProviderEvent(event: string, payload: unknown): void {
  try {
    chrome.tabs.query({}, (tabs: chrome.tabs.Tab[]) => {
      for (const tab of tabs) {
        if (tab.id == null) continue;
        chrome.tabs.sendMessage(tab.id, {
          kind: "provider-event",
          correlationId: "",
          payload: { event, data: payload },
          timestamp: Date.now(),
        }).catch(() => {
          // Tabs without content scripts silently fail — expected
        });
      }
    });
  } catch {
    // chrome.tabs may be unavailable in tests
  }
}

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

  switch (message.kind) {
    case "get-state":
    case "popup-ready":
      return respond({
        result: buildWalletState(),
        lockState: { locked: masterKey.isLocked(), initialized: await masterKey.isInitialized() },
      });

    case "init-wallet": {
      const { password, label } = message.payload as { password: string; label?: string };
      await masterKey.initialize(password);
      const { mnemonic, account } = await keyManager.createWallet(label);

      const subjectId = `subject-${account.id}`;
      subjectRegistry.create({ id: subjectId, displayName: "Wallet Owner", kind: "person", workspaceIds: [], credentialIds: [], createdAt: Date.now() });
      const workspace = workspaceRegistry.createWorkspace("AETHELRED", "personal", "Default personal workspace.", subjectId);
      workspaceRegistry.addAccountToWorkspace(workspace.id, account.id);

      auditCapture.record({ kind: "wallet-initialized", subjectId, workspaceId: workspace.id, detail: { address: account.address } });
      persistState();
      broadcastState();
      return respond({ result: { mnemonic, address: account.address } });
    }

    case "import-wallet": {
      const { password, mnemonic, label } = message.payload as { password: string; mnemonic: string[]; label?: string };
      await masterKey.initialize(password);
      const { account } = await keyManager.importFromMnemonic(mnemonic, label);

      const subjectId = `subject-${account.id}`;
      subjectRegistry.create({ id: subjectId, displayName: "Wallet Owner", kind: "person", workspaceIds: [], credentialIds: [], createdAt: Date.now() });
      const ws = workspaceRegistry.createWorkspace("AETHELRED", "personal", "Default personal workspace.", subjectId);
      workspaceRegistry.addAccountToWorkspace(ws.id, account.id);

      auditCapture.record({ kind: "wallet-initialized", subjectId, workspaceId: ws.id, detail: { address: account.address, imported: true } });
      persistState();
      broadcastState();
      return respond({ result: { address: account.address } });
    }

    case "unlock-request": {
      const { password } = message.payload as { password: string };
      await masterKey.unlock(password);
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
        if (persisted.activeChainId) switchChain(persisted.activeChainId);
      }
      auditCapture.record({ kind: "lock-state-changed", subjectId: subjectRegistry.getActive()?.id ?? "unknown", workspaceId: workspaceRegistry.getActive()?.id ?? "unknown", detail: { locked: false } });
      broadcastState();
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
      persistState();
      auditCapture.record({ kind: "lock-state-changed", subjectId: subjectRegistry.getActive()?.id ?? "unknown", workspaceId: workspaceRegistry.getActive()?.id ?? "unknown", detail: { locked: true } });
      broadcastState();
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
      // Approval not found — could be expired, already resolved, or
      // rehydrated across SW death. Not an error per se.
      return respond({ result: { ok: false, reason: "approval-not-found" } });
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
      broadcastProviderEvent("accountsChanged", [account.address, ...keyManager.getAccounts().filter((a) => a.id !== accountId).map((a) => a.address)]);
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
        // Release the nonce reservation so the next prepare-tx gets it back
        try {
          (txManager as unknown as { releaseNonce?: (addr: string, nonce: number) => void })
            .releaseNonce?.(draft.from, draft.nonce);
        } catch { /* optional — may not exist on older TxManager */ }
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
          return { ...b, priceUsd: price?.priceUsd ?? 0, change24h: price?.change24h ?? 0, value: parseFloat(b.balance) * (price?.priceUsd ?? 0) };
        });
        return respond({ result: enriched });
      } catch (error) {
        return respond({ result: [], error: error instanceof Error ? error.message : "Failed to fetch balances" });
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
        // EIP-1193: dApps need to know the new account exists
        broadcastProviderEvent(
          "accountsChanged",
          keyManager.getAccounts().map((a) => a.address),
        );
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

    case "get-tx-history": {
      const txs = txManager.getAll();
      return respond({ result: txs });
    }

    case "rename-account": {
      const { id, label } = message.payload as { id: string; label: string };
      await keyManager.renameAccount(id, label);
      persistState();
      broadcastState();
      return respond({ result: { ok: true } });
    }

    case "get-audit-events": {
      const query = message.payload as { kind?: string; limit?: number } | undefined;
      const events = auditStore.query({ kind: query?.kind as AuditEventKind | undefined, limit: query?.limit ?? 50 });
      return respond({ result: events });
    }

    /* ─── WebAuthn passkey 2FA ────────────────────────────────
     * Three message handlers back the optional passkey second
     * factor on unlock. The popup performs the actual WebAuthn
     * navigator.credentials.create() / get() calls (SW cannot
     * access navigator.credentials) and sends us the result.
     * Background persists the credentials via `credentialStore`
     * and verifies ECDSA P-256 signatures on assertion.
     *
     * Until a passkey is enrolled, the unlock flow is
     * password-only — the 2FA step is strictly additive so
     * existing wallets keep working after an upgrade. */

    case "passkey-enroll": {
      const subject = subjectRegistry.getActive();
      if (!subject) return respond({ error: { code: 4001, message: "No active subject" } });
      const body = message.payload as {
        credentialId?: string;
        publicKeySpki?: string;
        rpId?: string;
        label?: string;
        transports?: string[];
      };
      if (!body?.credentialId || !body.publicKeySpki || !body.rpId) {
        return respond({ error: { code: -32602, message: "credentialId, publicKeySpki, and rpId are required" } });
      }
      const cred = credentialStore.enrollPasskey({
        subjectId: subject.id,
        credentialId: body.credentialId,
        publicKeySpki: body.publicKeySpki,
        rpId: body.rpId,
        label: body.label ?? "Passkey",
        transports: body.transports,
      });
      auditCapture.record({
        kind: "credential-enrolled",
        subjectId: subject.id,
        workspaceId: workspaceRegistry.getActive()?.id ?? "",
        detail: { type: "passkey", credentialId: body.credentialId, label: cred.metadata.label },
      });
      persistState();
      return respond({ result: { ok: true, id: cred.id, label: cred.metadata.label } });
    }

    case "passkey-verify": {
      const subject = subjectRegistry.getActive();
      if (!subject) return respond({ error: { code: 4001, message: "No active subject" } });
      const body = message.payload as {
        credentialId?: string;
        authenticatorData?: string; // base64url
        clientDataJSON?: string;    // base64url
        signature?: string;         // base64url
      };
      if (!body?.credentialId || !body.authenticatorData || !body.clientDataJSON || !body.signature) {
        return respond({ error: { code: -32602, message: "credentialId, authenticatorData, clientDataJSON, and signature are required" } });
      }
      const cred = credentialStore.findPasskeyByCredentialId(body.credentialId);
      if (!cred) return respond({ error: { code: 4001, message: "Passkey not found" } });
      try {
        const result = await verifyWebAuthnAssertion({
          publicKeySpki: cred.metadata.publicKeySpki,
          authenticatorData: body.authenticatorData,
          clientDataJSON: body.clientDataJSON,
          signature: body.signature,
          expectedRpId: cred.metadata.rpId,
        });
        credentialStore.bumpPasskeySignCounter(body.credentialId, result.signCount);
        auditCapture.record({
          kind: "credential-verified",
          subjectId: subject.id,
          workspaceId: workspaceRegistry.getActive()?.id ?? "",
          detail: { type: "passkey", credentialId: body.credentialId, signCount: result.signCount },
        });
        persistState();
        return respond({ result: { ok: true } });
      } catch (err) {
        auditCapture.record({
          kind: "credential-verification-failed",
          subjectId: subject.id,
          workspaceId: workspaceRegistry.getActive()?.id ?? "",
          detail: { type: "passkey", credentialId: body.credentialId, error: err instanceof Error ? err.message : String(err) },
        });
        return respond({ error: { code: 4001, message: err instanceof Error ? err.message : "Passkey verification failed" } });
      }
    }

    case "passkey-remove": {
      const subject = subjectRegistry.getActive();
      if (!subject) return respond({ error: { code: 4001, message: "No active subject" } });
      const body = message.payload as { credentialId?: string };
      if (!body?.credentialId) {
        return respond({ error: { code: -32602, message: "credentialId is required" } });
      }
      const removed = credentialStore.removePasskey(body.credentialId);
      if (removed) {
        auditCapture.record({
          kind: "credential-revoked",
          subjectId: subject.id,
          workspaceId: workspaceRegistry.getActive()?.id ?? "",
          detail: { type: "passkey", credentialId: body.credentialId },
        });
        persistState();
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
      const cred = credentialStore.findPasskeyByCredentialId(body.credentialId);
      if (!cred) return respond({ error: { code: 4001, message: "Passkey not found" } });
      // Re-enrolling with the same credentialId is idempotent and
      // merely rewrites the label — keeps stored signCounter / spki
      // untouched. This is the designed escape hatch for a rename.
      credentialStore.enrollPasskey({
        subjectId: subject.id,
        credentialId: cred.metadata.credentialId,
        publicKeySpki: cred.metadata.publicKeySpki,
        rpId: cred.metadata.rpId,
        label: body.label.slice(0, 60) || "Passkey",
        transports: cred.metadata.transports,
      });
      auditCapture.record({
        kind: "credential-enrolled",
        subjectId: subject.id,
        workspaceId: workspaceRegistry.getActive()?.id ?? "",
        detail: { type: "passkey", credentialId: body.credentialId, renamed: true, label: body.label },
      });
      persistState();
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
        return respond({ result: list });
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
     * Handler is live but returns [] until the log-scan resolver
     * lands — see TokenAllowanceResolver for the plug-in point. */
    case "get-token-allowances": {
      const body = (message.payload ?? {}) as { address?: string; chainId?: number };
      const address = body.address ?? getActiveAccount()?.address;
      if (!address) {
        return respond({ result: [] });
      }
      const chainId = body.chainId ?? parseInt(networkManager.getActiveChainId(), 16);
      try {
        const allowances = await tokenAllowanceResolver.resolveAllowances(address, chainId);
        return respond({ result: allowances });
      } catch (err) {
        // Don't surface this as an error — the popup treats `[]` as
        // "empty state" which is the right UX until live data lands.
        console.warn("[background] get-token-allowances failed", err);
        return respond({ result: [] as TokenAllowance[] });
      }
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
     * Delegates to the CredentialManager. The manager holds the
     * in-memory store today; production wires the keyring-backed
     * store via the CredentialStore interface without changing
     * these handler shapes. */
    case "credentials-list": {
      try {
        const body = (message.payload ?? {}) as {
          schemaId?: string;
          issuerId?: string;
          unexpiredOnly?: boolean;
          includeRevoked?: boolean;
        };
        const list = await credentialManager.listCredentials({
          schemaId: body.schemaId as VerifiableCredential["attestation"]["schemaId"] | undefined,
          issuerId: body.issuerId,
          unexpiredOnly: body.unexpiredOnly ?? true,
          includeRevoked: body.includeRevoked ?? false,
        });
        return respond({ result: list });
      } catch (err) {
        return respond({
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : "Failed to list credentials",
          },
        });
      }
    }
    case "credentials-revoke": {
      const body = message.payload as {
        uid?: `0x${string}`;
        reason?: string;
        actor?: string;
      };
      if (!body?.uid || !body.reason || !body.actor) {
        return respond({
          error: { code: -32602, message: "uid, reason, and actor are required" },
        });
      }
      try {
        await credentialManager.revokeCredential(body.uid, body.reason, body.actor);
        auditCapture.record({
          kind: "credential-revoked",
          subjectId: subjectRegistry.getActive()?.id ?? "unknown",
          workspaceId: workspaceRegistry.getActive()?.id ?? "unknown",
          detail: { uid: body.uid, reason: body.reason, actor: body.actor },
        });
        return respond({ result: { ok: true, uid: body.uid } });
      } catch (err) {
        if (err instanceof CredentialError) {
          return respond({ error: { code: -32602, message: err.message } });
        }
        return respond({
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : "Credential revoke failed",
          },
        });
      }
    }
    case "credential-presentation-prepare": {
      const body = message.payload as {
        request?: PresentationRequest;
        matchingUids?: `0x${string}`[];
        signerPrivateKeyHex?: `0x${string}`;
      };
      if (
        !body?.request ||
        !Array.isArray(body.matchingUids) ||
        !body.signerPrivateKeyHex
      ) {
        return respond({
          error: {
            code: -32602,
            message:
              "request, matchingUids, and signerPrivateKeyHex are required",
          },
        });
      }
      try {
        const presentation = await credentialManager.buildPresentation(
          body.request,
          body.matchingUids,
          body.signerPrivateKeyHex,
        );
        return respond({ result: presentation });
      } catch (err) {
        return respond({
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : "Presentation build failed",
          },
        });
      }
    }

    /* ─── Tenant lifecycle (deployment migration) ──────────────
     * Enterprise deployments let a tenant migrate between cloud /
     * dedicated / sovereign / air-gapped tiers with continuity
     * proofs. The @aethelred/wallet-deployment package surface
     * currently exports DeploymentManager only — the migration
     * planner + continuity verifier aren't wired yet. Same
     * graceful-fail pattern as credentials. */
    case "tenant-list": {
      /**
       * @todo GH-ISSUE(deployment-migration): return the full tenant
       *   roster via @aethelred/wallet-deployment exports.
       */
      return respond({ result: [] });
    }
    case "tenant-plan-migration": {
      /**
       * @todo GH-ISSUE(deployment-migration): build a
       *   TenantMigrationPlan object via @aethelred/wallet-deployment
       *   once it exports the planner API.
       */
      return respond({ result: null });
    }
    case "tenant-execute-migration": {
      return respond({
        result: { ok: false, reason: "deployment-migration-not-yet-wired" },
      });
    }
    case "tenant-verify-continuity": {
      return respond({
        result: { ok: false, reason: "deployment-migration-not-yet-wired" },
      });
    }

    case "rpc-request":
      return handleRpcRequest(message, sender);

    // ── Outbound-only kinds (never dispatched as requests) ─────────
    // These kinds flow background → popup / inpage / subscribers. If
    // one ever lands on the request dispatcher it is almost certainly
    // a bug in the caller — respond with the JSON-RPC "method not
    // found" envelope the inpage bridge expects, same as before.
    case "rpc-response":
    case "state-update":
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

  // Ask the gas oracle for the current network base fee so the
  // replacement is guaranteed includeable — the core helpers do the
  // 11% mempool-rule math on top of that floor.
  let networkBaseFeePerGas: bigint | undefined;
  try {
    const estimate = await gasOracle.getFullEstimate({
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
  const chainIdHex = networkManager.getActiveChainId();
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

  draftTxs.set(draftId, {
    id: draftId,
    from: tracked.fromAddress,
    to: replacement.to,
    value: replacement.value,
    data: dataBytes,
    nonce: replacement.nonce,
    gasLimit: replacement.gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    chainId: chainIdHex,
    createdAt: Date.now(),
    keySlotId: keySlot.id,
    origin: "popup",
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

/* ─── WebAuthn assertion verification ──────────────────────────
 *
 * Given the stored SPKI public key and the raw assertion fields,
 * verify that:
 *   1. The clientDataJSON type is "webauthn.get" (not create).
 *   2. The rpIdHash in authenticatorData matches SHA-256(rpId).
 *   3. The user-present flag (bit 0) is set in authenticatorData.
 *   4. The ECDSA-P256-SHA256 signature over
 *      `authenticatorData || SHA-256(clientDataJSON)` verifies
 *      against the stored public key.
 *
 * Returns the signCount decoded from authenticatorData on success,
 * throws otherwise. This is the spec-defined verification per
 * WebAuthn §7.2 "Verifying an authentication assertion".
 *
 * Inputs are base64url strings as delivered by the popup.
 */
async function verifyWebAuthnAssertion(opts: {
  publicKeySpki: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  expectedRpId: string;
}): Promise<{ signCount: number }> {
  const authData = base64UrlToBytes(opts.authenticatorData);
  const clientData = base64UrlToBytes(opts.clientDataJSON);
  const signature = base64UrlToBytes(opts.signature);
  const spki = base64UrlToBytes(opts.publicKeySpki);

  if (authData.length < 37) {
    throw new Error("authenticatorData too short (need at least 37 bytes)");
  }

  // rpIdHash = first 32 bytes
  const rpIdHash = authData.subarray(0, 32);
  const flags = authData[32];
  const signCount =
    (authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36];

  // Verify rpId match
  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      bytesToArrayBuffer(new TextEncoder().encode(opts.expectedRpId)),
    ),
  );
  if (!arraysEqual(rpIdHash, expectedRpIdHash)) {
    throw new Error("RP ID hash mismatch — assertion for a different origin");
  }

  // Flags: 0x01 = User Present (UP), 0x04 = User Verified (UV)
  if ((flags & 0x01) === 0) {
    throw new Error("User presence flag not set");
  }

  // Verify clientDataJSON type
  const clientDataText = new TextDecoder().decode(clientData);
  let clientDataObj: { type?: string };
  try {
    clientDataObj = JSON.parse(clientDataText);
  } catch {
    throw new Error("clientDataJSON is not valid JSON");
  }
  if (clientDataObj.type !== "webauthn.get") {
    throw new Error(`Unexpected clientDataJSON.type: ${clientDataObj.type}`);
  }

  // Signed data = authenticatorData || SHA-256(clientDataJSON)
  //
  // Cast to ArrayBuffer so the Web Crypto type overloads pick the
  // `BufferSource`-ArrayBuffer path. TS 5.x distinguishes between
  // ArrayBuffer / SharedArrayBuffer / ArrayBufferView, and the Uint8Array
  // we construct from base64url doesn't always narrow correctly.
  const clientDataHashBuf = await crypto.subtle.digest(
    "SHA-256",
    bytesToArrayBuffer(clientData),
  );
  const clientDataHash = new Uint8Array(clientDataHashBuf);
  const signedData = new Uint8Array(authData.length + clientDataHash.length);
  signedData.set(authData, 0);
  signedData.set(clientDataHash, authData.length);

  // Import the P-256 public key and verify
  const spkiBuffer = bytesToArrayBuffer(spki);
  const publicKey = await crypto.subtle.importKey(
    "spki",
    spkiBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );

  // WebAuthn signatures are DER-encoded; Web Crypto wants raw r||s.
  const rawSignature = derEcdsaToRaw(signature);

  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    publicKey,
    bytesToArrayBuffer(rawSignature),
    bytesToArrayBuffer(signedData),
  );
  if (!valid) {
    throw new Error("ECDSA signature verification failed");
  }

  return { signCount };
}

/** Decode a base64url string (no padding) into a Uint8Array. */
function base64UrlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Copy a Uint8Array's bytes into a fresh `ArrayBuffer` so the Web Crypto
 * type system resolves the correct `BufferSource` overload. The Uint8Array
 * may be backed by a SharedArrayBuffer or a view of a larger buffer; this
 * helper normalises both cases to a plain standalone ArrayBuffer.
 */
function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Convert a DER-encoded ECDSA signature (as produced by WebAuthn
 * authenticators) into the raw r||s form that Web Crypto's
 * `ECDSA.verify` expects. The DER structure is
 * `SEQUENCE { INTEGER r, INTEGER s }`; each integer may be prefixed
 * with a 0x00 byte if its high bit is set (two's complement). The
 * raw form is r and s each left-padded to 32 bytes.
 */
function derEcdsaToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("Invalid DER signature (expected SEQUENCE)");
  let offset = 2; // skip SEQUENCE tag + length
  if (der[1] & 0x80) {
    offset = 2 + (der[1] & 0x7f);
  }
  if (der[offset] !== 0x02) throw new Error("Invalid DER signature (expected INTEGER for r)");
  const rLen = der[offset + 1];
  let r = der.subarray(offset + 2, offset + 2 + rLen);
  offset += 2 + rLen;
  if (der[offset] !== 0x02) throw new Error("Invalid DER signature (expected INTEGER for s)");
  const sLen = der[offset + 1];
  let s = der.subarray(offset + 2, offset + 2 + sLen);
  // Trim leading zero padding
  while (r.length > 32 && r[0] === 0) r = r.subarray(1);
  while (s.length > 32 && s[0] === 0) s = s.subarray(1);
  if (r.length > 32 || s.length > 32) throw new Error("DER signature integer larger than 32 bytes");
  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
}

// ─── RPC Request Handler (proxies real chain calls) ───────────────
async function handleRpcRequest(
  message: BridgeMessage,
  sender: chrome.runtime.MessageSender
): Promise<BridgeMessage> {
  const { method, params } = message.payload as { method: string; params?: unknown[] | object };
  const origin = message.origin ?? sender.tab?.url ?? "unknown";
  const rpcParams = Array.isArray(params) ? params : [];

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

  masterKey.touchActivity();

  // ── Wallet-specific methods ──
  if (method === "eth_requestAccounts" || method === "eth_accounts") {
    const addresses = keyManager.getAccounts().map((a) => a.address);
    if (addresses.length === 0 && method === "eth_requestAccounts") {
      return respondError(4001, "Wallet not initialized");
    }
    return respond(addresses);
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
    // Consult the deployment tier — certain features (hardware wallet,
    // multi-sig via workflowEngine, compliance gates) are only enabled
    // for specific tiers. `deploymentManager.isFeatureEnabled(feature)`
    // returns a boolean per feature flag.
    const tierCapabilities: Record<string, boolean> = {};
    try {
      const probe = deploymentManager as unknown as { isFeatureEnabled?: (f: string) => boolean };
      if (probe.isFeatureEnabled) {
        tierCapabilities.hardwareWallet = probe.isFeatureEnabled("hardware-wallet");
        tierCapabilities.multiReviewer = probe.isFeatureEnabled("multi-reviewer");
        tierCapabilities.compliance = probe.isFeatureEnabled("compliance");
      }
    } catch {
      // Fall through to default capability set
    }
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
        "eth_signTransaction",
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
      tier: tierCapabilities,
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
    // Create or update the session with the granted caps
    const existing = sessionManager.getByOrigin(origin);
    const account = getActiveAccount();
    if (!existing && account) {
      sessionManager.createSession({
        appId: appIdentity.id,
        appName: appIdentity.name,
        origin,
        trustLevel: appIdentity.trustLevel,
        permissions: requestedCaps,
        accountAddresses: [account.address],
      });
    }
    persistState();
    broadcastState();
    return respond(
      requestedCaps.map((cap) => ({ parentCapability: cap, invoker: origin, caveats: [] })),
    );
  }

  /* ─── EIP-2255 wallet_revokePermissions ────────────
   * dApp disconnects itself. We remove the session and
   * broadcast accountsChanged([]) so the dApp's UI clears. */
  if (method === "wallet_revokePermissions") {
    const existing = sessionManager.getByOrigin(origin);
    if (existing) {
      sessionManager.revoke(existing.id);
      persistState();
      broadcastState();
      broadcastProviderEvent("accountsChanged", []);
    }
    return respond(null);
  }

  if (method === "aethelred_getState") {
    return respond(buildWalletState());
  }

  if (method === "aethelred_requestIntent") {
    return handleIntentRequest(message, origin);
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

  // ── Transaction sending ──
  if (method === "eth_sendTransaction") {
    return handleSendTransaction(message, rpcParams, origin);
  }

  // ── Signing ──
  if (method === "personal_sign" || method === "eth_sign") {
    return handlePersonalSign(message, rpcParams, origin);
  }

  if (method === "eth_signTypedData_v4") {
    return handleSignTypedData(message, rpcParams, origin);
  }

  /* ─── eth_signTransaction ────────────────────────────────────
   * Signs a transaction but does NOT broadcast. Returns the RLP-encoded
   * signed hex. Some dApps (multi-sig front-ends, co-signers, fee
   * sponsors) use this so they can broadcast themselves.
   *
   * The flow is identical to `handleSendTransaction` except the final
   * step returns `signedOutput.rawTx` instead of calling
   * `txManager.broadcast`. Goes through the same approval gate. */
  if (method === "eth_signTransaction") {
    const tx = rpcParams[0] as {
      from: string;
      to?: string;
      value?: string;
      data?: string;
      gas?: string;
      nonce?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
    };
    const subject = subjectRegistry.getActive();
    const workspace = workspaceRegistry.getActive();
    if (!subject || !workspace) return respondError(4001, "Wallet not configured");

    const keySlot = keyManager.getKeySlots().find((s) => s.address.toLowerCase() === tx.from.toLowerCase());
    if (!keySlot) return respondError(4001, "Signing key not found");

    // Fetch nonce if dApp didn't supply
    let nonce: number;
    if (tx.nonce) {
      nonce = parseInt(tx.nonce, 16);
    } else {
      try {
        nonce = await txManager.getNonce(tx.from);
      } catch (err) {
        return respondError(-32603, `Nonce fetch failed: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }

    // Gas estimate
    let gasEstimate;
    try {
      gasEstimate = await gasOracle.getFullEstimate({ from: tx.from, to: tx.to, value: tx.value, data: tx.data });
    } catch (err) {
      return respondError(-32603, `Gas estimation failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
    const maxFeePerGas = tx.maxFeePerGas ? hexToBigInt(tx.maxFeePerGas) : gasEstimate.maxFeePerGas;
    const maxPriorityFeePerGas = tx.maxPriorityFeePerGas ? hexToBigInt(tx.maxPriorityFeePerGas) : gasEstimate.maxPriorityFeePerGas;
    const gasLimit = tx.gas ? hexToBigInt(tx.gas) : gasEstimate.gasLimit;
    const appIdentity = resolveAppIdentity(origin);
    const signTxApproval = applyTerraQuraApprovalPresentation({
      app: appIdentity,
      mode: "sign",
      defaultTitle: "Sign transaction (no broadcast)",
      defaultSummary: `${formatAppRequestLabel(appIdentity)} is asking to sign a transaction. The wallet will NOT broadcast it.`,
      detail: {
        kind: "tx",
        chainId: networkManager.getActiveChainId(),
        from: tx.from,
        to: tx.to ?? null,
        value: tx.value ?? "0x0",
        data: tx.data ?? "0x",
        nonce,
        gasLimit: "0x" + gasLimit.toString(16),
        maxFeePerGas: "0x" + maxFeePerGas.toString(16),
        maxPriorityFeePerGas: "0x" + maxPriorityFeePerGas.toString(16),
        estimatedFee: "0x" + (gasLimit * maxFeePerGas).toString(16),
        simulationRisk: "low",
        warnings: ["Wallet will sign but NOT broadcast. The dApp will handle broadcast."],
      },
    });

    // Approval gate (same as eth_sendTransaction)
    const decision = await requestUserApproval({
      title: signTxApproval.title,
      summary: signTxApproval.summary,
      appName: appIdentity.name,
      origin,
      detail: signTxApproval.detail,
    });
    if (decision === "rejected") return respondError(4001, "User rejected");

    const policyToken = { intentId: `signtx-${Date.now()}`, outcome: "allow" as const, timestamp: Date.now() };
    try {
      const signedOutput = await buildAndSignEip1559Tx(
        {
          chainId: hexToBigInt(networkManager.getActiveChainId()),
          nonce: BigInt(nonce),
          maxPriorityFeePerGas,
          maxFeePerGas,
          gasLimit,
          to: addressToBytes(tx.to ?? null),
          value: hexToBigInt(tx.value),
          data: hexToBytes(tx.data),
          accessList: [],
        },
        signer,
        keySlot.id,
        policyToken,
      );
      return respond(signedOutput.rawTx);
    } catch (err) {
      return respondError(-32603, `Signing failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  /* ─── eth_subscribe / eth_unsubscribe ──────────────────────
   *
   * Polling-backed implementation of the Alchemy/Infura subscription
   * protocol. Real WebSocket subscriptions require a persistent
   * connection which MV3 service workers can't keep open. Instead we
   * poll the RPC at a reasonable interval and fire synthetic events
   * via `broadcastProviderEvent("message", ...)` in the shape dApps
   * expect.
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
    const id = `0x${Math.random().toString(16).slice(2, 18)}`;
    const subscription = await startSubscription(id, subType, filter);
    subscriptions.set(id, subscription);
    return respond(id);
  }

  if (method === "eth_unsubscribe") {
    const [id] = rpcParams as [string];
    const sub = subscriptions.get(id);
    if (sub) {
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
  stop: () => void;
}
const subscriptions = new Map<string, Subscription>();

async function startSubscription(
  id: string,
  type: "newHeads" | "logs",
  filter: unknown,
): Promise<Subscription> {
  let lastBlock = "0x0";
  try {
    lastBlock = await rpcClient.call<string>("eth_blockNumber", []);
  } catch { /* empty */ }

  const intervalId = setInterval(async () => {
    try {
      if (type === "newHeads") {
        const current = await rpcClient.call<string>("eth_blockNumber", []);
        if (current !== lastBlock) {
          lastBlock = current;
          const block = await rpcClient.call("eth_getBlockByNumber", [current, false]);
          broadcastProviderEvent("message", {
            type: "eth_subscription",
            data: { subscription: id, result: block },
          });
        }
      } else if (type === "logs") {
        const logs = await rpcClient.call("eth_getLogs", [filter]);
        if (Array.isArray(logs) && logs.length > 0) {
          for (const log of logs) {
            broadcastProviderEvent("message", {
              type: "eth_subscription",
              data: { subscription: id, result: log },
            });
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
    chainId: networkManager.getActiveChainId(),
  });

  // Gas
  let gasEstimate;
  try {
    gasEstimate = await gasOracle.getFullEstimate({
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

  // Nonce (uses the nonce-lock from the chain package hardening work)
  let nonce: number;
  try {
    nonce = await txManager.getNonce(resolvedFrom);
  } catch (err) {
    return {
      error: { code: -32603, message: `Nonce fetch failed: ${err instanceof Error ? err.message : "unknown"}` },
    };
  }

  // Policy check (just for requiresReview determination — we don't deny
  // here because we haven't shown the user the detail yet)
  const role = workspaceRegistry.getRole(subject.id, workspace.id) ?? "owner";
  const policyBundle = getDefaultPolicyBundle(workspace.kind);
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
    }),
    policyBundle,
  );

  if (policyResult.outcome === "deny") {
    return {
      error: { code: 4001, message: policyResult.warnings[0] ?? "Denied by policy" },
    };
  }

  // Store the draft
  const draftId = `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const chainIdHex = networkManager.getActiveChainId();
  const draft: DraftTx = {
    id: draftId,
    from: resolvedFrom,
    to: tx.to ? tx.to : null,
    value: hexToBigInt(tx.value),
    data: hexToBytes(tx.data),
    nonce,
    gasLimit: tx.gas ? hexToBigInt(tx.gas) : gasEstimate.gasLimit,
    maxFeePerGas: tx.maxFeePerGas ? hexToBigInt(tx.maxFeePerGas) : gasEstimate.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? hexToBigInt(tx.maxPriorityFeePerGas) : gasEstimate.maxPriorityFeePerGas,
    chainId: chainIdHex,
    createdAt: Date.now(),
    keySlotId: keySlot.id,
    origin: "popup",
  };
  draftTxs.set(draftId, draft);

  const simWarnings: string[] = Array.isArray((simulation as unknown as { warnings?: string[] }).warnings)
    ? (simulation as unknown as { warnings: string[] }).warnings
    : [];
  const decoded = (simulation as unknown as {
    decodedCall?: { method?: string; params?: Record<string, unknown> };
  }).decodedCall;

  const detail: ApprovalDetail = {
    kind: "tx",
    chainId: chainIdHex,
    from: resolvedFrom,
    to: tx.to ?? null,
    value: tx.value ?? "0x0",
    data: tx.data ?? "0x",
    nonce,
    gasLimit: "0x" + draft.gasLimit.toString(16),
    maxFeePerGas: "0x" + draft.maxFeePerGas.toString(16),
    maxPriorityFeePerGas: "0x" + draft.maxPriorityFeePerGas.toString(16),
    estimatedFee: "0x" + (draft.gasLimit * draft.maxFeePerGas).toString(16),
    simulationRisk: simulation.overallRisk as "low" | "medium" | "high" | "critical",
    warnings: simWarnings,
    decodedMethod: decoded?.method,
    decodedParams: decoded?.params
      ? Object.fromEntries(Object.entries(decoded.params).map(([k, v]) => [k, String(v)]))
      : undefined,
  };

  return {
    result: {
      draftId,
      detail,
      requiresReview: policyResult.outcome === "approval-required",
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
  // Policy token for the signer
  const policyToken = { intentId: `popup-tx-${Date.now()}`, outcome: "allow" as const, timestamp: Date.now() };

  const subject = subjectRegistry.getActive();
  const workspace = workspaceRegistry.getActive();

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
    return {
      error: { code: -32603, message: `Signing failed: ${err instanceof Error ? err.message : "unknown"}` },
    };
  }

  let broadcastHash: string;
  try {
    broadcastHash = await txManager.broadcast(signedOutput.rawTx);
  } catch (err) {
    draftTxs.delete(draft.id);
    return {
      error: { code: -32603, message: `Broadcast failed: ${err instanceof Error ? err.message : "unknown"}` },
    };
  }

  // Track
  txManager.trackTransaction({
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
  txManager
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
      broadcastProviderEvent("message", { type: "aethelred:tx-updated", data: payload });
      broadcastState();
    })
    .catch(() => {});

  if (subject && workspace) {
    auditCapture.record({
      kind: "signing-executed",
      subjectId: subject.id,
      workspaceId: workspace.id,
      detail: { method: "popup-send-tx", nonce: draft.nonce, hash: broadcastHash },
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
  origin: string
): Promise<BridgeMessage> {
  const tx = params[0] as {
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
    chainId: networkManager.getActiveChainId(),
  });

  // ── 2. Gas estimate ──
  let gasEstimate;
  try {
    gasEstimate = await gasOracle.getFullEstimate({
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

  // ── 3. Nonce ──
  let nonce: number;
  try {
    nonce = await txManager.getNonce(tx.from);
  } catch (err) {
    return respondError(
      -32603,
      `Nonce fetch failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }

  const account = keyManager.getAccountByAddress(tx.from);
  if (!account) return respondError(4001, `Account ${tx.from} not found`);

  const role = workspaceRegistry.getRole(subject.id, workspace.id) ?? "owner";
  const policyBundle = getDefaultPolicyBundle(workspace.kind);
  const appIdentity = resolveAppIdentity(origin);
  const gasLimitHex = "0x" + gasEstimate.gasLimit.toString(16);
  const maxFeePerGasHex = "0x" + gasEstimate.maxFeePerGas.toString(16);
  const maxPriorityFeePerGasHex = "0x" + gasEstimate.maxPriorityFeePerGas.toString(16);
  const estimatedFeeWei = gasEstimate.gasLimit * gasEstimate.maxFeePerGas;
  const simWarnings: string[] = Array.isArray((simulation as unknown as { warnings?: string[] }).warnings)
    ? (simulation as unknown as { warnings: string[] }).warnings
    : [];
  const decoded = (simulation as unknown as {
    decodedCall?: { method?: string; params?: Record<string, unknown> };
  }).decodedCall;
  const txApproval = applyTerraQuraApprovalPresentation({
    app: appIdentity,
    mode: "send",
    defaultTitle: "Confirm transaction",
    defaultSummary: `${formatAppRequestLabel(appIdentity)} is asking to send a transaction from ${account.label}.`,
    detail: {
      kind: "tx",
      chainId: networkManager.getActiveChainId(),
      from: tx.from,
      to: tx.to ?? null,
      value: tx.value ?? "0x0",
      data: tx.data ?? "0x",
      nonce,
      gasLimit: gasLimitHex,
      maxFeePerGas: maxFeePerGasHex,
      maxPriorityFeePerGas: maxPriorityFeePerGasHex,
      estimatedFee: "0x" + estimatedFeeWei.toString(16),
      simulationRisk: simulation.overallRisk as "low" | "medium" | "high" | "critical",
      warnings: simWarnings,
      decodedMethod: decoded?.method,
      decodedParams: decoded?.params
        ? Object.fromEntries(
            Object.entries(decoded.params).map(([k, v]) => [k, String(v)]),
          )
        : undefined,
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
    },
  });

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
    }),
    policyBundle,
  );

  auditCapture.record({
    kind: "policy-evaluated",
    subjectId: subject.id,
    workspaceId: workspace.id,
    appId: appIdentity.id,
    detail: {
      outcome: policyResult.outcome,
      risk: simulation.overallRisk,
      decodedMethod: txApproval.detail.decodedMethod,
      targetContractLabel: terraquraTxAssessment.targetContractLabel,
      targetContractTrust: terraquraTxAssessment.contractTrust,
    },
  });

  if (policyResult.outcome === "deny") {
    return respondError(4001, policyResult.warnings[0] ?? "Denied by policy");
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
  if (policyResult.outcome === "approval-required") {
    try {
      const template = getApprovalTemplate(
        workspace.kind,
        gasEstimate && (gasEstimate.gasLimit * gasEstimate.maxFeePerGas) > 10_000_000_000_000_000n, // >0.01 ETH fee → treat as high-value
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
          amount: tx.value ?? "0x0",
          asset: txApproval.detail.assetSymbol ?? "ETH",
          destination: txApproval.detail.to ?? undefined,
          riskLevel: simulation.overallRisk,
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
            ? `${txApproval.detail.decodedMethod} via ${terraquraTxAssessment.targetContractLabel ?? tx.to ?? "contract"}`
            : `send ${tx.value ?? "0x0"} → ${tx.to ?? "contract"}`,
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
  const approvalDecision = await requestUserApproval({
    title: txApproval.title,
    summary: txApproval.summary,
    appName: appIdentity.name,
    origin,
    detail: txApproval.detail,
  });

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
    return respondError(4001, "User rejected the request");
  }

  // ── 6. Locate signing key slot ──
  const keySlot = keyManager
    .getKeySlots()
    .find((s) => s.address.toLowerCase() === tx.from.toLowerCase());
  if (!keySlot) return respondError(4001, "Signing key not found");

  // ── 7. Build + sign + broadcast (REAL) ──
  const policyToken = { intentId: `tx-${Date.now()}`, outcome: "allow" as const, timestamp: Date.now() };
  const chainIdHex = networkManager.getActiveChainId();

  // dApp may override gas fields; fall back to our estimates otherwise
  const maxFeePerGas = tx.maxFeePerGas
    ? hexToBigInt(tx.maxFeePerGas)
    : gasEstimate.maxFeePerGas;
  const maxPriorityFeePerGas = tx.maxPriorityFeePerGas
    ? hexToBigInt(tx.maxPriorityFeePerGas)
    : gasEstimate.maxPriorityFeePerGas;
  const gasLimit = tx.gas || tx.gasLimit
    ? hexToBigInt(tx.gas ?? tx.gasLimit)
    : gasEstimate.gasLimit;

  let signedOutput;
  try {
    signedOutput = await buildAndSignEip1559Tx(
      {
        chainId: hexToBigInt(chainIdHex),
        nonce: BigInt(nonce),
        maxPriorityFeePerGas,
        maxFeePerGas,
        gasLimit,
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
    return respondError(-32603, `Signing failed: ${err instanceof Error ? err.message : "unknown"}`);
  }

  auditCapture.record({
    kind: "signing-executed",
    subjectId: subject.id,
    workspaceId: workspace.id,
    detail: { method: "eth_sendTransaction", nonce, expectedHash: signedOutput.hash },
  });

  // ── 8. Broadcast via eth_sendRawTransaction (REAL) ──
  let broadcastHash: string;
  try {
    broadcastHash = await txManager.broadcast(signedOutput.rawTx);
  } catch (err) {
    auditCapture.record({
      kind: "response-sent",
      subjectId: subject.id,
      workspaceId: workspace.id,
      detail: { method: "eth_sendTransaction", outcome: "broadcast-failed", error: err instanceof Error ? err.message : "unknown" },
    });
    return respondError(
      -32603,
      `Broadcast failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }

  // ── 9. Track for receipt polling ──
  txManager.trackTransaction({
    hash: broadcastHash,
    from: tx.from,
    to: tx.to ?? "",
    value: tx.value ?? "0x0",
    nonce,
    gasLimit: "0x" + gasLimit.toString(16),
    maxFeePerGas: "0x" + maxFeePerGas.toString(16),
    maxPriorityFeePerGas: "0x" + maxPriorityFeePerGas.toString(16),
    data: tx.data ?? "0x",
    chainId: chainIdHex,
  });

  // Poll for receipt in the background — don't block the dApp response.
  // When confirmed/failed, fan out a `tx-updated` event to the popup AND
  // to every connected tab via `broadcastProviderEvent`. This is what
  // gives dApps' `waitForTransaction()` a signal to resolve: EIP-1193
  // providers don't have a native receipt event, so we broadcast a
  // standard `message` event with a structured payload that dApps can
  // listen for via `window.ethereum.on("message", ...)`.
  txManager
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
      // EIP-1193 `message` event for the dApp's ethereum provider
      broadcastProviderEvent("message", {
        type: "aethelred:tx-updated",
        data: payload,
      });
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
    detail: { method: "eth_sendTransaction", txHash: broadcastHash },
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
  origin: string
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
      risk: analysis.overallRisk as "low" | "medium" | "high" | "critical",
    },
  });
  if (approvalDecision === "rejected") {
    return respondError(4001, "User rejected the request");
  }

  const keySlot = keyManager.getKeySlots().find((s) => s.address.toLowerCase() === (from as string).toLowerCase());
  if (!keySlot) return respondError(4001, "Signing key not found");

  const policyToken = { intentId: `sign-${Date.now()}`, outcome: "allow" as const, timestamp: Date.now() };

  let sigResult;
  try {
    sigResult = await signer.signMessage({ keySlotId: keySlot.id, data, type: "message" }, policyToken);
  } catch (err) {
    return respondError(-32603, `Sign failed: ${err instanceof Error ? err.message : "unknown"}`);
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
  origin: string
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
      risk: analysis.overallRisk as "low" | "medium" | "high" | "critical",
    },
  });
  if (approvalDecision === "rejected") {
    return respondError(4001, "User rejected the request");
  }

  const keySlot = keyManager.getKeySlots().find((s) => s.address.toLowerCase() === from.toLowerCase());
  if (!keySlot) return respondError(4001, "Signing key not found");

  const policyToken = { intentId: `typed-${Date.now()}`, outcome: "allow" as const, timestamp: Date.now() };

  let sigResult;
  try {
    // Pass the 32-byte digest — signer.signTypedData forwards it to
    // custody.sign unchanged (custody now enforces a 32-byte length check)
    sigResult = await signer.signTypedData(
      { keySlotId: keySlot.id, data: digest, type: "typed-data" },
      policyToken,
    );
  } catch (err) {
    return respondError(-32603, `Sign failed: ${err instanceof Error ? err.message : "unknown"}`);
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
async function handleIntentRequest(message: BridgeMessage, origin: string): Promise<BridgeMessage> {
  const { params } = message.payload as { method: string; params: unknown[] };
  const intent = params[0] as IntentRequest;
  const intentId = intent.id ?? `intent-${Date.now().toString(36)}`;

  const subject = subjectRegistry.getActive();
  const workspace = workspaceRegistry.getActive();
  const account = keyManager.getAccounts()[0];

  if (!subject || !workspace || !account) {
    return { kind: "rpc-response", correlationId: message.correlationId, payload: { error: { code: 4001, message: "Wallet not configured" } }, timestamp: Date.now() };
  }

  const role = workspaceRegistry.getRole(subject.id, workspace.id) ?? "owner";
  const session = sessionManager.getByOrigin(origin);

  auditCapture.record({ kind: "request-received", subjectId: subject.id, workspaceId: workspace.id, appId: intent.app.id, intentId, detail: { kind: intent.kind, method: intent.method, origin } });

  const policyBundle = getDefaultPolicyBundle(workspace.kind);
  const policyResult = evaluate(
    buildPolicyContext({ intent, subjectId: subject.id, subjectRole: role, workspace, account: { id: account.id, label: account.label, address: account.address, namespace: account.namespace, custody: "local", assurance: "device-key" }, sessionExists: !!session, sessionId: session?.id }),
    policyBundle
  );

  auditCapture.record({ kind: "policy-evaluated", subjectId: subject.id, workspaceId: workspace.id, appId: intent.app.id, intentId, detail: { outcome: policyResult.outcome, warnings: policyResult.warnings } });

  if (policyResult.outcome === "deny") {
    return { kind: "rpc-response", correlationId: message.correlationId, payload: { result: { intentId, outcome: "deny", summary: policyResult.warnings[0] ?? "Denied by policy.", warnings: policyResult.warnings } satisfies IntentResponse }, timestamp: Date.now() };
  }

  // Connect
  if (intent.kind === "connect") {
    sessionManager.createSession({ appId: intent.app.id, appName: intent.app.name, origin: intent.app.origin, trustLevel: intent.app.trustLevel, permissions: ["accounts", "sign-message"], accountAddresses: [account.address] });
    auditCapture.record({ kind: "session-created", subjectId: subject.id, workspaceId: workspace.id, appId: intent.app.id, intentId, detail: { origin: intent.app.origin } });
    persistState();
    broadcastState();
    return { kind: "rpc-response", correlationId: message.correlationId, payload: { result: { intentId, outcome: policyResult.outcome === "warn" ? "warn" : "allow", summary: "Application session approved.", warnings: policyResult.warnings, result: { accounts: [account.address] } } satisfies IntentResponse }, timestamp: Date.now() };
  }

  // Approval-required — route through the unified requestUserApproval()
  // pipeline so the Aethelred Connect intent path gets the same popup
  // auto-open, persistence, audit-trail, and typed-detail rendering as
  // the EVM RPC path. The synthesized `ApprovalDetail` uses the
  // `connect` variant because Connect intents don't map 1:1 to any
  // MetaMask-style kind.
  if (policyResult.outcome === "approval-required") {
    const decision = await requestUserApproval({
      title: `${intent.app.name} requires approval`,
      summary: `Review ${intent.kind} from ${intent.app.origin}.`,
      appName: intent.app.name,
      origin: intent.app.origin,
      detail: {
        kind: "connect",
        permissions: [intent.kind, intent.method],
        accountAddresses: [account.address],
      },
    });

    auditCapture.record({
      kind: "approval-decided",
      subjectId: subject.id,
      workspaceId: workspace.id,
      appId: intent.app.id,
      intentId,
      detail: { decision, kind: intent.kind, method: intent.method },
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
  }

  // Sign
  if (intent.kind === "sign-message" || intent.kind === "sign-transaction") {
    const keySlot = keyManager.getKeySlots()[0];
    if (!keySlot) {
      return { kind: "rpc-response", correlationId: message.correlationId, payload: { error: { code: 4001, message: "No signing key" } }, timestamp: Date.now() };
    }

    const policyToken = { intentId, outcome: "allow" as const, timestamp: Date.now() };

    /* ─── GAP E fix ──────────────────────────────────────────────
     * The old version did:
     *   `data = TextEncoder().encode(JSON.stringify(intent.payload ?? {}))`
     *   `signer.signTransaction({ data, type: "transaction" })`
     * This signed raw JSON bytes under the transaction signing path —
     * exactly the same bug we fixed for `eth_sendTransaction`, just in
     * a different file. `ecrecover` on the result could never validate
     * against the wallet's address, so any dApp using Aethelred Connect
     * for signing was getting back invalid signatures.
     *
     * The correct approach per-intent:
     *   - `sign-message`  → route through `Signer.signMessage`, which
     *     applies the EIP-191 prefix and keccak256 internally. The
     *     payload `message` field (string) becomes the raw bytes.
     *   - `sign-transaction` → we cannot build an EIP-1559 tx from an
     *     opaque `intent.payload` safely. The Aethelred Connect protocol
     *     is not yet a spec-level replacement for `eth_sendTransaction`.
     *     Reject with a clear error and tell the dApp to use
     *     `eth_sendTransaction` via the RPC path instead.
     */
    let sigResult;
    if (intent.kind === "sign-message") {
      // Extract the message from the intent payload. Accept both
      // `{ message: string }` and raw-string payloads for flexibility.
      const payloadObj = (intent.payload ?? {}) as { message?: unknown };
      const messageValue = typeof payloadObj === "string"
        ? payloadObj
        : typeof payloadObj.message === "string"
          ? payloadObj.message
          : JSON.stringify(payloadObj);
      const data = typeof messageValue === "string" && messageValue.startsWith("0x")
        ? hexToBytes(messageValue)
        : new TextEncoder().encode(messageValue);
      sigResult = await signer.signMessage(
        { keySlotId: keySlot.id, data, type: "message" },
        policyToken,
      );
    } else {
      // sign-transaction via Connect is not supported — direct the
      // caller to the canonical RPC path.
      return {
        kind: "rpc-response",
        correlationId: message.correlationId,
        payload: {
          error: {
            code: 4200,
            message:
              "Aethelred Connect `sign-transaction` intent is not yet supported. " +
              "Use the standard `eth_sendTransaction` RPC method via window.ethereum.",
          },
        },
        timestamp: Date.now(),
      };
    }

    const sigHex = "0x" + Array.from(sigResult.signature, (b) => b.toString(16).padStart(2, "0")).join("");
    auditCapture.record({ kind: "signing-executed", subjectId: subject.id, workspaceId: workspace.id, appId: intent.app.id, intentId, detail: { kind: intent.kind, sigPrefix: sigHex.slice(0, 18) } });
    auditCapture.record({ kind: "response-sent", subjectId: subject.id, workspaceId: workspace.id, appId: intent.app.id, intentId, detail: { outcome: "allow" } });

    return { kind: "rpc-response", correlationId: message.correlationId, payload: { result: { intentId, outcome: policyResult.outcome === "warn" ? "warn" : "allow", summary: "Message signed.", warnings: policyResult.warnings, result: { signature: sigHex } } satisfies IntentResponse }, timestamp: Date.now() };
  }

  return { kind: "rpc-response", correlationId: message.correlationId, payload: { result: { intentId, outcome: "allow", summary: "Intent accepted.", warnings: policyResult.warnings } satisfies IntentResponse }, timestamp: Date.now() };
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
  buildAuditChainRehydrationStage({ auditCapture, auditStore }),
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
  }),
);
swLifecycle.registerStage(
  buildWalletConnectSessionStage({
    storage: storageAdapter,
    getManager: () => walletConnectManager,
  }),
);
swLifecycle.registerStage(
  buildVelocityTrackerStage({
    // The policy package exposes VelocityTracker but nothing currently
    // holds a live instance in the background. Until policy wires it
    // into the evaluate() pipeline, the stage runs a no-op probe
    // whose only side-effect is a clear log record — the stage scaffold
    // is ready for when that wiring lands.
    tracker: {
      async getVelocity() {
        return { count24h: 0, valueUsd24h: 0 };
      },
    },
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
async function init(): Promise<void> {
  // StatePersistence is a cross-cutting subsystem that many stages
  // consult — load it FIRST so downstream stages see non-default
  // values during their rehydration path.
  await statePersistence.load();

  // Restore chain selection BEFORE lifecycle boot so the
  // nonce-manager stage hydrates into the correct active chain.
  const persisted = statePersistence.getState();
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
    swLifecycle.boot().catch((err) => {
      backgroundLogger.error(
        "background.onInstalled.failed",
        "Lifecycle boot from onInstalled threw.",
        { error: err instanceof Error ? err.message : String(err) },
      );
    });
  });
  chrome.runtime?.onStartup?.addListener(() => {
    swLifecycle.boot().catch((err) => {
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
    persistWalletConnectSessions(storageAdapter, walletConnectManager).catch(
      () => {},
    );
  });
} catch {
  // Non-Chrome environment (vitest, node) — listeners are optional.
  // `boot()` will still be called by init() below.
}

/**
 * ─── MV3 Service Worker Keepalive ─────────────────────────────────
 * Manifest V3 service workers terminate after ~30s of inactivity,
 * which breaks any pending approval or long-running request. We keep
 * the worker alive by pinging `chrome.runtime` every 20s while there
 * are active operations. This is a pragmatic workaround — the proper
 * long-term fix is to move state to offscreen documents.
 *
 * Costs: a few bytes of heartbeat traffic. Benefits: pending approvals
 * survive past 30s (users often take > 30s to read a tx confirmation),
 * periodic price refreshes don't die, and the popup doesn't get a
 * "wallet disconnected" message on a cold cache.
 */
function startKeepalive(): void {
  const heartbeat = () => {
    try {
      // Calling any chrome API resets the idle timer
      chrome.runtime.getPlatformInfo().catch(() => {});
    } catch {
      // Non-chrome environment — no-op
    }
  };
  // Use an alarm rather than setInterval so it survives service worker
  // dehydration (alarms run MV3 workers back to life).
  try {
    chrome.alarms?.create("aethelred-keepalive", { periodInMinutes: 0.4 });
    chrome.alarms?.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
      if (alarm.name === "aethelred-keepalive") heartbeat();
    });
  } catch {
    // Fall back to setInterval if alarms aren't available
    setInterval(heartbeat, 20_000);
  }
}

startKeepalive();
init();
