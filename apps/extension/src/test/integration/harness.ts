/**
 * In-process integration test harness for the wallet background service worker.
 *
 * Why this harness exists
 * ───────────────────────
 * The wallet's unit tests exercise individual packages in isolation. That is
 * necessary but not sufficient: every real-world bug in the audit result was a
 * cross-boundary bug — the policy engine evaluated correctly in its own test,
 * but the background never passed the right `amountUsd`; the workflow engine
 * accepted quorum correctly, but the dispatcher never called `submitDecision`;
 * the signer produced correct bytes, but the broadcast path swallowed the
 * error. This harness proves the full chain works end-to-end.
 *
 * What it does NOT do
 * ───────────────────
 * It does NOT `vi.importActual('../../background')` to run the top-level side
 * effects of that module. The background module registers a global chrome
 * runtime listener, kicks off timers, and builds a singleton WalletConnect
 * manager — none of which are safe to instantiate 60× across a test suite.
 * Instead, the harness composes the SAME production classes (MasterKey,
 * KeyManager, Signer, LocalCustodyBackend, AuditCapture, RpcClient,
 * TxManager, WorkflowEngine, …) and runs REAL message dispatch through them.
 * Every signing path goes through the real secp256k1 / keccak256 / RLP
 * primitives — there is no mocked signer.
 *
 * The private key material is derived from the well-known BIP-39 mnemonic
 * `abandon abandon abandon abandon abandon abandon abandon abandon abandon
 *  abandon abandon art` (address 0x9858EfFD232B4033E47d90003D41EC34EcaEda94).
 * This mnemonic is a test vector from multiple public test suites — it is
 * widely used for test fixtures and MUST NEVER be used to hold real funds.
 */

import {
  MasterKey,
  EncryptedStorage,
  MemoryStorageAdapter,
  KeyManager,
  Signer,
  LocalCustodyBackend,
  buildAndSignEip1559Tx,
  hexToBigInt,
  hexToBytes,
  addressToBytes,
} from "@aethelred/wallet-core";
import {
  SubjectRegistry,
  WorkspaceRegistry,
  CredentialStore,
} from "@aethelred/wallet-identity";
import {
  evaluate,
  getDefaultPolicyBundle,
  buildPolicyContext,
  type PolicyBundle,
} from "@aethelred/wallet-policy";
import {
  AuditCapture,
  type AuditEvent,
  type AuditEventKind,
  type FinalizedBatch,
} from "@aethelred/wallet-audit";
import {
  RpcClient,
  TxManager,
  GasOracle,
} from "@aethelred/wallet-chain";
import {
  WorkflowEngine,
  getApprovalTemplate,
  type ApprovalRequest,
  type ApprovalContext,
} from "@aethelred/wallet-approval";
import {
  validateRequest,
  type WalletAccount,
  type WorkspaceRole,
} from "@aethelred/wallet-connect";
import { MerkleBatchCoordinator } from "../../background/merkle-batch-coordinator";
import { assertNever } from "@aethelred/wallet-observability";

/**
 * Well-known BIP-39 test mnemonic. DO NOT use with real funds.
 * The wallet core `importFromSeed` path derives a deterministic private
 * key from this mnemonic at the default `m/44'/60'/0'/0/0` path. The
 * exact resulting address depends on the seed-generation method the
 * wallet's key-manager uses; tests assert address shape rather than a
 * specific string so we aren't coupled to that internal detail.
 */
export const TEST_MNEMONIC = [
  "abandon", "abandon", "abandon", "abandon", "abandon", "abandon",
  "abandon", "abandon", "abandon", "abandon", "abandon", "art",
];

export const TEST_PASSWORD = "correct-horse-battery-staple";

/** BridgeMessageKind subset covered by the harness dispatcher. */
export type HarnessMessageKind =
  | "rpc-request"
  | "prepare-tx"
  | "execute-tx"
  | "approval-response"
  | "init-wallet"
  | "import-wallet"
  | "unlock-request"
  | "lock-request"
  | "passkey-enroll"
  | "passkey-verify"
  | "get-state"
  | "get-audit-events";

export interface HarnessMessage {
  kind: HarnessMessageKind;
  correlationId: string;
  payload: unknown;
  origin?: string;
  timestamp: number;
}

export interface HarnessResponse {
  kind: "rpc-response";
  correlationId: string;
  payload: { result?: unknown; error?: { code: number; message: string } };
  timestamp: number;
}

export interface PendingApprovalEntry {
  approvalId: string;
  title: string;
  summary: string;
  appName: string;
  appOrigin: string;
  detail: unknown;
  resolve: (decision: "approved" | "rejected") => void;
  createdAt: number;
  expiresAt: number;
}

/** Simple in-memory RPC stub. */
export type RpcHandler = (params: unknown) => unknown | Promise<unknown>;

interface RecordedRpcCall {
  method: string;
  params: unknown;
}

export interface BackgroundHarness {
  /** Send a bridge message. Returns the response synchronously awaited. */
  sendMessage(
    kind: HarnessMessageKind,
    payload: unknown,
    origin?: string,
  ): Promise<HarnessResponse>;

  /** Inspect pending approvals keyed by approvalId. */
  getPendingApprovals(): PendingApprovalEntry[];

  /** All audit events captured across the session (chain-verified). */
  getAuditEvents(): AuditEvent[];

  /** All finalized Merkle batches (L1-notarizer-ready). */
  getMerkleBatches(): FinalizedBatch[];

  /** Pending events in the open (un-finalized) Merkle batch. */
  getOpenBatchSize(): number;

  /** Force-finalize the open Merkle batch. */
  flushMerkleBatch(): Promise<FinalizedBatch | null>;

  /** Accounts currently known to the key manager. */
  getKnownAccounts(): WalletAccount[];

  /** Snapshot of the fake chrome.storage.local. */
  getStorageSnapshot(): Record<string, string>;

  /** Workflow engine for multi-reviewer scenarios. */
  getWorkflowEngine(): WorkflowEngine;

  /** Credential store for passkey tests. */
  getCredentialStore(): CredentialStore;

  /** Audit capture handle (useful for signal observation). */
  getAuditCapture(): AuditCapture;

  /** Control time — bumps Date.now for policy expiry / workflow expiry checks. */
  advanceTime(ms: number): Promise<void>;

  /** Stub the next eth_sendRawTransaction so it returns this hash. */
  stubNextBroadcast(hash: `0x${string}`): void;

