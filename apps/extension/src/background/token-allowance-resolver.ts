/**
 * TokenAllowanceResolver — typed surface for on-chain ERC-20 `allowance`
 * discovery.
 *
 * Why this file exists
 * ────────────────────
 * The popup's Token Approvals view (see
 * `apps/extension/src/popup/views/token-approvals.tsx`) expects the
 * background to answer `get-token-allowances` with the current on-chain
 * allowances for a given account. The *shape* of that answer is a
 * `TokenAllowance[]` (see `apps/extension/src/popup/hooks/use-token-allowances.ts`).
 *
 * Implementing a correct live-allowance resolver requires:
 *   1. Enumerating every ERC-20 the user has touched (via
 *      `eth_getLogs` on `Transfer`/`Approval` topics, scoped to the
 *      account's address). This fans out many long-running RPC calls.
 *   2. Reconciling each discovered `(token, spender)` pair with the
 *      current `allowance(owner, spender)` call to detect revokes.
 *   3. Resolving the spender label against the
 *      `known-spenders` registry (already implemented).
 *
 * Step 1 is the expensive one and pins the background service worker's
 * event loop for seconds at a time on congested nodes. We cannot safely
 * run it inline in the request/response pipeline — the MV3 SW terminates
 * after ~30 s of inactivity and many RPC endpoints rate-limit
 * aggressively.
 *
 * Today this file ships the typed surface plus a pluggable
 * {@link AllowanceSource}. The default source is
 * {@link EmptyAllowanceSource}, which returns no data so the popup's
 * empty-state renders cleanly. Production deployments inject a real
 * source — either a chain-log scanner or a pre-indexed cache — via
 * {@link TokenAllowanceResolverConfig.source}. The call sites in
 * `background.ts` are unchanged across that swap.
 *
 * @todo GH-ISSUE(token-allowance-live-source): land a production
 *   allowance source. The recipe:
 *   - `enumerateTouchedTokens(address, chainId)` using the chain's
 *     indexed-logs endpoint (or an EOA-address indexer).
 *   - `reconcileLiveAllowance(token, owner, spender)` via a read-only
 *     `eth_call` to `allowance(address,address)`.
 *   - `subscribeApprovals(address, chainId, cb)` via
 *     `eth_subscribe(["logs", { topics: [APPROVAL_TOPIC, pad(address)] }])`.
 */

import type { RpcClient } from "@aethelred/wallet-chain";

/**
 * Shape produced for each resolved allowance. Mirrors the
 * `RawAllowancePayload` that the popup's `enrichAllowance` expects —
 * see `apps/extension/src/popup/hooks/use-token-allowances.ts` for the
 * full contract.
 */
export interface TokenAllowance {
  /** 0x-prefixed ERC-20 contract address. */
  tokenAddress: string;
  /** Token ticker, e.g. "USDC". */
  tokenSymbol: string;
  /** Token display name, e.g. "USD Coin". */
  tokenName: string;
  /** Number of token decimals. */
  tokenDecimals?: number;
  /** Optional logo URL. */
  tokenLogo?: string;
  /** Address of the contract allowed to spend. */
  spenderAddress: string;
  /**
   * Raw allowance amount as a decimal or 0x-prefixed hex string. The
   * popup enriches this into a formatted string + unlimited flag.
   */
  allowanceRaw: string;
  /** Unix timestamp (ms) at which this allowance was last observed on-chain. */
  lastUpdated: number;
  /** Chain id the allowance was granted on. */
  chainId: number;
  /** Optional USD value of the raw allowance amount, if a price is known. */
  allowanceUsd?: number;
}

/**
 * Pluggable source of current on-chain allowances.
 *
 * Decouples the resolver from any single discovery strategy: a
 * chain-log scanner, a pre-indexed cache service, a background
 * subgraph client — all of them are valid {@link AllowanceSource}
 * implementations.
 *
 * The default {@link EmptyAllowanceSource} returns an empty list and
 * a no-op subscription, which yields the wallet's "no allowances"
 * empty-state without blocking the service worker on RPC fan-out.
 *
 * @todo GH-ISSUE(token-allowance-live-source): land a production
 *   allowance source. Candidates: (a) chain-log scanner using
 *   `eth_getLogs` batched against the active RPC, (b) indexed-cache
 *   reader backed by a signed snapshot from a first-party indexer.
 */
export interface AllowanceSource {
  /** Short identifier shown in logs — e.g. `"empty"`, `"chain-logs"`. */
  readonly name: string;
  /** Enumerate current allowances for `accountAddress` on `chainId`. */
  listAllowances(
    accountAddress: string,
    chainId: number,
  ): Promise<TokenAllowance[]>;
  /**
   * Subscribe to real-time Approval changes. The returned function
   * unsubscribes. Sources without a streaming channel may return a
   * no-op.
   */
  subscribe(
    accountAddress: string,
    chainId: number,
    callback: (allowance: TokenAllowance) => void,
  ): () => void;
}

