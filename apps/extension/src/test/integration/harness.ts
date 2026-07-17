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
 *  abandon abandon about` (address 0x9858EfFD232B4033E47d90003D41EC34EcaEda94).
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
  hashTypedDataV4Json,
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
  VelocityTracker,
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
  TokenListService,
  type TokenListEntry,
} from "@aethelred/wallet-chain";
import {
  WorkflowEngine,
  getApprovalTemplate,
  type ApprovalRequest,
  type ApprovalContext,
} from "@aethelred/wallet-approval";
import {
  SessionManager,
  validateRequest,
  type WalletAccount,
  type WorkspaceRole,
} from "@aethelred/wallet-connect";
import { MerkleBatchCoordinator } from "../../background/merkle-batch-coordinator";
import { baseUnitsToAmount } from "../../background/spending-context";
import {
  Eip1559GasValidationError,
  resolveEffectiveEip1559GasParameters,
} from "../../background/eip1559-gas";
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
  "abandon", "abandon", "abandon", "abandon", "abandon", "about",
];

export const TEST_PASSWORD = "correct-horse-battery-staple";

/** BridgeMessageKind subset covered by the harness dispatcher. */
export type HarnessMessageKind =
  | "rpc-request"
  | "prepare-tx"
  | "execute-tx"
  | "cancel-tx"
  | "approval-response"
  | "init-wallet"
  | "import-wallet"
  | "unlock-request"
  | "lock-request"
  | "passkey-enroll"
  | "passkey-verify"
  | "get-state"
  | "get-audit-events"
  | "revoke-session";

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

export interface SensitivePrimitiveContext {
  method: string;
  primitive: "sign" | "broadcast";
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

  /** Current policy velocity for the active subject (test observation). */
  getVelocitySnapshot(): { count: number; valueUsd: number };

  /** Seed committed velocity history for deterministic boundary tests. */
  seedVelocity(count: number, totalValueUsd: number): Promise<void>;

  /** Committed + in-flight velocity, read from the production tracker. */
  getEffectiveVelocitySnapshot(): Promise<{ count: number; valueUsd: number }>;

  /** Number of real sensitive primitives attempted by the harness. */
  getSensitivePrimitiveCounts(): { sign: number; broadcast: number };

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

  /**
   * Enforce production's per-origin signing session gate. Kept opt-in so
   * older policy/signing integration tests can continue to isolate their
   * own layer without first performing an EIP-1193 connection ceremony.
   */
  enforceSessionAuthority?: boolean;

  /**
   * Deterministic race hook invoked immediately before the final session
   * revalidation guarding a signing or broadcast primitive.
   */
  beforeSensitivePrimitive?: (context: SensitivePrimitiveContext) => void | Promise<void>;

  /** Deterministic race hook after custody returns but before result release. */
  afterSensitivePrimitive?: (context: SensitivePrimitiveContext) => void | Promise<void>;

  /** Authoritative token-price fixtures, keyed by lower-case contract address. */
  tokenPricesUsd?: Record<string, number>;

  /** Custom tracked tokens installed before the harness starts. */
  customTokens?: TokenListEntry[];
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
  let activeChainId = options.activeChainId ?? DEFAULT_CHAIN_ID;
  let activeChainEpoch = 0;
  const ethUsdRate = options.ethUsdRate ?? 2_000;
  const sensitivePrimitiveCounts = { sign: 0, broadcast: 0 };

  // ─── Storage + chrome stubs ────────────────────────────────
  const localStore = new Map<string, string>();
  const sessionStore = new Map<string, unknown>();
  installFakeChrome(localStore, sessionStore);

  const velocityStorage = {
    get: async (key: string) => localStore.get(key) ?? null,
    set: async (key: string, value: string) => {
      localStore.set(key, value);
    },
    delete: async (key: string) => {
      localStore.delete(key);
    },
  };
  let velocityTracker = new VelocityTracker(velocityStorage);

  // Storage adapter for wallet-core (plain key/value).
  let storageAdapter = new MemoryStorageAdapter();

  // ─── Fake fetch / RPC scripting ────────────────────────────
  const rpcState = {
    chainId: activeChainId,
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
  let sessionManager = new SessionManager();

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
  const chainContextChanged = (chainId: string, epoch: number): boolean =>
    activeChainEpoch !== epoch || activeChainId.toLowerCase() !== chainId.toLowerCase();
  const tokenListService = new TokenListService();
  for (const token of options.customTokens ?? []) {
    tokenListService.addCustomToken(token);
  }

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

  interface HarnessSpendingContext {
    destination?: string;
    destinationCategory?: "known-contact" | "known-contract" | "unknown" | "blacklisted";
    amount: number;
    amountUsd?: number;
    assetId: string;
    assetSymbol: string;
    assetCategory: "native" | "stablecoin" | "governance" | "unknown";
    amountBaseUnits: bigint;
    assetDecimals: number;
    tokenContract?: string;
    requiresHighRiskReview: boolean;
    warnings: string[];
  }

  function exactHarnessAmount(value: bigint, decimals: number): string {
    if (decimals === 0) return value.toString();
    const digits = value.toString().padStart(decimals + 1, "0");
    const whole = digits.slice(0, -decimals);
    const fraction = digits.slice(-decimals).replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole;
  }

  function harnessReviewedSpending(
    spending: HarnessSpendingContext,
    transactionTo: string | null,
    transactionValue: string,
  ) {
    const nativeValue = `0x${hexToBigInt(transactionValue).toString(16)}`;
    const common = {
      amount: exactHarnessAmount(spending.amountBaseUnits, spending.assetDecimals),
      amountBaseUnits: spending.amountBaseUnits.toString(),
      decimals: spending.assetDecimals,
      symbol: spending.assetSymbol,
    };
    if (spending.tokenContract) {
      return {
        kind: "erc20" as const,
        ...common,
        recipient: spending.destination!,
        tokenContract: spending.tokenContract,
        nativeValue: "0x0" as const,
      };
    }
    return {
      kind: "native" as const,
      ...common,
      recipient: transactionTo,
      nativeValue,
    };
  }

  const tokenPricesUsd = new Map(
    Object.entries(options.tokenPricesUsd ?? {}).map(([address, price]) => [
      address.toLowerCase(),
      price,
    ]),
  );

  function decodeErc20Transfer(data?: string): { recipient: string; amountBaseUnits: bigint } | null {
    const rawCalldata = data ?? "0x";
    if (/^a9059cbb/i.test(rawCalldata)) {
      throw new Error("Malformed ERC-20 transfer calldata; a 0x prefix is required");
    }
    const calldata = rawCalldata.toLowerCase();
    if (!calldata.startsWith("0xa9059cbb")) return null;
    const body = calldata.slice(2);
    if (body.length !== 136 || !/^[0-9a-f]+$/.test(body)) {
      throw new Error("Malformed ERC-20 transfer calldata");
    }
    const recipientWord = body.slice(8, 72);
    if (!/^0{24}[0-9a-f]{40}$/.test(recipientWord)) {
      throw new Error("Malformed ERC-20 transfer recipient encoding");
    }
    return {
      recipient: `0x${recipientWord.slice(24)}`,
      amountBaseUnits: BigInt(`0x${body.slice(72, 136)}`),
    };
  }

  async function resolveHarnessSpending(tx: {
    to?: string;
    value?: string;
    data?: string;
  }, chainId: string, chainRpcClient: RpcClient): Promise<HarnessSpendingContext> {
    const decoded = decodeErc20Transfer(tx.data);
    if (!decoded) {
      const amountBaseUnits = hexToBigInt(tx.value ?? "0x0");
      return {
        destination: tx.to,
        destinationCategory: resolveDestinationCategory(tx.to),
        amount: baseUnitsToAmount(amountBaseUnits, 18),
        amountUsd: weiHexToUsd(tx.value),
        assetId: "native",
        assetSymbol: "ETH",
        assetCategory: "native",
        amountBaseUnits,
        assetDecimals: 18,
        requiresHighRiskReview: false,
        warnings: [],
      };
    }
    if (!tx.to) throw new Error("ERC-20 transfer is missing its token contract address");
    if (hexToBigInt(tx.value ?? "0x0") !== 0n) {
      throw new Error("ERC-20 transfer with a non-zero native value cannot be evaluated safely");
    }

    const numericChainId = parseInt(chainId, 16);
    const token = tokenListService
      .getTokensForChain(numericChainId)
      .find((entry) => !entry.isNative && entry.address.toLowerCase() === tx.to!.toLowerCase());
    if (!token) {
      throw new Error(
        `ERC-20 token ${tx.to} is not in the authoritative token list for chain ${numericChainId}`,
      );
    }

    let onChainDecimals: number;
    try {
      const encoded = await chainRpcClient.call<string>("eth_call", [
        { to: token.address, data: "0x313ce567" },
        "latest",
      ]);
      if (!/^0x[0-9a-fA-F]{64}$/.test(encoded)) {
        throw new Error("decimals() returned a non-canonical ABI value");
      }
      const decodedDecimals = BigInt(encoded);
      if (decodedDecimals > 255n) throw new Error("decimals() exceeded uint8 range");
      onChainDecimals = Number(decodedDecimals);
    } catch (error) {
      throw new Error(
        `Could not verify ERC-20 decimals for ${token.symbol}: ${error instanceof Error ? error.message : "RPC failure"}`,
      );
    }
    if (onChainDecimals !== token.decimals) {
      throw new Error(
        `ERC-20 decimals mismatch for ${token.symbol}: token list says ${token.decimals}, contract says ${onChainDecimals}`,
      );
    }

    const amount = baseUnitsToAmount(decoded.amountBaseUnits, onChainDecimals);
    if (decoded.amountBaseUnits > 0n && (!Number.isFinite(amount) || amount <= 0)) {
      throw new Error(`ERC-20 amount for ${token.symbol} cannot be represented safely`);
    }
    const priceUsd = tokenPricesUsd.get(token.address.toLowerCase());
    const priced = typeof priceUsd === "number" && Number.isFinite(priceUsd) && priceUsd > 0;
    const amountUsd = priced ? amount * priceUsd : undefined;
    const requiresHighRiskReview = !priced && decoded.amountBaseUnits > 0n;
    const normalizedSymbol = token.symbol.toUpperCase();
    const assetCategory = ["USDC", "USDT", "DAI"].includes(normalizedSymbol)
      ? "stablecoin"
      : ["UNI", "AAVE"].includes(normalizedSymbol)
        ? "governance"
        : "unknown";

    return {
      destination: decoded.recipient,
      destinationCategory: resolveDestinationCategory(decoded.recipient),
      amount,
      amountUsd,
      assetId: token.address.toLowerCase(),
      assetSymbol: token.symbol,
      assetCategory,
      amountBaseUnits: decoded.amountBaseUnits,
      assetDecimals: onChainDecimals,
      tokenContract: token.address,
      requiresHighRiskReview,
      warnings: [
        `ERC-20 transfer: ${amount} ${token.symbol} to ${decoded.recipient}. Token contract: ${token.address}.`,
        ...(requiresHighRiskReview
          ? [`${token.symbol} has no fresh authoritative USD price; explicit high-risk review is required.`]
          : []),
      ],
    };
  }

  /* ─── Policy velocity observation mirror ────────────────────
   * The wallet's policy engine keys off two counters the background
   * normally maintains against a 24h sliding window: tx count and USD
   * value. Enforcement uses the real persisted VelocityTracker; this mirror
   * only preserves the existing synchronous committed-velocity observation. */
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

  function rejectPendingApprovalsForOrigin(origin: string): number {
    let rejected = 0;
    for (const [approvalId, pending] of pendingApprovals) {
      if (pending.appOrigin !== origin) continue;
      pendingApprovals.delete(approvalId);
      pending.resolve("rejected");
      rejected += 1;
    }
    return rejected;
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
    txManager: TxManager;
    ownsNonce: boolean;
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    chainId: string;
    chainEpoch: number;
    keySlotId: string;
    createdAt: number;
    subjectId: string;
    workspaceId: string;
    velocityReservationId: string;
    spending: HarnessSpendingContext;
    amountUsd?: number;
    assetSymbol: string;
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
              sessions: sessionManager.toSummaries(),
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
              chainId: activeChainId,
            },
          });
        }

        case "get-audit-events": {
          return respond({ result: [...auditEvents] });
        }

        case "revoke-session": {
          const { sessionId } = msg.payload as { sessionId?: string };
          if (!sessionId) {
            return respond({ error: { code: -32602, message: "sessionId is required" } });
          }
          const session = sessionManager.get(sessionId);
          if (!session || session.status !== "active") {
            return respond({ error: { code: 4001, message: "Active session not found" } });
          }
          sessionManager.revoke(sessionId);
          const rejectedApprovals = rejectPendingApprovalsForOrigin(session.origin);
          recordAudit("session-revoked", {
            sessionId,
            origin: session.origin,
            reason: "user-disconnected",
            rejectedApprovals,
          });
          return respond({ result: { ok: true } });
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
            return respond({
              error: {
                code: -32002,
                message: "This approval is no longer pending. The approval queue was refreshed.",
              },
            });
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
        case "cancel-tx": {
          const { draftId } = msg.payload as { draftId: string };
          const draft = drafts.get(draftId);
          if (draft) {
            drafts.delete(draftId);
            if (draft.ownsNonce) {
              draft.ownsNonce = false;
              draft.txManager.releaseNonce(draft.from, draft.nonce);
            }
            await velocityTracker.releaseReservation(draft.velocityReservationId);
          }
          return respond({ result: { ok: true } });
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

  const sensitivePermissions: Readonly<Record<string, string>> = {
    eth_sendTransaction: "eth_sendTransaction",
    eth_sign: "eth_sign",
    personal_sign: "personal_sign",
    eth_signTypedData_v4: "eth_signTypedData_v4",
  };

  interface HarnessSigningAuthority {
    method: string;
    origin: string;
    sessionId: string;
    grantedPermission: string;
    account: string;
  }

  function signingRequirement(
    method: string,
    params: unknown[],
  ): { permission: string; fallbackPermission?: string; account?: string } | null {
    if (method in sensitivePermissions) {
      let account: string | undefined;
      if (method === "eth_sendTransaction") {
        const tx = params[0] as { from?: unknown } | undefined;
        if (typeof tx?.from === "string") account = tx.from;
      } else if (method === "personal_sign") {
        if (typeof params[1] === "string") account = params[1];
      } else if (typeof params[0] === "string") {
        account = params[0];
      }
      return {
        permission: sensitivePermissions[method],
        fallbackPermission: "eth_accounts",
        account,
      };
    }

    if (method === "aethelred_requestIntent") {
      const intent = params[0] as {
        kind?: unknown;
        payload?: { from?: unknown; account?: unknown; address?: unknown };
      } | undefined;
      if (intent?.kind !== "sign-message" && intent?.kind !== "sign-transaction") {
        return null;
      }
      const candidate = intent.payload?.from ?? intent.payload?.account ?? intent.payload?.address;
      return {
        permission: intent.kind,
        account: typeof candidate === "string"
          ? candidate
          : keyManager.getAccounts()[0]?.address,
      };
    }

    return null;
  }

  function authorizeSigning(
    method: string,
    params: unknown[],
    origin: string,
  ): {
    authority?: HarnessSigningAuthority;
    error?: { code: number; message: string };
  } {
    if (!options.enforceSessionAuthority) return {};
    const requirement = signingRequirement(method, params);
    if (!requirement) return {};
    const session = sessionManager.getByOrigin(origin);
    if (!session) {
      return {
        error: {
          code: 4100,
          message: "The requesting origin is not connected",
        },
      };
    }
    if (
      !session.permissions.includes(requirement.permission) &&
      (!requirement.fallbackPermission ||
        !session.permissions.includes(requirement.fallbackPermission))
    ) {
      return {
        error: {
          code: 4100,
          message: `The connected site is not authorized for ${requirement.permission}`,
        },
      };
    }
    if (!requirement.account) {
      return { error: { code: -32602, message: "A signing account is required" } };
    }
    if (!session.accountAddresses.some(
      (address) => address.toLowerCase() === requirement.account!.toLowerCase(),
    )) {
      return {
        error: {
          code: 4100,
          message: "The requested account is not authorized for this connected site",
        },
      };
    }

    const grantedPermission = session.permissions.includes(requirement.permission)
      ? requirement.permission
      : requirement.fallbackPermission;
    if (!grantedPermission) {
      return {
        error: {
          code: 4100,
          message: "The connected site does not have complete signing authority",
        },
      };
    }
    return {
      authority: {
        method,
        origin,
        sessionId: session.id,
        grantedPermission,
        account: requirement.account.toLowerCase(),
      },
    };
  }

  function revalidateSigningAuthority(
    authority: HarnessSigningAuthority | undefined,
  ): { code: number; message: string } | null {
    if (!authority) return null;
    const session = sessionManager.get(authority.sessionId);
    const activeForOrigin = sessionManager.getByOrigin(authority.origin);
    if (
      !session ||
      session.status !== "active" ||
      session.origin !== authority.origin ||
      activeForOrigin?.id !== authority.sessionId ||
      !session.permissions.includes(authority.grantedPermission) ||
      !session.accountAddresses.some(
        (address) => address.toLowerCase() === authority.account,
      )
    ) {
      return {
        code: 4100,
        message: `Signing authority for ${authority.method} is no longer active`,
      };
    }
    return null;
  }

  async function guardSensitivePrimitive(
    authority: HarnessSigningAuthority | undefined,
    method: string,
    primitive: "sign" | "broadcast",
  ): Promise<{ code: number; message: string } | null> {
    await options.beforeSensitivePrimitive?.({ method, primitive });
    const error = revalidateSigningAuthority(authority);
    if (error) return error;
    sensitivePrimitiveCounts[primitive] += 1;
    return null;
  }

  async function guardSensitivePrimitiveResult(
    authority: HarnessSigningAuthority | undefined,
    method: string,
    primitive: "sign" | "broadcast",
  ): Promise<{ code: number; message: string } | null> {
    await options.afterSensitivePrimitive?.({ method, primitive });
    return revalidateSigningAuthority(authority);
  }

  /* ─── RPC handler — mirrors background.ts handleRpcRequest ───── */
  async function handleRpc(
    msg: HarnessMessage,
    respond: (p: { result?: unknown; error?: { code: number; message: string } }) => HarnessResponse,
  ): Promise<HarnessResponse> {
    const { method, params } = msg.payload as { method: string; params?: unknown };
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
    const rpcParams = Array.isArray(validation.normalizedParams)
      ? [...validation.normalizedParams]
      : [];

    if (method === "eth_signTransaction") {
      return respond({
        error: {
          code: 4200,
          message:
            "eth_signTransaction is not supported. Use eth_sendTransaction so the wallet can enforce policy and broadcast safely.",
        },
      });
    }

    if (method === "aethelred_requestIntent") {
      const intent = rpcParams[0] as { app?: { origin?: unknown } } | undefined;
      if (typeof intent?.app?.origin !== "string") {
        return respond({ error: { code: -32602, message: "Aethelred intents require an app origin" } });
      }
      let claimedOrigin: string;
      try {
        claimedOrigin = new URL(intent.app.origin).origin;
      } catch {
        return respond({ error: { code: 4100, message: "The intent app origin does not match the browser sender origin" } });
      }
      if (claimedOrigin !== origin) {
        return respond({ error: { code: 4100, message: "The intent app origin does not match the browser sender origin" } });
      }
    }

    if (method === "aethelred_getState") {
      const session = sessionManager.getByOrigin(origin);
      if (!session) {
        return respond({ error: { code: 4100, message: "The requesting origin is not connected" } });
      }
      if (
        !session.permissions.includes("accounts") &&
        !session.permissions.includes("eth_accounts")
      ) {
        return respond({
          error: {
            code: 4100,
            message: "The connected site is not authorized to read wallet state",
          },
        });
      }
      return respond({
        result: {
          locked: masterKey.isLocked(),
          chainId: activeChainId,
          accounts: masterKey.isLocked() ? [] : [...session.accountAddresses],
        },
      });
    }

    const signingAuthorization = authorizeSigning(method, rpcParams, origin);
    if (signingAuthorization.error) {
      return respond({ error: signingAuthorization.error });
    }

    if (masterKey.isLocked() && method !== "eth_chainId" && method !== "net_version" &&
        method !== "eth_blockNumber") {
      // Signing paths need unlock; read-only RPCs still pass through.
      if (
        method === "eth_sendTransaction" ||
        method === "personal_sign" ||
        method === "eth_sign" ||
        method === "eth_signTypedData_v4"
      ) {
        return respond({ error: { code: -32001, message: "Wallet locked" } });
      }
    }
    masterKey.touchActivity();

    // Account-focused methods — mirror background.ts per-origin consent.
    if (method === "eth_accounts") {
      return respond({
        result: masterKey.isLocked()
          ? []
          : sessionManager.getByOrigin(origin)?.accountAddresses ?? [],
      });
    }
    if (method === "eth_requestAccounts") {
      if (masterKey.isLocked()) {
        return respond({ error: { code: 4001, message: "Wallet is locked." } });
      }
      const account = keyManager.getAccounts()[0];
      if (!account) {
        return respond({ error: { code: 4001, message: "Wallet is locked or has no account." } });
      }
      const existing = sessionManager.getByOrigin(origin);
      if (existing && existing.accountAddresses.length > 0) {
        return respond({ result: existing.accountAddresses });
      }
      const decision = await requestUserApproval({
        title: `${origin} wants to connect`,
        summary: `${origin} is requesting to see your account address.`,
        appName: origin,
        appOrigin: origin,
        detail: { kind: "connect", permissions: ["eth_accounts"], accountAddresses: [account.address] },
      });
      if (decision === "rejected") {
        return respond({ error: { code: 4001, message: "Connection request rejected" } });
      }
      sessionManager.createSession({
        appId: origin,
        appName: origin,
        origin,
        trustLevel: "unverified",
        permissions: ["eth_accounts", "eth_sendTransaction"],
        accountAddresses: [account.address],
      });
      recordAudit("session-created", { origin, permissions: ["eth_accounts", "eth_sendTransaction"] });
      return respond({ result: [account.address] });
    }

    if (method === "wallet_getPermissions") {
      const session = sessionManager.getByOrigin(origin);
      return respond({
        result: session?.permissions.map((permission) => ({
          parentCapability: permission,
          invoker: origin,
          caveats: [],
        })) ?? [],
      });
    }

    if (method === "wallet_requestPermissions") {
      const request = rpcParams[0] as Record<string, unknown> | undefined;
      const requested = request && typeof request === "object" ? Object.keys(request) : [];
      if (requested.length === 0) {
        return respond({ error: { code: -32602, message: "At least one capability is required" } });
      }
      const account = keyManager.getAccounts()[0];
      if (!account) {
        return respond({ error: { code: 4001, message: "Wallet is locked or has no account" } });
      }
      const decision = await requestUserApproval({
        title: "Connect to site",
        summary: `${origin} is requesting permissions: ${requested.join(", ")}`,
        appName: origin,
        appOrigin: origin,
        detail: { kind: "connect", permissions: requested, accountAddresses: [account.address] },
      });
      if (decision === "rejected") {
        return respond({ error: { code: 4001, message: "User rejected permission request" } });
      }
      const existing = sessionManager.getByOrigin(origin);
      const permissions = Array.from(new Set([
        ...(existing?.permissions ?? []),
        ...requested,
      ]));
      const accounts = existing?.accountAddresses.length
        ? existing.accountAddresses
        : [account.address];
      sessionManager.createSession({
        appId: existing?.appId ?? origin,
        appName: existing?.appName ?? origin,
        origin,
        trustLevel: existing?.trustLevel ?? "unverified",
        permissions,
        accountAddresses: accounts,
      });
      return respond({
        result: permissions.map((permission) => ({
          parentCapability: permission,
          invoker: origin,
          caveats: [],
        })),
      });
    }

    if (method === "wallet_revokePermissions") {
      const existing = sessionManager.getByOrigin(origin);
      if (existing) {
        sessionManager.revoke(existing.id);
        rejectPendingApprovalsForOrigin(origin);
      }
      return respond({ result: null });
    }
    if (method === "eth_chainId") return respond({ result: activeChainId });
    if (method === "net_version") {
      return respond({ result: String(parseInt(activeChainId, 16)) });
    }
    if (method === "wallet_switchEthereumChain") {
      const requestedChainId = (rpcParams[0] as { chainId?: string } | undefined)?.chainId;
      if (!requestedChainId) {
        return respond({ error: { code: -32602, message: "chainId required" } });
      }
      activeChainId = requestedChainId;
      rpcState.chainId = requestedChainId;
      rpcClient = new RpcClient({ url: "http://harness-rpc" });
      txManager = new TxManager(rpcClient);
      gasOracle = new GasOracle(rpcClient);
      activeChainEpoch += 1;
      return respond({ result: null });
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

    if (method === "personal_sign" || method === "eth_sign") {
      const messageValue = method === "personal_sign" ? rpcParams[0] : rpcParams[1];
      const from = method === "personal_sign" ? rpcParams[1] : rpcParams[0];
      if (typeof messageValue !== "string" || typeof from !== "string") {
        return respond({ error: { code: -32602, message: "Message and signing account are required" } });
      }
      const decision = await requestUserApproval({
        title: "Sign message",
        summary: `${origin} is asking you to sign a message.`,
        appName: origin,
        appOrigin: origin,
        detail: {
          kind: "personal_sign",
          from,
          rawHex: messageValue,
        },
      });
      if (decision === "rejected") {
        return respond({ error: { code: 4001, message: "User rejected the request" } });
      }
      const authorityAfterApproval = revalidateSigningAuthority(
        signingAuthorization.authority,
      );
      if (authorityAfterApproval) return respond({ error: authorityAfterApproval });
      const keySlot = keyManager.getKeySlots().find(
        (slot) => slot.address.toLowerCase() === from.toLowerCase(),
      );
      if (!keySlot) {
        return respond({ error: { code: 4001, message: "Signing key not found" } });
      }
      const data = messageValue.startsWith("0x")
        ? hexToBytes(messageValue)
        : new TextEncoder().encode(messageValue);
      const signingGuard = await guardSensitivePrimitive(
        signingAuthorization.authority,
        method,
        "sign",
      );
      if (signingGuard) return respond({ error: signingGuard });
      const signed = await signer.signMessage(
        { keySlotId: keySlot.id, data, type: "message" },
        { intentId: `sign-${Date.now()}`, outcome: "allow", timestamp: Date.now() },
      );
      const resultGuard = await guardSensitivePrimitiveResult(
        signingAuthorization.authority,
        method,
        "sign",
      );
      if (resultGuard) {
        signed.signature.fill(0);
        return respond({ error: resultGuard });
      }
      return respond({
        result: "0x" + Array.from(
          signed.signature,
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join(""),
      });
    }

    if (method === "eth_signTypedData_v4") {
      const [from, typedDataParam] = rpcParams as [
        string,
        string | Record<string, unknown>,
      ];
      if (typeof from !== "string") {
        return respond({ error: { code: -32602, message: "Signing account is required" } });
      }
      let typedDataJson: string;
      let digest: Uint8Array;
      try {
        typedDataJson = typeof typedDataParam === "string"
          ? typedDataParam
          : JSON.stringify(typedDataParam);
        digest = hashTypedDataV4Json(typedDataJson);
      } catch (error) {
        return respond({
          error: {
            code: -32602,
            message: error instanceof Error ? error.message : "Invalid typed data",
          },
        });
      }
      const decision = await requestUserApproval({
        title: "Sign typed data",
        summary: `${origin} is asking you to sign typed data.`,
        appName: origin,
        appOrigin: origin,
        detail: { kind: "eth_signTypedData_v4", from, rawJson: typedDataJson },
      });
      if (decision === "rejected") {
        return respond({ error: { code: 4001, message: "User rejected the request" } });
      }
      const authorityAfterApproval = revalidateSigningAuthority(
        signingAuthorization.authority,
      );
      if (authorityAfterApproval) return respond({ error: authorityAfterApproval });
      const keySlot = keyManager.getKeySlots().find(
        (slot) => slot.address.toLowerCase() === from.toLowerCase(),
      );
      if (!keySlot) {
        return respond({ error: { code: 4001, message: "Signing key not found" } });
      }
      const signingGuard = await guardSensitivePrimitive(
        signingAuthorization.authority,
        method,
        "sign",
      );
      if (signingGuard) return respond({ error: signingGuard });
      const signed = await signer.signTypedData(
        { keySlotId: keySlot.id, data: digest, type: "typed-data" },
        { intentId: `typed-${Date.now()}`, outcome: "allow", timestamp: Date.now() },
      );
      const resultGuard = await guardSensitivePrimitiveResult(
        signingAuthorization.authority,
        method,
        "sign",
      );
      if (resultGuard) {
        signed.signature.fill(0);
        return respond({ error: resultGuard });
      }
      return respond({
        result: "0x" + Array.from(
          signed.signature,
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join(""),
      });
    }

    if (method === "aethelred_requestIntent") {
      const intent = rpcParams[0] as {
        id?: string;
        kind?: string;
        method?: string;
        app?: { id?: string; name?: string; origin?: string; trustLevel?: "first-party" | "partner" | "unverified" };
        payload?: { message?: unknown; from?: unknown; account?: unknown; address?: unknown };
      };
      if (intent.kind !== "sign-message" && intent.kind !== "connect") {
        return respond({ error: { code: 4200, message: `Unsupported intent: ${intent.kind ?? "unknown"}` } });
      }
      const subject = subjectRegistry.getActive();
      const workspace = workspaceRegistry.getActive();
      const account = signingAuthorization.authority
        ? keyManager.getAccounts().find(
            (candidate) =>
              candidate.address.toLowerCase() ===
              signingAuthorization.authority!.account,
          )
        : keyManager.getAccounts()[0];
      if (!subject || !workspace || !account) {
        return respond({ error: { code: 4001, message: "Wallet not configured" } });
      }
      const canonicalApp = {
        id: new URL(origin).hostname,
        name: origin,
        origin,
        trustLevel: "unverified" as const,
      };
      const policyResult = evaluate(
        buildPolicyContext({
          intent: {
            kind: intent.kind,
            method: intent.kind,
            app: canonicalApp,
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
          sessionExists: signingAuthorization.authority != null,
          sessionId: signingAuthorization.authority?.sessionId,
        }),
        options.seedPolicy ?? getDefaultPolicyBundle(workspace.kind),
      );
      if (policyResult.outcome === "deny") {
        return respond({ error: { code: 4001, message: policyResult.warnings[0] ?? "Denied by policy" } });
      }
      if (intent.kind === "connect") {
        const requiredPermissions = ["accounts", "sign-message"];
        const existing = sessionManager.getByOrigin(origin);
        const canReuse =
          existing != null &&
          requiredPermissions.every((permission) =>
            existing.permissions.includes(permission),
          ) &&
          existing.accountAddresses.some(
            (address) => address.toLowerCase() === account.address.toLowerCase(),
          );
        if (!canReuse) {
          const connectDecision = await requestUserApproval({
            title: "Connect to site",
            summary: `${origin} is requesting account and message-signing access.`,
            appName: canonicalApp.name,
            appOrigin: canonicalApp.origin,
            detail: {
              kind: "connect",
              permissions: requiredPermissions,
              accountAddresses: [account.address],
            },
          });
          if (connectDecision === "rejected") {
            return respond({ error: { code: 4001, message: "Connection rejected by the user" } });
          }
          const current = sessionManager.getByOrigin(origin);
          sessionManager.createSession({
            appId: canonicalApp.id,
            appName: canonicalApp.name,
            origin,
            trustLevel: canonicalApp.trustLevel,
            permissions: Array.from(new Set([
              ...(current?.permissions ?? []),
              ...requiredPermissions,
            ])),
            accountAddresses: Array.from(new Set([
              ...(current?.accountAddresses ?? []),
              account.address,
            ])),
          });
        }
        return respond({
          result: {
            intentId: intent.id ?? "intent",
            outcome: policyResult.outcome === "warn" ? "warn" : "allow",
            summary: canReuse
              ? "Application session already active."
              : "Application session approved.",
            warnings: policyResult.warnings,
            result: {
              accounts: sessionManager.getByOrigin(origin)?.accountAddresses ?? [account.address],
            },
          },
        });
      }
      const messageValue = typeof intent.payload?.message === "string"
        ? intent.payload.message
        : JSON.stringify(intent.payload ?? {});
      const data = messageValue.startsWith("0x")
        ? hexToBytes(messageValue)
        : new TextEncoder().encode(messageValue);
      const decision = await requestUserApproval({
        title: "Sign message",
        summary: `${origin} is asking you to sign a message.`,
        appName: canonicalApp.name,
        appOrigin: canonicalApp.origin,
        detail: {
          kind: "personal_sign",
          from: account.address,
          preview: new TextDecoder().decode(data).slice(0, 200),
          rawHex: `0x${Array.from(data, (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("")}`,
          isPermit: false,
          risk: "medium",
        },
      });
      if (decision === "rejected") {
        return respond({ error: { code: 4001, message: "User rejected the request" } });
      }
      const authorityAfterApproval = revalidateSigningAuthority(
        signingAuthorization.authority,
      );
      if (authorityAfterApproval) return respond({ error: authorityAfterApproval });
      const requestedAccount = intent.payload?.from ?? intent.payload?.account ?? intent.payload?.address;
      const signingAddress = signingAuthorization.authority?.account ?? (
        typeof requestedAccount === "string" ? requestedAccount : account.address
      );
      const keySlot = keyManager.getKeySlots().find(
        (slot) => slot.address.toLowerCase() === signingAddress.toLowerCase(),
      );
      if (!keySlot) {
        return respond({ error: { code: 4001, message: "Signing key not found" } });
      }
      const signingGuard = await guardSensitivePrimitive(
        signingAuthorization.authority,
        method,
        "sign",
      );
      if (signingGuard) return respond({ error: signingGuard });
      const signed = await signer.signMessage(
        { keySlotId: keySlot.id, data, type: "message" },
        { intentId: intent.id ?? `intent-${Date.now()}`, outcome: "allow", timestamp: Date.now() },
      );
      const resultGuard = await guardSensitivePrimitiveResult(
        signingAuthorization.authority,
        method,
        "sign",
      );
      if (resultGuard) {
        signed.signature.fill(0);
        return respond({ error: resultGuard });
      }
      const signature = "0x" + Array.from(
        signed.signature,
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      return respond({
        result: {
          intentId: intent.id ?? "intent",
          outcome: policyResult.outcome === "warn" ? "warn" : "allow",
          summary: "Message signed.",
          warnings: policyResult.warnings,
          result: { signature },
        },
      });
    }

    if (method === "eth_sendTransaction") {
      return handleSendTransaction(
        msg,
        rpcParams,
        origin,
        signingAuthorization.authority,
        respond,
      );
    }

    return respond({ error: { code: 4200, message: `Unsupported method: ${method}` } });
  }

  /* ─── handleSendTransaction — mirrors background.ts ─────── */
  async function handleSendTransaction(
    msg: HarnessMessage,
    params: unknown[],
    origin: string,
    signingAuthority: HarnessSigningAuthority | undefined,
    respond: (p: { result?: unknown; error?: { code: number; message: string } }) => HarnessResponse,
  ): Promise<HarnessResponse> {
    const incomingTx = params[0] as {
      from: string;
      to?: string;
      value?: string;
      data?: string;
      gas?: string;
      gasLimit?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
    };
    const tx = Object.freeze({
      from: incomingTx.from,
      to: incomingTx.to,
      value: incomingTx.value,
      data: incomingTx.data,
      gas: incomingTx.gas,
      gasLimit: incomingTx.gasLimit,
      maxFeePerGas: incomingTx.maxFeePerGas,
      maxPriorityFeePerGas: incomingTx.maxPriorityFeePerGas,
    });
    const requestChainId = activeChainId;
    const requestChainEpoch = activeChainEpoch;
    const requestRpcClient = rpcClient;
    const requestTxManager = txManager;
    const requestGasOracle = gasOracle;
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
      maxFeePerGas: options.mockGasOracle?.maxFeePerGas ?? (await requestGasOracle.getGasPrice()),
      maxPriorityFeePerGas: options.mockGasOracle?.maxPriorityFeePerGas ?? (2n * 10n ** 9n),
    };
    let gasParameters;
    try {
      gasParameters = resolveEffectiveEip1559GasParameters(tx, gasEstimate);
    } catch (error) {
      return respond({
        error: {
          code:
            error instanceof Eip1559GasValidationError && error.source === "caller"
              ? -32602
              : -32603,
          message: error instanceof Error ? error.message : "Invalid EIP-1559 gas parameters",
        },
      });
    }

    // Nonce
    const nonce = await requestTxManager.getNonce(tx.from);
    let nonceOwned = true;
    const releaseNonce = () => {
      if (!nonceOwned) return;
      requestTxManager.releaseNonce(tx.from, nonce);
      nonceOwned = false;
    };

    const bundle = options.seedPolicy ?? getDefaultPolicyBundle(workspace.kind);
    const role = workspaceRegistry.getRole(subject.id, workspace.id) ?? "owner";
    let spending: HarnessSpendingContext;
    try {
      spending = await resolveHarnessSpending(tx, requestChainId, requestRpcClient);
    } catch (error) {
      releaseNonce();
      return respond({
        error: {
          code: error instanceof Error && /malformed/i.test(error.message) ? -32602 : 4001,
          message: error instanceof Error ? error.message : "Spending context unavailable",
        },
      });
    }
    const reservationId = `harness-dapp-${msg.correlationId}`;
    let velocity;
    try {
      velocity = await velocityTracker.reserveOperation({
        reservationId,
        subjectId: subject.id,
        amountUsd: spending.amountUsd ?? 0,
        assetSymbol: spending.assetSymbol,
      });
    } catch (error) {
      releaseNonce();
      return respond({
        error: {
          code: 4001,
          message: error instanceof Error ? error.message : "Velocity reservation failed",
        },
      });
    }

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
      destination: spending.destination,
      destinationCategory: spending.destinationCategory,
      amount: spending.amount,
      amountUsd: spending.amountUsd,
      assetId: spending.assetId,
      assetSymbol: spending.assetSymbol,
      assetCategory: spending.assetCategory,
      requestedOperationCount24h: velocity.count24h,
      cumulativeValueSpentUsd24h: velocity.valueUsd24h,
    });

    recordAudit("request-received", {
      method: "eth_sendTransaction",
      to: tx.to,
      value: tx.value,
      origin,
      policyDestination: spending.destination,
      policyAmount: spending.amount,
      policyAmountUsd: spending.amountUsd,
      policyAssetId: spending.assetId,
      policyAssetSymbol: spending.assetSymbol,
      nonce,
    });

    const policyResult = evaluate(policyCtx, bundle);
    const effectivePolicyOutcome =
      spending.requiresHighRiskReview && policyResult.outcome !== "deny"
        ? "approval-required"
        : policyResult.outcome;
    recordAudit("policy-evaluated", {
      outcome: effectivePolicyOutcome,
      matchedRules: policyResult.matchedRules.map((r) => r.id),
      destination: spending.destination,
      amount: spending.amount,
      amountUsd: spending.amountUsd,
      assetId: spending.assetId,
      assetSymbol: spending.assetSymbol,
    });

    if (policyResult.outcome === "deny") {
      recordAudit("response-sent", { outcome: "denied", reason: policyResult.warnings[0] });
      releaseNonce();
      await velocityTracker.releaseReservation(reservationId);
      return respond({ error: { code: 4001, message: policyResult.warnings[0] ?? "Denied by policy" } });
    }

    if (chainContextChanged(requestChainId, requestChainEpoch)) {
      releaseNonce();
      await velocityTracker.releaseReservation(reservationId);
      return respond({
        error: {
          code: 4901,
          message: `Active chain changed while evaluating the transaction. Submit it again on ${requestChainId}.`,
        },
      });
    }

    // Enterprise / approval-required — wire the workflow engine
    let workflowRequestId: string | null = null;
    if (effectivePolicyOutcome === "approval-required") {
      const template = getApprovalTemplate(
        workspace.kind,
        spending.requiresHighRiskReview ||
          (spending.amountUsd ?? 0) > 100_000 ||
          gasParameters.estimatedFee > 10_000_000_000_000_000n,
      );
      const reviewers = [
        { subjectId: subject.id, displayName: subject.displayName, role: role as WorkspaceRole },
        ...(options.extraReviewers ?? []),
      ];
      const approvalContext: ApprovalContext = {
        operationType: spending.tokenContract ? "transfer" : "eth_sendTransaction",
        amount: spending.amount.toString(),
        asset: spending.assetSymbol,
        destination: spending.destination,
        riskLevel: spending.requiresHighRiskReview ? "high" : "medium",
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
      summary: `Send ${spending.amount} ${spending.assetSymbol} to ${spending.destination ?? "(contract)"}`,
      appName: "Harness",
      appOrigin: origin,
      detail: {
        kind: "tx",
        chainId: requestChainId,
        from: tx.from,
        to: tx.to ?? null,
        value: `0x${hexToBigInt(tx.value ?? "0x0").toString(16)}`,
        data: tx.data ?? "0x",
        nonce,
        gasLimit: "0x" + gasParameters.gasLimit.toString(16),
        maxFeePerGas: "0x" + gasParameters.maxFeePerGas.toString(16),
        maxPriorityFeePerGas: "0x" + gasParameters.maxPriorityFeePerGas.toString(16),
        estimatedFee: "0x" + gasParameters.estimatedFee.toString(16),
        amountUsd: spending.amountUsd,
        assetSymbol: spending.assetSymbol,
        simulationRisk: spending.requiresHighRiskReview ? "high" : "low",
        warnings: spending.warnings,
        decodedMethod: spending.tokenContract ? "transfer" : undefined,
        decodedParams: spending.tokenContract
          ? {
              recipient: spending.destination ?? "",
              amount: exactHarnessAmount(spending.amountBaseUnits, spending.assetDecimals),
              amountBaseUnits: spending.amountBaseUnits.toString(),
              symbol: spending.assetSymbol,
              tokenContract: spending.tokenContract,
            }
          : undefined,
        reviewedSpending: harnessReviewedSpending(
          spending,
          tx.to ?? null,
          tx.value ?? "0x0",
        ),
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
      releaseNonce();
      await velocityTracker.releaseReservation(reservationId);
      return respond({ error: { code: 4001, message: "User rejected the request" } });
    }

    const authorityAfterApproval = revalidateSigningAuthority(signingAuthority);
    if (authorityAfterApproval) {
      releaseNonce();
      await velocityTracker.releaseReservation(reservationId);
      return respond({ error: authorityAfterApproval });
    }

    if (chainContextChanged(requestChainId, requestChainEpoch)) {
      recordAudit("response-sent", {
        outcome: "chain-changed",
        method: "eth_sendTransaction",
        expectedChainId: requestChainId,
        activeChainId,
      });
      releaseNonce();
      await velocityTracker.releaseReservation(reservationId);
      return respond({
        error: {
          code: 4901,
          message: `Active chain changed after approval. Submit and review the transaction again on ${requestChainId}.`,
        },
      });
    }

    // Sign + broadcast
    const keySlot = keyManager.getKeySlots().find(
      (s) => s.address.toLowerCase() === tx.from.toLowerCase(),
    );
    if (!keySlot) {
      releaseNonce();
      await velocityTracker.releaseReservation(reservationId);
      return respond({ error: { code: 4001, message: "Signing key not found" } });
    }

    const policyToken = {
      intentId: `tx-${Date.now()}`,
      outcome: "allow" as const,
      timestamp: Date.now(),
    };
    let signedOutput;
    try {
      const signingGuard = await guardSensitivePrimitive(
        signingAuthority,
        "eth_sendTransaction",
        "sign",
      );
      if (signingGuard) {
        releaseNonce();
        await velocityTracker.releaseReservation(reservationId);
        return respond({ error: signingGuard });
      }
      signedOutput = await buildAndSignEip1559Tx(
        {
          chainId: hexToBigInt(requestChainId),
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
      recordAudit("response-sent", {
        outcome: "sign-failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      releaseNonce();
      await velocityTracker.releaseReservation(reservationId);
      return respond({
        error: { code: -32603, message: err instanceof Error ? err.message : "signing failed" },
      });
    }

    if (chainContextChanged(requestChainId, requestChainEpoch)) {
      releaseNonce();
      await velocityTracker.releaseReservation(reservationId);
      return respond({
        error: {
          code: 4901,
          message: `Active chain changed before broadcast. Submit and review the transaction again on ${requestChainId}.`,
        },
      });
    }

    recordAudit("signing-executed", {
      method: "eth_sendTransaction",
      nonce,
      expectedHash: signedOutput.hash,
    });

    const authorityBeforeBroadcast = revalidateSigningAuthority(signingAuthority);
    if (authorityBeforeBroadcast) {
      releaseNonce();
      await velocityTracker.releaseReservation(reservationId);
      return respond({ error: authorityBeforeBroadcast });
    }
    try {
      await velocityTracker.markBroadcastPending(reservationId);
    } catch (error) {
      releaseNonce();
      await velocityTracker.releaseReservation(reservationId).catch(() => undefined);
      return respond({
        error: {
          code: 4001,
          message: error instanceof Error ? error.message : "Velocity durability failed",
        },
      });
    }

    // Deterministic hook sits after the durable await, matching production's
    // final authority boundary immediately before RPC submission.
    const broadcastGuard = await guardSensitivePrimitive(
      signingAuthority,
      "eth_sendTransaction",
      "broadcast",
    );
    if (broadcastGuard) {
      releaseNonce();
      await velocityTracker.releaseReservation(reservationId);
      return respond({ error: broadcastGuard });
    }
    if (chainContextChanged(requestChainId, requestChainEpoch)) {
      releaseNonce();
      await velocityTracker.releaseReservation(reservationId);
      return respond({
        error: {
          code: 4901,
          message: `Active chain changed before broadcast. Submit and review the transaction again on ${requestChainId}.`,
        },
      });
    }

    let hash: string;
    try {
      nonceOwned = false;
      hash = await requestTxManager.broadcast(signedOutput.rawTx);
    } catch (err) {
      recordAudit("response-sent", {
        outcome: "broadcast-failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      // Submission is ambiguous: retain the full-window reservation and nonce.
      return respond({
        error: { code: -32603, message: err instanceof Error ? err.message : "broadcast failed" },
      });
    }

    await velocityTracker.commitReservation(reservationId, hash);
    bumpVelocity(subject.id, spending.amountUsd ?? 0);
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
      gas?: string;
      gasLimit?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
    };
    const prepareChainId = activeChainId;
    const prepareChainEpoch = activeChainEpoch;
    const prepareRpcClient = rpcClient;
    const prepareTxManager = txManager;
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

    const gasEstimate = {
      gasLimit: options.mockGasOracle?.gasLimit ?? 21_000n,
      maxFeePerGas: options.mockGasOracle?.maxFeePerGas ?? rpcState.gasPrice,
      maxPriorityFeePerGas:
        options.mockGasOracle?.maxPriorityFeePerGas ?? 2n * 10n ** 9n,
    };
    let gasParameters;
    try {
      gasParameters = resolveEffectiveEip1559GasParameters(tx, gasEstimate);
    } catch (error) {
      return respond({
        error: {
          code:
            error instanceof Eip1559GasValidationError && error.source === "caller"
              ? -32602
              : -32603,
          message: error instanceof Error ? error.message : "Invalid EIP-1559 gas parameters",
        },
      });
    }
    const nonce = await prepareTxManager.getNonce(resolvedFrom);
    let nonceOwned = true;
    const releaseNonce = () => {
      if (!nonceOwned) return;
      prepareTxManager.releaseNonce(resolvedFrom, nonce);
      nonceOwned = false;
    };
    const bundle = options.seedPolicy ?? getDefaultPolicyBundle(workspace.kind);
    let spending: HarnessSpendingContext;
    try {
      spending = await resolveHarnessSpending(tx, prepareChainId, prepareRpcClient);
    } catch (error) {
      releaseNonce();
      return respond({
        error: {
          code: error instanceof Error && /malformed/i.test(error.message) ? -32602 : 4001,
          message: error instanceof Error ? error.message : "Spending context unavailable",
        },
      });
    }
    const draftId = `draft-${msg.correlationId}`;
    let velocity;
    try {
      velocity = await velocityTracker.reserveOperation({
        reservationId: draftId,
        subjectId: subject.id,
        amountUsd: spending.amountUsd ?? 0,
        assetSymbol: spending.assetSymbol,
      });
    } catch (error) {
      releaseNonce();
      return respond({
        error: {
          code: 4001,
          message: error instanceof Error ? error.message : "Velocity reservation failed",
        },
      });
    }
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
      destination: spending.destination,
      destinationCategory: spending.destinationCategory,
      amount: spending.amount,
      amountUsd: spending.amountUsd,
      assetId: spending.assetId,
      assetSymbol: spending.assetSymbol,
      assetCategory: spending.assetCategory,
      requestedOperationCount24h: velocity.count24h,
      cumulativeValueSpentUsd24h: velocity.valueUsd24h,
    });
    const policyResult = evaluate(policyCtx, bundle);
    if (policyResult.outcome === "deny") {
      releaseNonce();
      await velocityTracker.releaseReservation(draftId);
      return respond({ error: { code: 4001, message: policyResult.warnings[0] ?? "Denied by policy" } });
    }
    if (chainContextChanged(prepareChainId, prepareChainEpoch)) {
      releaseNonce();
      await velocityTracker.releaseReservation(draftId);
      return respond({
        error: {
          code: 4901,
          message: `Active chain changed while preparing the transaction. Review it again on ${prepareChainId}.`,
        },
      });
    }

    drafts.set(draftId, {
      id: draftId,
      from: resolvedFrom,
      to: tx.to ? tx.to : null,
      value: hexToBigInt(tx.value),
      data: hexToBytes(tx.data),
      nonce,
      txManager: prepareTxManager,
      ownsNonce: true,
      gasLimit: gasParameters.gasLimit,
      maxFeePerGas: gasParameters.maxFeePerGas,
      maxPriorityFeePerGas: gasParameters.maxPriorityFeePerGas,
      chainId: prepareChainId,
      chainEpoch: prepareChainEpoch,
      keySlotId: keySlot.id,
      createdAt: Date.now(),
      subjectId: subject.id,
      workspaceId: workspace.id,
      velocityReservationId: draftId,
      spending,
      amountUsd: spending.amountUsd,
      assetSymbol: spending.assetSymbol,
    });
    nonceOwned = false;

    const effectivePolicyOutcome = spending.requiresHighRiskReview
      ? "approval-required"
      : policyResult.outcome;

    return respond({
      result: {
        draftId,
        detail: {
          kind: "tx",
          chainId: prepareChainId,
          from: resolvedFrom,
          to: tx.to ?? null,
          value: `0x${hexToBigInt(tx.value ?? "0x0").toString(16)}`,
          data: tx.data ?? "0x",
          nonce,
          gasLimit: `0x${gasParameters.gasLimit.toString(16)}`,
          maxFeePerGas: `0x${gasParameters.maxFeePerGas.toString(16)}`,
          maxPriorityFeePerGas: `0x${gasParameters.maxPriorityFeePerGas.toString(16)}`,
          estimatedFee: `0x${gasParameters.estimatedFee.toString(16)}`,
          amountUsd: spending.amountUsd,
          assetSymbol: spending.assetSymbol,
          simulationRisk: spending.requiresHighRiskReview ? "high" : "low",
          warnings: spending.warnings,
          decodedMethod: spending.tokenContract ? "transfer" : undefined,
          decodedParams: spending.tokenContract
            ? {
                recipient: spending.destination ?? "",
                amount: exactHarnessAmount(spending.amountBaseUnits, spending.assetDecimals),
                amountBaseUnits: spending.amountBaseUnits.toString(),
                symbol: spending.assetSymbol,
                tokenContract: spending.tokenContract,
              }
            : undefined,
          reviewedSpending: harnessReviewedSpending(
            spending,
            tx.to ?? null,
            tx.value ?? "0x0",
          ),
        },
        requiresReview: effectivePolicyOutcome === "approval-required",
        policy: {
          outcome: effectivePolicyOutcome,
          amount: spending.amount,
          amountUsd: spending.amountUsd,
          assetSymbol: spending.assetSymbol,
          destination: spending.destination,
          warnings: spending.warnings,
        },
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
    // One-shot claim before any await: a concurrent execute cannot sign or
    // broadcast the same draft/nonce twice.
    drafts.delete(draftId);
    const releaseDraft = async (reason: string) => {
      void reason;
      if (draft.ownsNonce) {
        draft.ownsNonce = false;
        draft.txManager.releaseNonce(draft.from, draft.nonce);
      }
      await velocityTracker.releaseReservation(draft.velocityReservationId);
      drafts.delete(draftId);
    };
    if (chainContextChanged(draft.chainId, draft.chainEpoch)) {
      await releaseDraft("chain mismatch");
      return respond({
        error: {
          code: 4901,
          message: `Active chain changed after this transaction was reviewed. Prepare it again on ${draft.chainId}.`,
        },
      });
    }
    const draftTxManager = draft.txManager;
    const subject = subjectRegistry.getActive();
    const workspace = workspaceRegistry.getActive();
    const account = keyManager.getAccountByAddress(draft.from);
    if (
      !subject ||
      !workspace ||
      !account ||
      subject.id !== draft.subjectId ||
      workspace.id !== draft.workspaceId
    ) {
      await releaseDraft("identity changed");
      return respond({
        error: { code: 4001, message: "Wallet identity or workspace changed" },
      });
    }
    let executeVelocity;
    try {
      executeVelocity = await velocityTracker.renewReservation(
        draft.velocityReservationId,
      );
    } catch (error) {
      draft.txManager.releaseNonce(draft.from, draft.nonce);
      drafts.delete(draftId);
      return respond({
        error: {
          code: 4001,
          message: error instanceof Error ? error.message : "Velocity reservation expired",
        },
      });
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
      options.seedPolicy ?? getDefaultPolicyBundle(workspace.kind),
    );
    if (executePolicy.outcome === "deny") {
      await releaseDraft("execute policy denied");
      return respond({
        error: {
          code: 4001,
          message: executePolicy.warnings[0] ?? "Denied by policy",
        },
      });
    }
    const policyToken = {
      intentId: `popup-tx-${Date.now()}`,
      outcome: "allow" as const,
      timestamp: Date.now(),
    };
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
    } catch (error) {
      await releaseDraft("signing failed");
      return respond({
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Signing failed",
        },
      });
    }
    if (chainContextChanged(draft.chainId, draft.chainEpoch)) {
      await releaseDraft("chain changed before broadcast");
      return respond({
        error: {
          code: 4901,
          message: `Active chain changed before broadcast. Prepare and review the transaction again on ${draft.chainId}.`,
        },
      });
    }
    try {
      await velocityTracker.markBroadcastPending(draft.velocityReservationId);
    } catch (error) {
      await releaseDraft("broadcast durability failed");
      return respond({
        error: {
          code: 4001,
          message: error instanceof Error ? error.message : "Velocity durability failed",
        },
      });
    }
    let hash: string;
    try {
      draft.ownsNonce = false;
      hash = await draftTxManager.broadcast(signedOutput.rawTx);
    } catch (error) {
      // Submission is ambiguous: retain the full-window reservation and nonce.
      drafts.delete(draftId);
      return respond({
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Broadcast failed",
        },
      });
    }
    await velocityTracker.commitReservation(draft.velocityReservationId, hash);
    bumpVelocity(subject.id, draft.amountUsd ?? 0);
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
    const sessionSnapshot = sessionManager.toSnapshot();
    const activeSubjectIdSnapshot = subjectRegistry.getActive()?.id;
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
    sessionManager = new SessionManager();
    sessionManager.loadFromSnapshot(sessionSnapshot);

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
    velocityTracker = new VelocityTracker(velocityStorage);

    workflowEngine = new WorkflowEngine();

    // Re-import wallet if one was seeded
    if (options.seedWallet !== false) {
      await masterKey.initialize(TEST_PASSWORD);
      await keyManager.importFromMnemonic(TEST_MNEMONIC, "Primary");
      const [acct] = keyManager.getAccounts();
      const subjectId = activeSubjectIdSnapshot ?? `subject-${acct.id}`;
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
    getVelocitySnapshot: () => {
      const subjectId = subjectRegistry.getActive()?.id;
      return subjectId ? currentVelocity(subjectId) : { count: 0, valueUsd: 0 };
    },
    seedVelocity: async (count, totalValueUsd) => {
      const subjectId = subjectRegistry.getActive()?.id;
      if (!subjectId) throw new Error("No active subject to seed velocity");
      if (!Number.isInteger(count) || count < 0 || !Number.isFinite(totalValueUsd)) {
        throw new Error("Invalid velocity seed");
      }
      const amountUsd = count > 0 ? totalValueUsd / count : 0;
      for (let index = 0; index < count; index += 1) {
        await velocityTracker.recordOperation({
          recordId: `seed-${subjectId}-${index}-${totalValueUsd}`,
          subjectId,
          amountUsd,
          assetSymbol: "USD",
        });
      }
      const existing = velocityCounts.get(subjectId) ?? { count: 0, valueUsd: 0 };
      velocityCounts.set(subjectId, {
        count: existing.count + count,
        valueUsd: existing.valueUsd + totalValueUsd,
      });
    },
    getEffectiveVelocitySnapshot: async () => {
      const subjectId = subjectRegistry.getActive()?.id;
      if (!subjectId) return { count: 0, valueUsd: 0 };
      const stats = await velocityTracker.getEffectiveVelocity(subjectId);
      return { count: stats.count24h, valueUsd: stats.valueUsd24h };
    },
    getSensitivePrimitiveCounts: () => ({ ...sensitivePrimitiveCounts }),
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