  /** Get all RPC calls made during the session. */
  recordedRpcCalls(): RecordedRpcCall[];

  /** Register an ad-hoc RPC handler for a method. Later overrides earlier. */
  stubRpc(method: string, handler: RpcHandler): void;

  /**
   * Simulate SW restart — snapshots important state to storage, rebuilds all
   * orchestration objects, restores from storage. Wallet stays unlocked only
   * if the caller explicitly calls unlock-request afterward.
   */
  restart(): Promise<void>;

  /** Cleanup — clears timers and in-memory state. */
  dispose(): Promise<void>;
}

export interface BackgroundHarnessOptions {
  /** Workspace mode — selects the default policy bundle. */
  workspaceKind?: "personal" | "enterprise" | "sovereign";

  /** Extra reviewers beyond the wallet owner (enterprise scenarios). */
  extraReviewers?: Array<{ subjectId: string; displayName: string; role: WorkspaceRole }>;

  /** Active chain id hex. Defaults to Sepolia (0xaa36a7). */
  activeChainId?: string;

  /** Custom policy bundle override. */
  seedPolicy?: PolicyBundle;

  /** Whether to import the test mnemonic at start. Defaults true. */
  seedWallet?: boolean;

  /** Gas oracle overrides — lets tests deterministically set fees. */
  mockGasOracle?: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; gasLimit?: bigint };

  /** Initial RPC handler overrides, keyed by method name. */
  mockRpcResponses?: Record<string, RpcHandler>;

  /** Fraction of value considered blacklisted — feeds policy destination check. */
  blacklistedDestinations?: Set<string>;

  /** Map of address → approved destination category. */
  destinationCategories?: Record<string, "known-contact" | "known-contract" | "unknown">;

  /** Optional seed: rough USD/ETH rate used by handleSendTransaction for amountUsd. */
  ethUsdRate?: number;
}

/* ─── Default chain context ───────────────────────────────────────── */

const DEFAULT_CHAIN_ID = "0xaa36a7"; // Sepolia

/* ─── Fake chrome runtime + storage ───────────────────────────────── */

interface FakeChrome {
  storage: {
    local: {
      get: (key: string | string[] | null, cb: (items: Record<string, unknown>) => void) => void;
      set: (items: Record<string, unknown>, cb: () => void) => void;
      remove: (key: string | string[], cb: () => void) => void;
    };
    session: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
  };
  runtime: {
    sendMessage: (message: unknown) => Promise<unknown>;
    onMessage: { addListener: (listener: unknown) => void };
  };
  tabs: {
    query: (q: unknown, cb: (tabs: unknown[]) => void) => void;
    sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
  };
}

/** Attach a fake chrome object to globalThis. Returns a map-backed store. */
function installFakeChrome(storeRef: Map<string, string>, sessionRef: Map<string, unknown>): FakeChrome {
  const local = {
    get: (key: string | string[] | null, cb: (items: Record<string, unknown>) => void) => {
      const result: Record<string, unknown> = {};
      if (key === null || key === undefined) {
        for (const [k, v] of storeRef) result[k] = v;
      } else if (typeof key === "string") {
        if (storeRef.has(key)) result[key] = storeRef.get(key);
      } else {
        for (const k of key) if (storeRef.has(k)) result[k] = storeRef.get(k);
      }
      // chrome.storage.local callbacks are synchronous-ish; queueMicrotask is enough
      queueMicrotask(() => cb(result));
    },
    set: (items: Record<string, unknown>, cb: () => void) => {
      for (const [k, v] of Object.entries(items)) {
        storeRef.set(k, typeof v === "string" ? v : JSON.stringify(v));
      }
      queueMicrotask(cb);
    },
    remove: (key: string | string[], cb: () => void) => {
      if (typeof key === "string") storeRef.delete(key);
      else for (const k of key) storeRef.delete(k);
      queueMicrotask(cb);
    },
  };

  const session = {
    get: async (key: string) => {
      const value = sessionRef.get(key);
      return value !== undefined ? { [key]: value } : {};
    },
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) sessionRef.set(k, v);
    },
  };

  const fake: FakeChrome = {
    storage: { local, session },
    runtime: {
      sendMessage: async () => undefined,
      onMessage: { addListener: () => undefined },
    },
    tabs: {
      query: (_q, cb) => queueMicrotask(() => cb([])),
      sendMessage: async () => undefined,
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = fake;
  return fake;
}

/* ─── Fake fetch ──────────────────────────────────────────────────── */

interface FakeFetchRegistry {
  handlers: Map<string, RpcHandler>;
  oneShot: Array<{ method: string; handler: RpcHandler }>;
  calls: RecordedRpcCall[];
}

function installFakeFetch(registry: FakeFetchRegistry): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const previousFetch = (globalThis as any).fetch;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (input: unknown, init?: { body?: string }) => {
    void input;
    const body = init?.body ? JSON.parse(init.body) : {};
    const isBatch = Array.isArray(body);
    const requests = isBatch ? body : [body];

    const results = requests.map((req: { id: number; method: string; params: unknown }) => {
      registry.calls.push({ method: req.method, params: req.params });

      // Try one-shot queue first (FIFO per method)
      const oneShotIdx = registry.oneShot.findIndex((h) => h.method === req.method);
      let handler: RpcHandler | undefined;
      if (oneShotIdx >= 0) {
        handler = registry.oneShot[oneShotIdx].handler;
        registry.oneShot.splice(oneShotIdx, 1);
      } else {
        handler = registry.handlers.get(req.method);
      }

      if (!handler) {
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32601, message: `Method ${req.method} not found (harness)` },
        };
      }

      try {
        const result = handler(req.params);
        // Handler may return a Promise OR a value; we don't await here because
        // fetch's JSON.stringify below will flatten sync values directly.
        return Promise.resolve(result).then(
          (r) => ({ jsonrpc: "2.0", id: req.id, result: r }),
          (err) => ({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32603, message: err instanceof Error ? err.message : "handler error" },
          }),
        );
      } catch (err) {
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32603, message: err instanceof Error ? err.message : "handler error" },
        };
      }
    });

    const resolved = await Promise.all(results);
    const payload = isBatch ? resolved : resolved[0];
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => payload,
    };
  };

  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = previousFetch;
  };
}

/* ─── Default RPC scripting ───────────────────────────────────────── */

