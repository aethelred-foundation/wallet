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
 * Today this file ships the typed surface plus a clearly labelled stub
 * for `resolveAllowances` and `subscribeApprovals`. The stub returns an
 * empty list so the popup's empty state renders cleanly, and emits a
 * console line so operators can see the gap. The production
 * implementation plugs in here — the call sites in `background.ts` do
 * not change.
 *
 * When the live resolver lands, drop in:
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

/** Configuration surface for the resolver. Today only the timeout is wired. */
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

  constructor(rpcClient: RpcClient, config: TokenAllowanceResolverConfig = {}) {
    this.rpcClient = rpcClient;
    this.timeoutMs = config.timeoutMs ?? 5_000;
  }

  /**
   * Enumerate current on-chain allowances for `accountAddress` on the
   * given chain.
   *
   * Today: returns an empty array. The stub is fully typed so the
   * `get-token-allowances` bridge handler can be wired immediately —
   * the popup's Token Approvals view renders its empty state, which is
   * the right UX until live discovery lands.
   *
   * TODO(live-resolver): integrate with the block-indexer service so
   * the background does not have to walk every `Approval` log inline.
   * The call surface MUST remain `(address, chainId) => TokenAllowance[]`.
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
    // about unused members — the live resolver wires both in.
    void this.rpcClient;
    void this.timeoutMs;

    console.info(
      "[token-allowance-resolver] live-allowance discovery not yet wired — returning []",
      { accountAddress, chainId },
    );

    // TODO(live-resolver): run the enumerate → reconcile pipeline here.
    return [];
  }

  /**
   * Subscribe to real-time Approval events for `accountAddress`. Today
   * a no-op returning a no-op unsubscribe function. The typed surface
   * is intentional — it makes it obvious where the subscription hook
   * lands when we wire the live resolver.
   *
   * TODO(live-resolver): `eth_subscribe(["logs", { topics: [...] }])`
   * with a debounced `cb` invocation.
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
    void chainId;
    // Silence unused-argument warning — the callback is invoked by the
    // live resolver, not the stub. Production wires real subscription
    // delivery here.
    void callback;
    console.info(
      "[token-allowance-resolver] subscribeApprovals stub — no-op",
      { accountAddress, chainId },
    );
    return () => {
      // No-op unsubscribe.
    };
  }
}