/**
 * Default allowance source — returns no data and warns. Production
 * deployments MUST replace this via
 * {@link TokenAllowanceResolverConfig.source}.
 */
export class EmptyAllowanceSource implements AllowanceSource {
  readonly name = "empty";
  async listAllowances(
    accountAddress: string,
    chainId: number,
  ): Promise<TokenAllowance[]> {
    console.info(
      "[token-allowance-resolver] EmptyAllowanceSource — returning []",
      { accountAddress, chainId },
    );
    return [];
  }
  subscribe(
    accountAddress: string,
    chainId: number,
    _callback: (allowance: TokenAllowance) => void,
  ): () => void {
    console.info(
      "[token-allowance-resolver] EmptyAllowanceSource.subscribe — no-op",
      { accountAddress, chainId },
    );
    return () => {
      /* no-op unsubscribe */
    };
  }
}

/** Configuration surface for the resolver. */
export interface TokenAllowanceResolverConfig {
  /**
   * Maximum number of ms to spend aggregating allowances for a single
   * `resolveAllowances` call. Default 5000 — exceeds this, partial
   * results (possibly empty) are returned. Prevents unbounded work in
   * the service worker.
   */
  timeoutMs?: number;
  /**
   * Override the block range walked when scanning Approval logs. Used
   * by tests to pin deterministic results. Default `undefined` — the
   * production resolver picks a sensible default per chain.
   */
  logsFromBlock?: string;
  /**
   * Source the resolver delegates discovery + subscription to. Default
   * is {@link EmptyAllowanceSource}.
   */
  source?: AllowanceSource;
}

/**
 * Typed error raised for resolver misconfiguration. Transient RPC
 * failures are swallowed and surfaced as empty results instead — the
 * popup's error banner would be more noise than signal for what is
 * effectively best-effort data.
 */
export class TokenAllowanceResolverError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TokenAllowanceResolverError";
    this.code = code;
  }
}

/**
 * Background-scoped resolver used by the `get-token-allowances` bridge
 * handler. Stub today; the plug-in point lives in
 * {@link TokenAllowanceResolver.resolveAllowances}.
 *
 * @example
 * ```ts
 * const resolver = new TokenAllowanceResolver(rpcClient);
 * const allowances = await resolver.resolveAllowances(accountAddress, chainId);
 * ```
 */
export class TokenAllowanceResolver {
  private readonly rpcClient: RpcClient;
  private readonly timeoutMs: number;
  private readonly source: AllowanceSource;

  constructor(rpcClient: RpcClient, config: TokenAllowanceResolverConfig = {}) {
    this.rpcClient = rpcClient;
    this.timeoutMs = config.timeoutMs ?? 5_000;
    this.source = config.source ?? new EmptyAllowanceSource();
  }

  /**
   * Enumerate current on-chain allowances for `accountAddress` on the
   * given chain. Delegates to the configured {@link AllowanceSource}.
   *
   * @param accountAddress - 0x-prefixed owner EOA whose allowances to list.
   * @param chainId - EVM chain id the request targets.
   */
  async resolveAllowances(
    accountAddress: string,
    chainId: number,
  ): Promise<TokenAllowance[]> {
    if (!accountAddress || !accountAddress.startsWith("0x")) {
      throw new TokenAllowanceResolverError(
        "INVALID_ADDRESS",
        `accountAddress must be 0x-prefixed, got: ${String(accountAddress)}`,
      );
    }
    if (!Number.isInteger(chainId) || chainId < 0) {
      throw new TokenAllowanceResolverError(
        "INVALID_CHAIN_ID",
        `chainId must be a non-negative integer, got: ${String(chainId)}`,
      );
    }

    // Touch `rpcClient` + `timeoutMs` so the TS compiler doesn't warn
    // about unused members — the live source picks them up via a
    // shared context later (see the live-source issue).
    void this.rpcClient;
    void this.timeoutMs;

    return this.source.listAllowances(accountAddress, chainId);
  }

  /**
   * Subscribe to real-time Approval events for `accountAddress`.
   * Delegates to the configured {@link AllowanceSource} — the
   * {@link EmptyAllowanceSource} is a no-op.
   */
  subscribeApprovals(
    accountAddress: string,
    chainId: number,
    callback: (allowance: TokenAllowance) => void,
  ): () => void {
    if (!accountAddress || !accountAddress.startsWith("0x")) {
      throw new TokenAllowanceResolverError(
        "INVALID_ADDRESS",
        `accountAddress must be 0x-prefixed, got: ${String(accountAddress)}`,
      );
    }
    return this.source.subscribe(accountAddress, chainId, callback);
  }
}