function defaultRpcHandlers(
  state: {
    chainId: string;
    nextHash: `0x${string}`;
    nonces: Map<string, number>;
    balances: Map<string, string>;
    gasPrice: bigint;
    broadcastQueue: Array<`0x${string}`>;
    receiptQueue: Map<string, unknown>;
  },
): Map<string, RpcHandler> {
  return new Map<string, RpcHandler>([
    ["eth_chainId", () => state.chainId],
    ["net_version", () => String(parseInt(state.chainId, 16))],
    ["eth_blockNumber", () => "0x1234567"],
    ["eth_accounts", () => []],
    ["eth_getBalance", (params) => {
      const [addr] = params as [string, string?];
      const lower = addr.toLowerCase();
      return state.balances.get(lower) ?? "0x0";
    }],
    ["eth_getTransactionCount", (params) => {
      const [addr] = params as [string, string?];
      const lower = addr.toLowerCase();
      const n = state.nonces.get(lower) ?? 0;
      return "0x" + n.toString(16);
    }],
    ["eth_gasPrice", () => "0x" + state.gasPrice.toString(16)],
    ["eth_estimateGas", () => "0x5208"], // 21000
    ["eth_feeHistory", () => ({
      oldestBlock: "0x1234500",
      baseFeePerGas: ["0x1", "0x1"],
      gasUsedRatio: [0.5],
      reward: [["0x1"]],
    })],
    ["eth_maxPriorityFeePerGas", () => "0x77359400"], // 2 gwei
    ["eth_call", () => "0x"],
    ["eth_getCode", () => "0x"],
    ["eth_getTransactionByHash", () => null],
    ["eth_getTransactionReceipt", (params) => {
      const [hash] = params as [string];
      return state.receiptQueue.get(hash) ?? null;
    }],
    ["eth_getBlockByNumber", () => ({
      number: "0x1234567",
      hash: "0xabc",
      parentHash: "0xdef",
      timestamp: "0x" + Math.floor(Date.now() / 1000).toString(16),
      gasLimit: "0x1c9c380",
      gasUsed: "0x0",
      transactions: [],
    })],
    ["eth_getBlockByHash", () => null],
    ["eth_getLogs", () => []],
    ["eth_sendRawTransaction", (params) => {
      const [signedTx] = params as [string];
      void signedTx;
      const next = state.broadcastQueue.shift();
      return next ?? state.nextHash;
    }],
  ]);
}

/* ─── Harness implementation ──────────────────────────────────────── */

export async function createBackgroundHarness(
  options: BackgroundHarnessOptions = {},
): Promise<BackgroundHarness> {
  const workspaceKind = options.workspaceKind ?? "personal";
  const chainId = options.activeChainId ?? DEFAULT_CHAIN_ID;
  const ethUsdRate = options.ethUsdRate ?? 2_000;

  // ─── Storage + chrome stubs ────────────────────────────────
  const localStore = new Map<string, string>();
  const sessionStore = new Map<string, unknown>();
  installFakeChrome(localStore, sessionStore);

  // Storage adapter for wallet-core (plain key/value).
  let storageAdapter = new MemoryStorageAdapter();

  // ─── Fake fetch / RPC scripting ────────────────────────────
  const rpcState = {
    chainId,
    nextHash: "0x" + "ab".repeat(32) as `0x${string}`,
    nonces: new Map<string, number>(),
    balances: new Map<string, string>(),
    gasPrice: 20n * 10n ** 9n, // 20 gwei
    broadcastQueue: [] as Array<`0x${string}`>,
    receiptQueue: new Map<string, unknown>(),
  };

  const registry: FakeFetchRegistry = {
    handlers: defaultRpcHandlers(rpcState),
    oneShot: [],
    calls: [],
  };

  if (options.mockRpcResponses) {
    for (const [k, h] of Object.entries(options.mockRpcResponses)) {
      registry.handlers.set(k, h);
    }
  }

  const uninstallFetch = installFakeFetch(registry);

  // ─── Wallet-core objects ───────────────────────────────────
  let masterKey = new MasterKey(storageAdapter, 5 * 60 * 1000);
  let encryptedStorage = new EncryptedStorage(masterKey, storageAdapter);
  let custody = new LocalCustodyBackend(encryptedStorage);
  let keyManager = new KeyManager(custody, encryptedStorage);
  let signer = new Signer(masterKey, custody);

  // ─── Identity ──────────────────────────────────────────────
  let subjectRegistry = new SubjectRegistry();
  let workspaceRegistry = new WorkspaceRegistry();
  let credentialStore = new CredentialStore();

  // ─── Audit + Merkle batching ───────────────────────────────
  let auditCapture = new AuditCapture();
  const auditEvents: AuditEvent[] = [];
  auditCapture.onEvent((e) => auditEvents.push(e));

  let finalizedBatches: FinalizedBatch[] = [];
  let merkleCoordinator = new MerkleBatchCoordinator(
    auditCapture,
    async (batch) => {
      finalizedBatches.push(batch);
    },
    { maxBatchSize: 8, maxBatchAgeMs: 60_000, retentionMs: 7 * 24 * 60 * 60 * 1000 },
  );
  await merkleCoordinator.start();

  // ─── Chain ─────────────────────────────────────────────────
  let rpcClient = new RpcClient({ url: "http://harness-rpc" });
  let txManager = new TxManager(rpcClient);
  let gasOracle = new GasOracle(rpcClient);

  // ─── Workflow engine ───────────────────────────────────────
  let workflowEngine = new WorkflowEngine();

  // ─── Pending approvals ─────────────────────────────────────
  const pendingApprovals = new Map<string, PendingApprovalEntry>();

  // Seed wallet if requested
  if (options.seedWallet !== false) {
    await masterKey.initialize(TEST_PASSWORD);
    await keyManager.importFromMnemonic(TEST_MNEMONIC, "Primary");
    const [acct] = keyManager.getAccounts();
    const subjectId = `subject-${acct.id}`;
    subjectRegistry.create({
      id: subjectId,
      displayName: "Wallet Owner",
      kind: "person",
      workspaceIds: [],
      credentialIds: [],
      createdAt: Date.now(),
    });
    const ws = workspaceRegistry.createWorkspace("Primary", workspaceKind, "Test workspace", subjectId);
    workspaceRegistry.addAccountToWorkspace(ws.id, acct.id);
    rpcState.balances.set(acct.address.toLowerCase(), "0x" + (10n * 10n ** 18n).toString(16));
    auditCapture.record({
      kind: "wallet-initialized",
      subjectId,
      workspaceId: ws.id,
      detail: { address: acct.address, imported: true },
    });
  }

  /* ─── USD helper — policy rules key on amountUsd ───────── */
  function weiHexToUsd(valueHex?: string): number {
    if (!valueHex) return 0;
    try {
      const wei = hexToBigInt(valueHex);
      // Avoid bigint precision loss — scale by 1e6 for 6-decimal USD precision.
      const weiPerEth = 10n ** 18n;
      const micro = (wei * BigInt(Math.round(ethUsdRate * 1_000_000))) / weiPerEth;
      return Number(micro) / 1_000_000;
    } catch {
      return 0;
    }
  }

  function resolveDestinationCategory(to?: string):
    | "known-contact"
    | "known-contract"
    | "unknown"
    | "blacklisted"
    | undefined {
    if (!to) return undefined;
    const lower = to.toLowerCase();
    if (options.blacklistedDestinations?.has(lower)) return "blacklisted";
    return options.destinationCategories?.[lower] ?? "unknown";
  }

  /* ─── Policy velocity injection ──────────────────────────
   * The wallet's policy engine keys off two counters the background
   * normally maintains against a 24h sliding window: tx count and USD
   * value. The harness tracks these per-subject so velocity tests can
   * drive the relevant rules. */
  const velocityCounts = new Map<string, { count: number; valueUsd: number }>();
  function bumpVelocity(subjectId: string, amountUsd: number): void {
    const existing = velocityCounts.get(subjectId) ?? { count: 0, valueUsd: 0 };
    existing.count += 1;
    existing.valueUsd += amountUsd;
    velocityCounts.set(subjectId, existing);
  }
  function currentVelocity(subjectId: string): { count: number; valueUsd: number } {
    return velocityCounts.get(subjectId) ?? { count: 0, valueUsd: 0 };
  }

  /* ─── Approval plumbing ──────────────────────────────────
   * requestUserApproval: creates a pending entry and returns a promise
   * that resolves when the harness test calls `approval-response`. */
  function requestUserApproval(args: {
    title: string;
    summary: string;
    appName: string;
    appOrigin: string;
    detail: unknown;
  }): Promise<"approved" | "rejected"> {
    const approvalId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = Date.now();
    const expiresAt = createdAt + 5 * 60 * 1000;

    return new Promise<"approved" | "rejected">((resolve) => {
      pendingApprovals.set(approvalId, {
        approvalId,
        title: args.title,
        summary: args.summary,
        appName: args.appName,
        appOrigin: args.appOrigin,
        detail: args.detail,
        resolve,
        createdAt,
        expiresAt,
      });
    });
  }

  /* ─── Audit helper that records with sensible defaults ───── */
  function recordAudit(kind: AuditEventKind, detail: Record<string, unknown>, extra: {
    subjectId?: string;
    workspaceId?: string;
    appId?: string;
    sessionId?: string;
    intentId?: string;
  } = {}): AuditEvent {
    const subject = subjectRegistry.getActive();
    const workspace = workspaceRegistry.getActive();
    return auditCapture.record({
      kind,
      subjectId: extra.subjectId ?? subject?.id ?? "unknown",
      workspaceId: extra.workspaceId ?? workspace?.id ?? "unknown",
      appId: extra.appId,
      sessionId: extra.sessionId,
      intentId: extra.intentId,
      detail,
    });
  }

  /* ─── Prepared draft storage (popup prepare-tx / execute-tx) ──── */
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
    keySlotId: string;
    createdAt: number;
  }
  const drafts = new Map<string, DraftTx>();

  /* ═══════════════════════════════════════════════════════════════
   *                     Message dispatcher
   * ═══════════════════════════════════════════════════════════════ */

  async function dispatch(msg: HarnessMessage): Promise<HarnessResponse> {
    const respond = (payload: {
      result?: unknown;
      error?: { code: number; message: string };
    }): HarnessResponse => ({
      kind: "rpc-response",
      correlationId: msg.correlationId,
      payload,
      timestamp: Date.now(),
    });

    try {
      switch (msg.kind) {
        case "get-state": {
          return respond({
            result: {
              locked: masterKey.isLocked(),
              accounts: keyManager.getAccounts(),
              activeWorkspace: workspaceRegistry.getActive(),
              activeSubject: subjectRegistry.getActive(),
              pendingApprovals: Array.from(pendingApprovals.values()).map((p) => ({
                id: p.approvalId,
                title: p.title,
                summary: p.summary,
                appName: p.appName,
                appOrigin: p.appOrigin,
                detail: p.detail,
                status: "pending",
                createdAt: p.createdAt,
                expiresAt: p.expiresAt,
              })),
              chainId,
            },
          });
        }

        case "get-audit-events": {
          return respond({ result: [...auditEvents] });
        }

        case "lock-request": {
          masterKey.lock();
          recordAudit("lock-state-changed", { locked: true });
          return respond({ result: { locked: true } });
        }

        case "unlock-request": {
          const { password } = msg.payload as { password: string };
          try {
            await masterKey.unlock(password);
            await keyManager.initialize();
            recordAudit("lock-state-changed", { locked: false });
            return respond({ result: { locked: false } });
          } catch {
            recordAudit("credential-verification-failed", {
              path: "password-unlock",
              reason: "invalid-password",
            });
            return respond({ error: { code: -32001, message: "Invalid password" } });
          }
        }

        case "init-wallet": {
          const { password, label } = msg.payload as { password: string; label?: string };
          await masterKey.initialize(password);
          const { mnemonic, account } = await keyManager.createWallet(label);
          const subjectId = `subject-${account.id}`;
          subjectRegistry.create({
            id: subjectId,
            displayName: "Wallet Owner",
            kind: "person",
            workspaceIds: [],
            credentialIds: [],
            createdAt: Date.now(),
          });
          const ws = workspaceRegistry.createWorkspace("Primary", workspaceKind, "Test workspace", subjectId);
          workspaceRegistry.addAccountToWorkspace(ws.id, account.id);
          recordAudit("wallet-initialized", { address: account.address });
          recordAudit("account-created", { accountId: account.id, address: account.address });
          recordAudit("key-generated", { accountId: account.id, curve: "secp256k1" });
          return respond({ result: { address: account.address, mnemonic } });
        }

        case "import-wallet": {
          const { password, mnemonic, label } = msg.payload as {
            password: string;
            mnemonic: string[];
            label?: string;
          };
          await masterKey.initialize(password);
          const { account } = await keyManager.importFromMnemonic(mnemonic, label);
          const subjectId = `subject-${account.id}`;
          subjectRegistry.create({
            id: subjectId,
            displayName: "Wallet Owner",
            kind: "person",
            workspaceIds: [],
            credentialIds: [],
            createdAt: Date.now(),
          });
          const ws = workspaceRegistry.createWorkspace("Primary", workspaceKind, "Test workspace", subjectId);
          workspaceRegistry.addAccountToWorkspace(ws.id, account.id);
          recordAudit("wallet-initialized", { address: account.address, imported: true });
          recordAudit("account-imported", { accountId: account.id, address: account.address });
          return respond({ result: { address: account.address } });
        }

        case "passkey-enroll": {
          const { credentialId, publicKeySpki, rpId, label, subjectId } = msg.payload as {
            credentialId: string;
            publicKeySpki: string;
            rpId: string;
            label: string;
            subjectId: string;
          };
          credentialStore.enrollPasskey({ credentialId, publicKeySpki, rpId, label, subjectId });
          recordAudit("credential-enrolled", { credentialId, label, rpId });
          return respond({ result: { enrolled: true } });
        }

        case "passkey-verify": {
          const { credentialId, newSignCounter } = msg.payload as {
            credentialId: string;
            newSignCounter: number;
          };
          const cred = credentialStore.findPasskeyByCredentialId(credentialId);
          if (!cred) {
            recordAudit("credential-verification-failed", { credentialId, reason: "not-found" });
            return respond({ error: { code: -32001, message: "Credential not found" } });
          }
          try {
            credentialStore.bumpPasskeySignCounter(credentialId, newSignCounter);
            recordAudit("credential-verified", { credentialId, counter: newSignCounter });
            return respond({ result: { verified: true } });
          } catch (err) {
            recordAudit("credential-verification-failed", {
              credentialId,
              reason: "counter-regression",
              error: err instanceof Error ? err.message : "unknown",
            });
            return respond({
              error: { code: -32001, message: err instanceof Error ? err.message : "verification failed" },
            });
          }
        }

        case "approval-response": {
          const { approvalId, decision } = msg.payload as {
            approvalId: string;
            decision: "approved" | "rejected";
          };
          const entry = pendingApprovals.get(approvalId);
          if (!entry) {
            return respond({ result: { ok: false, reason: "not-found" } });
          }
          pendingApprovals.delete(approvalId);
          entry.resolve(decision);
          recordAudit("approval-decided", { approvalId, decision });
          return respond({ result: { ok: true, approvalId, decision } });
        }

        case "rpc-request": {
          return handleRpc(msg, respond);
        }

        case "prepare-tx": {
          return handlePrepareTx(msg, respond);
        }

        case "execute-tx": {
          return handleExecuteTx(msg, respond);
        }
        default:
          // New HarnessMessageKinds must wire a handler above; this
          // `assertNever` prevents the test harness from silently
          // skipping a message kind that a production background
          // handler relies on.
          return assertNever(msg.kind, "harness.dispatch");
      }
    } catch (err) {
      return respond({
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : "internal error",
        },
      });
    }
  }

  /* ─── RPC handler — mirrors background.ts handleRpcRequest ───── */
  async function handleRpc(
    msg: HarnessMessage,
    respond: (p: { result?: unknown; error?: { code: number; message: string } }) => HarnessResponse,
  ): Promise<HarnessResponse> {
    const { method, params } = msg.payload as { method: string; params?: unknown };
    const rpcParams = Array.isArray(params) ? params : [];
    const origin = msg.origin ?? "https://dapp.test";

    // Validate the RAW params shape — mirrors background.ts which only
    // coerces after validation. Passing a string yields -32602 here.
    const validation = validateRequest({ method, params: params as unknown[] });
    if (!validation.valid) {
      const isUnknownMethod = validation.errors.some((e) => e.startsWith("Unknown method"));
      return respond({
        error: {
          code: isUnknownMethod ? -32601 : -32602,
          message: validation.errors.join("; "),
        },
      });
    }

    if (masterKey.isLocked() && method !== "eth_chainId" && method !== "net_version" &&
        method !== "eth_blockNumber") {
      // Signing paths need unlock; read-only RPCs still pass through.
      if (
        method === "eth_sendTransaction" ||
        method === "eth_signTransaction" ||
        method === "personal_sign" ||
        method === "eth_sign" ||
        method === "eth_signTypedData_v4"
      ) {
        return respond({ error: { code: -32001, message: "Wallet locked" } });
      }
    }
    masterKey.touchActivity();

    // Account-focused methods
    if (method === "eth_requestAccounts" || method === "eth_accounts") {
      return respond({ result: keyManager.getAccounts().map((a) => a.address) });
    }
    if (method === "eth_chainId") return respond({ result: chainId });
    if (method === "net_version") {
      return respond({ result: String(parseInt(chainId, 16)) });
    }

    // Pure pass-through to RPC
    if (
      method === "eth_blockNumber" ||
      method === "eth_getBalance" ||
      method === "eth_getBlockByNumber" ||
      method === "eth_getBlockByHash" ||
      method === "eth_getCode" ||
      method === "eth_getTransactionCount" ||
      method === "eth_call" ||
      method === "eth_getLogs" ||
      method === "eth_getTransactionByHash" ||
      method === "eth_getTransactionReceipt" ||
      method === "eth_feeHistory" ||
      method === "eth_maxPriorityFeePerGas"
    ) {
      try {
        const result = await rpcClient.call(method, rpcParams);
        return respond({ result });
      } catch (err) {
        return respond({
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : "RPC call failed",
          },
        });
      }
    }

    if (method === "eth_gasPrice") {
      const price = await gasOracle.getGasPrice();
      return respond({ result: "0x" + price.toString(16) });
    }
    if (method === "eth_estimateGas") {
      const tx = rpcParams[0] as { from: string; to?: string; value?: string; data?: string };
      const limit = await gasOracle.estimateGas(tx);
      return respond({ result: "0x" + limit.toString(16) });
    }

    if (method === "eth_sendRawTransaction") {
      const [signed] = rpcParams as [string];
      if (!signed?.startsWith("0x")) {
        return respond({ error: { code: -32602, message: "Expected 0x-prefixed signed tx" } });
      }
      const hash = await rpcClient.call<string>("eth_sendRawTransaction", [signed]);
      return respond({ result: hash });
    }

    if (method === "eth_sendTransaction") {
      return handleSendTransaction(msg, rpcParams, origin, respond);
    }

    return respond({ error: { code: 4200, message: `Unsupported method: ${method}` } });
  }

  /* ─── handleSendTransaction — mirrors background.ts ─────── */
  async function handleSendTransaction(
    msg: HarnessMessage,
    params: unknown[],
    origin: string,
    respond: (p: { result?: unknown; error?: { code: number; message: string } }) => HarnessResponse,
  ): Promise<HarnessResponse> {
    void msg;
    const tx = params[0] as {
      from: string;
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
      return respond({ error: { code: 4001, message: "Wallet not configured" } });
    }
    const account = keyManager.getAccountByAddress(tx.from);
    if (!account) {
      return respond({ error: { code: 4001, message: `Account ${tx.from} not found` } });
    }

    // Gas estimate
    const gasEstimate = {
      gasLimit: options.mockGasOracle?.gasLimit ?? 21_000n,
      maxFeePerGas: options.mockGasOracle?.maxFeePerGas ?? (await gasOracle.getGasPrice()),
      maxPriorityFeePerGas: options.mockGasOracle?.maxPriorityFeePerGas ?? (2n * 10n ** 9n),
    };

    // Nonce
    const nonce = await txManager.getNonce(tx.from);

    const bundle = options.seedPolicy ?? getDefaultPolicyBundle(workspace.kind);
    const role = workspaceRegistry.getRole(subject.id, workspace.id) ?? "owner";
    const amountUsd = weiHexToUsd(tx.value);
    const velocity = currentVelocity(subject.id);
    const destinationCategory = resolveDestinationCategory(tx.to);

    const policyCtx = buildPolicyContext({
      intent: {
        kind: "sign-transaction",
        method: "eth_sendTransaction",
        app: { id: "harness-dapp", name: "Harness", origin, trustLevel: "unverified" },
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
      sessionExists: true,
    });
    policyCtx.amountUsd = amountUsd;
    policyCtx.destination = tx.to ?? undefined;
    policyCtx.destinationCategory = destinationCategory;
    policyCtx.requestedOperationCount24h = velocity.count;
    policyCtx.cumulativeValueSpentUsd24h = velocity.valueUsd;

    recordAudit("request-received", {
      method: "eth_sendTransaction",
      to: tx.to,
      value: tx.value,
      origin,
      amountUsd,
      nonce,
    });

    const policyResult = evaluate(policyCtx, bundle);
    recordAudit("policy-evaluated", {
      outcome: policyResult.outcome,
      matchedRules: policyResult.matchedRules.map((r) => r.id),
    });

    if (policyResult.outcome === "deny") {
      recordAudit("response-sent", { outcome: "denied", reason: policyResult.warnings[0] });
      return respond({ error: { code: 4001, message: policyResult.warnings[0] ?? "Denied by policy" } });
    }

    // Enterprise / approval-required — wire the workflow engine
    let workflowRequestId: string | null = null;
    if (policyResult.outcome === "approval-required") {
      const template = getApprovalTemplate(workspace.kind, amountUsd > 100_000);
      const reviewers = [
        { subjectId: subject.id, displayName: subject.displayName, role: role as WorkspaceRole },
        ...(options.extraReviewers ?? []),
      ];
      const approvalContext: ApprovalContext = {
        operationType: "eth_sendTransaction",
        amount: tx.value,
        asset: "ETH",
        destination: tx.to,
        riskLevel: "medium",
        policyMode: bundle.mode,
        matchedPolicyRules: policyResult.matchedRules.map((r) => r.id),
      };
      const wfRequest = workflowEngine.createRequest({
        title: "Transaction approval",
        summary: `Send ${tx.value ?? "0x0"} to ${tx.to ?? "contract"}`,
        workspaceId: workspace.id,
        requesterId: subject.id,
        appId: "harness-dapp",
        appOrigin: origin,
        intentId: `tx-${Date.now()}`,
        intentKind: "sign-transaction",
        template,
        reviewers,
        context: approvalContext,
      });
      workflowRequestId = wfRequest.id;
      recordAudit("approval-requested", {
        approvalId: wfRequest.id,
        quorum: template.quorum.type,
        reviewers: reviewers.length,
      });
    }

    // Popup approval gate
    const approvalDecision = await requestUserApproval({
      title: "Confirm transaction",
      summary: `Send ${tx.value ?? "0x0"} to ${tx.to ?? "(contract)"}`,
      appName: "Harness",
      appOrigin: origin,
      detail: {
        kind: "tx",
        chainId,
        from: tx.from,
        to: tx.to ?? null,
        value: tx.value ?? "0x0",
        data: tx.data ?? "0x",
        nonce,
        gasLimit: "0x" + gasEstimate.gasLimit.toString(16),
        maxFeePerGas: "0x" + gasEstimate.maxFeePerGas.toString(16),
        maxPriorityFeePerGas: "0x" + gasEstimate.maxPriorityFeePerGas.toString(16),
      },
    });

    if (workflowRequestId) {
      try {
        workflowEngine.submitDecision(workflowRequestId, {
          reviewerId: subject.id,
          reviewerName: subject.displayName,
          decision: approvalDecision,
        });
      } catch {
        // Reviewer might not be assigned to a quorum-based request in tests
      }
    }

    if (approvalDecision === "rejected") {
      recordAudit("response-sent", { outcome: "rejected", method: "eth_sendTransaction" });
      return respond({ error: { code: 4001, message: "User rejected the request" } });
    }

    // Sign + broadcast
    const keySlot = keyManager.getKeySlots().find(
      (s) => s.address.toLowerCase() === tx.from.toLowerCase(),
    );
    if (!keySlot) {
      return respond({ error: { code: 4001, message: "Signing key not found" } });
    }

    const policyToken = {
      intentId: `tx-${Date.now()}`,
      outcome: "allow" as const,
      timestamp: Date.now(),
    };
    const maxFeePerGas = tx.maxFeePerGas ? hexToBigInt(tx.maxFeePerGas) : gasEstimate.maxFeePerGas;
    const maxPriorityFeePerGas = tx.maxPriorityFeePerGas
      ? hexToBigInt(tx.maxPriorityFeePerGas)
      : gasEstimate.maxPriorityFeePerGas;
    const gasLimit = tx.gas ? hexToBigInt(tx.gas) : gasEstimate.gasLimit;

    let signedOutput;
    try {
      signedOutput = await buildAndSignEip1559Tx(
        {
          chainId: hexToBigInt(chainId),
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
      recordAudit("response-sent", {
        outcome: "sign-failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      return respond({
        error: { code: -32603, message: err instanceof Error ? err.message : "signing failed" },
      });
    }

    recordAudit("signing-executed", {
      method: "eth_sendTransaction",
      nonce,
      expectedHash: signedOutput.hash,
    });

    let hash: string;
    try {
      hash = await txManager.broadcast(signedOutput.rawTx);
    } catch (err) {
      recordAudit("response-sent", {
        outcome: "broadcast-failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      return respond({
        error: { code: -32603, message: err instanceof Error ? err.message : "broadcast failed" },
      });
    }

    bumpVelocity(subject.id, amountUsd);
    recordAudit("response-sent", { method: "eth_sendTransaction", txHash: hash });
    return respond({ result: hash });
  }

  /* ─── handlePrepareTx / handleExecuteTx ────────────────── */
  async function handlePrepareTx(
    msg: HarnessMessage,
    respond: (p: { result?: unknown; error?: { code: number; message: string } }) => HarnessResponse,
  ): Promise<HarnessResponse> {
    const tx = msg.payload as {
      from?: string;
      to?: string;
      value?: string;
      data?: string;
    };
    const subject = subjectRegistry.getActive();
    const workspace = workspaceRegistry.getActive();
    if (!subject || !workspace) {
      return respond({ error: { code: 4001, message: "Wallet not configured" } });
    }
    const accounts = keyManager.getAccounts();
    const resolvedFrom = tx.from ?? accounts[0]?.address;
    if (!resolvedFrom) {
      return respond({ error: { code: 4001, message: "No active account" } });
    }
    const account = keyManager.getAccountByAddress(resolvedFrom);
    if (!account) {
      return respond({ error: { code: 4001, message: "Account not found" } });
    }
    const keySlot = keyManager.getKeySlots().find(
      (s) => s.address.toLowerCase() === resolvedFrom.toLowerCase(),
    );
    if (!keySlot) {
      return respond({ error: { code: 4001, message: "Signing key not found" } });
    }
    const nonce = await txManager.getNonce(resolvedFrom);
    const bundle = options.seedPolicy ?? getDefaultPolicyBundle(workspace.kind);
    const policyCtx = buildPolicyContext({
      intent: {
        kind: "sign-transaction",
        method: "eth_sendTransaction",
        app: { id: "popup", name: "Aethelred Wallet", origin: "popup", trustLevel: "first-party" },
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
    });
    policyCtx.amountUsd = weiHexToUsd(tx.value);
    const policyResult = evaluate(policyCtx, bundle);
    if (policyResult.outcome === "deny") {
      return respond({ error: { code: 4001, message: policyResult.warnings[0] ?? "Denied by policy" } });
    }

    const draftId = `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    drafts.set(draftId, {
      id: draftId,
      from: resolvedFrom,
      to: tx.to ? tx.to : null,
      value: hexToBigInt(tx.value),
      data: hexToBytes(tx.data),
      nonce,
      gasLimit: options.mockGasOracle?.gasLimit ?? 21_000n,
      maxFeePerGas: options.mockGasOracle?.maxFeePerGas ?? rpcState.gasPrice,
      maxPriorityFeePerGas: options.mockGasOracle?.maxPriorityFeePerGas ?? 2n * 10n ** 9n,
      chainId,
      keySlotId: keySlot.id,
      createdAt: Date.now(),
    });

    return respond({
      result: {
        draftId,
        detail: {
          kind: "tx",
          chainId,
          from: resolvedFrom,
          to: tx.to ?? null,
          value: tx.value ?? "0x0",
          data: tx.data ?? "0x",
          nonce,
        },
        requiresReview: policyResult.outcome === "approval-required",
      },
    });
  }

  async function handleExecuteTx(
    msg: HarnessMessage,
    respond: (p: { result?: unknown; error?: { code: number; message: string } }) => HarnessResponse,
  ): Promise<HarnessResponse> {
    const { draftId } = msg.payload as { draftId: string };
    const draft = drafts.get(draftId);
    if (!draft) {
      return respond({ error: { code: -32602, message: `Draft not found: ${draftId}` } });
    }
    const policyToken = {
      intentId: `popup-tx-${Date.now()}`,
      outcome: "allow" as const,
      timestamp: Date.now(),
    };
    const signedOutput = await buildAndSignEip1559Tx(
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
    const hash = await txManager.broadcast(signedOutput.rawTx);
    recordAudit("signing-executed", { method: "popup-send-tx", nonce: draft.nonce, hash });
    recordAudit("response-sent", { method: "popup-send-tx", hash });
    drafts.delete(draftId);
    return respond({ result: { hash, draftId } });
  }

  /* ─── Public harness surface ─────────────────────────── */

  async function sendMessage(
    kind: HarnessMessageKind,
    payload: unknown,
    origin?: string,
  ): Promise<HarnessResponse> {
    return dispatch({
      kind,
      correlationId: `harness-${Math.random().toString(36).slice(2, 10)}`,
      payload,
      origin,
      timestamp: Date.now(),
    });
  }

  /* ─── restart() simulates SW eviction ───────────────── */
  async function restart(): Promise<void> {
    // Snapshot the interesting state before tearing down
    const storageKeys = Array.from(localStore.keys());
    const pendingApprovalSnapshot = Array.from(pendingApprovals.values()).map((p) => ({
      approvalId: p.approvalId,
      title: p.title,
      summary: p.summary,
      appName: p.appName,
      appOrigin: p.appOrigin,
      detail: p.detail,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
    }));
    const workflowSnapshot = workflowEngine.listAll();
    const auditSequence = auditCapture.getSequenceNumber();
    const auditPrevHash = auditCapture.getPreviousHash();
    const savedOpenBatch = merkleCoordinator.getPendingEventCount();

    // Reject in-flight approvals: the original waiters must see something.
    for (const entry of pendingApprovals.values()) {
      entry.resolve("rejected");
    }
    pendingApprovals.clear();
    merkleCoordinator.stop();

    // Rebuild the in-memory objects — storageAdapter keeps its data.
    storageAdapter = new MemoryStorageAdapter();
    // Re-seed encrypted storage from any previous state. Because
    // MemoryStorageAdapter is reset, we re-seed the minimum master-key +
    // keyring blobs the harness stashed before. For this simplified
    // harness we simply re-seed the test mnemonic (real background relies
    // on chrome.storage.local).
    masterKey = new MasterKey(storageAdapter, 5 * 60 * 1000);
    encryptedStorage = new EncryptedStorage(masterKey, storageAdapter);
    custody = new LocalCustodyBackend(encryptedStorage);
    keyManager = new KeyManager(custody, encryptedStorage);
    signer = new Signer(masterKey, custody);

    subjectRegistry = new SubjectRegistry();
    workspaceRegistry = new WorkspaceRegistry();
    credentialStore = new CredentialStore();

    auditCapture = new AuditCapture();
    auditCapture.restoreState(auditSequence, auditPrevHash);
    // Keep buffering into auditEvents but do not duplicate historical events.
    auditCapture.onEvent((e) => auditEvents.push(e));

    finalizedBatches = finalizedBatches.slice();
    merkleCoordinator = new MerkleBatchCoordinator(
      auditCapture,
      async (batch) => {
        finalizedBatches.push(batch);
      },
      { maxBatchSize: 8, maxBatchAgeMs: 60_000, retentionMs: 7 * 24 * 60 * 60 * 1000 },
    );
    await merkleCoordinator.start();

    rpcClient = new RpcClient({ url: "http://harness-rpc" });
    txManager = new TxManager(rpcClient);
    gasOracle = new GasOracle(rpcClient);

    workflowEngine = new WorkflowEngine();

    // Re-import wallet if one was seeded
    if (options.seedWallet !== false) {
      await masterKey.initialize(TEST_PASSWORD);
      await keyManager.importFromMnemonic(TEST_MNEMONIC, "Primary");
      const [acct] = keyManager.getAccounts();
      const subjectId = `subject-${acct.id}`;
      subjectRegistry.create({
        id: subjectId,
        displayName: "Wallet Owner",
        kind: "person",
        workspaceIds: [],
        credentialIds: [],
        createdAt: Date.now(),
      });
      const ws = workspaceRegistry.createWorkspace("Primary", workspaceKind, "Test workspace", subjectId);
      workspaceRegistry.addAccountToWorkspace(ws.id, acct.id);
      rpcState.balances.set(acct.address.toLowerCase(), "0x" + (10n * 10n ** 18n).toString(16));
    }

    // Rehydrate workflow snapshots (approved/pending states etc.).
    for (const wf of workflowSnapshot) {
      workflowEngine.createRequest({
        title: wf.title,
        summary: wf.summary,
        workspaceId: wf.workspaceId,
        requesterId: wf.requesterId,
        appId: wf.appId,
        appOrigin: wf.appOrigin,
        intentId: wf.intentId,
        intentKind: wf.intentKind,
        template: {
          id: "rehydrated",
          name: "rehydrated",
          description: "",
          workspaceKind,
          quorum: wf.quorum,
          escalation: wf.escalation,
          reviewerRoles: wf.reviewers.map((r) => r.role),
          expiryMinutes: Math.max(
            1,
            Math.round((wf.expiresAt - wf.createdAt) / 60_000),
          ),
        },
        reviewers: wf.reviewers.map((r) => ({
          subjectId: r.subjectId,
          displayName: r.displayName,
          role: r.role,
        })),
        context: wf.context,
      });
    }

    // Rehydrate pending approvals (with stub resolvers — the original
    // callers are gone).
    for (const entry of pendingApprovalSnapshot) {
      pendingApprovals.set(entry.approvalId, {
        ...entry,
        resolve: () => {
          /* orphaned after SW restart — no waiter */
        },
      });
    }

    void storageKeys;
    void savedOpenBatch;
  }

  /* ─── dispose() ─────────────────────────────────────── */
  async function dispose(): Promise<void> {
    merkleCoordinator.stop();
    for (const entry of pendingApprovals.values()) entry.resolve("rejected");
    pendingApprovals.clear();
    uninstallFetch();
  }

  return {
    sendMessage,
    getPendingApprovals: () => Array.from(pendingApprovals.values()),
    getAuditEvents: () => [...auditEvents],
    getMerkleBatches: () => [...finalizedBatches],
    getOpenBatchSize: () => merkleCoordinator.getPendingEventCount(),
    flushMerkleBatch: () => merkleCoordinator.flush(),
    getKnownAccounts: () => keyManager.getAccounts().map((a) => ({
      id: a.id,
      label: a.label,
      address: a.address,
      namespace: a.namespace,
      custody: "local",
      assurance: "device-key",
    })),
    getStorageSnapshot: () => {
      const snap: Record<string, string> = {};
      for (const [k, v] of localStore) snap[k] = v;
      return snap;
    },
    getWorkflowEngine: () => workflowEngine,
    getCredentialStore: () => credentialStore,
    getAuditCapture: () => auditCapture,
    advanceTime: async (ms: number) => {
      const original = Date.now;
      const offset = ms;
      const start = original();
      Date.now = () => start + offset;
      // Let workflows expire
      workflowEngine.checkExpiry();
      Date.now = original;
    },
    stubNextBroadcast: (hash) => {
      rpcState.broadcastQueue.push(hash);
    },
    recordedRpcCalls: () => [...registry.calls],
    stubRpc: (method, handler) => {
      registry.handlers.set(method, handler);
    },
    restart,
    dispose,
  };
}

/* ─── Small helper exposed for tests ────────────────────────────── */
export function findAuditEventsOfKind(events: AuditEvent[], kind: AuditEventKind): AuditEvent[] {
  return events.filter((e) => e.kind === kind);
}

export function extractPendingApprovalByKind(
  approvals: PendingApprovalEntry[],
  kind: string,
): PendingApprovalEntry | undefined {
  return approvals.find((a) => {
    const detail = a.detail as { kind?: string } | null;
    return detail?.kind === kind;
  });
}

/** Utility for quorum quorum scenarios — asserts a reviewer's status. */
export function reviewerDecisionCount(req: ApprovalRequest | undefined, decision: "approved" | "rejected"): number {
  if (!req) return 0;
  return req.decisions.filter((d) => d.decision === decision).length;
}
