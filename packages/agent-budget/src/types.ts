/**
 * `@aethelred/wallet-agent-budget` — type surface.
 *
 * Every shape on the wire mirrors the Solidity struct byte-for-byte.
 * Field order, field types, and naming are preserved so the storage
 * layout constants in `abi.ts` remain accurate.
 */

// ─── Budget / Session / Spend ──────────────────────────────────

export interface Budget {
  readonly id: bigint;
  readonly owner: `0x${string}`;
  /** ERC-20 contract address, or `0x000…000` for native value. */
  readonly asset: `0x${string}`;
  /** Spend cap per rolling window, in smallest unit. */
  readonly dailyCap: bigint;
  /** Hard cap on any single `spend()` call, in smallest unit. */
  readonly perTxCap: bigint;
  /** Duration of the rolling window, in seconds. */
  readonly windowSeconds: bigint;
  /** Unix timestamp anchoring the current window. */
  readonly windowStart: bigint;
  /** Running spend in the current window. */
  readonly spentInWindow: bigint;
  /** All-time total (audit). */
  readonly lifetimeSpent: bigint;
  /** `true` once the owner has revoked the budget. */
  readonly revoked: boolean;
}

export interface Session {
  readonly budgetId: bigint;
  readonly sessionKey: `0x${string}`;
  /** Unix timestamp after which the session is void. */
  readonly expiresAt: bigint;
  /** Per-call cap (≤ `budget.perTxCap`). */
  readonly perCallCap: bigint;
  readonly revoked: boolean;
}

/**
 * The single-view pre-flight check result. Mirrors the `canSpend`
 * view on-chain — clients run it as a dry-run before submitting a
 * UserOp / transaction that would call `spend`.
 */
export interface CanSpendResult {
  readonly ok: boolean;
  /** On-chain reason byte (0 = ok, 1..8 = failure). */
  readonly reasonByte: number;
  /** Human-readable error code or `"ok"`. */
  readonly reason:
    | "ok"
    | "session-not-found"
    | "session-revoked"
    | "session-expired"
    | "budget-revoked"
    | "per-call-cap-exceeded"
    | "per-tx-cap-exceeded"
    | "daily-cap-exceeded"
    | "zero-amount";
}

// ─── Event records ─────────────────────────────────────────────

/**
 * Decoded on-chain log records. The client exposes a `parseLogs`
 * helper that turns raw eth_getLogs output into this tagged union.
 *
 * `logIndex`, `blockNumber`, `txHash` are normalised `0x…` / bigint
 * so downstream audit storage doesn't have to re-parse hex.
 */
export type AgentBudgetEvent =
  | {
      readonly kind: "budget-created";
      readonly budgetId: bigint;
      readonly owner: `0x${string}`;
      readonly asset: `0x${string}`;
      readonly dailyCap: bigint;
      readonly perTxCap: bigint;
      readonly windowSeconds: bigint;
      readonly txHash: `0x${string}`;
      readonly blockNumber: bigint;
      readonly logIndex: number;
    }
  | {
      readonly kind: "budget-caps-updated";
      readonly budgetId: bigint;
      readonly dailyCap: bigint;
      readonly perTxCap: bigint;
      readonly txHash: `0x${string}`;
      readonly blockNumber: bigint;
      readonly logIndex: number;
    }
  | {
      readonly kind: "budget-revoked";
      readonly budgetId: bigint;
      readonly txHash: `0x${string}`;
      readonly blockNumber: bigint;
      readonly logIndex: number;
    }
  | {
      readonly kind: "session-granted";
      readonly budgetId: bigint;
      readonly sessionKey: `0x${string}`;
      readonly expiresAt: bigint;
      readonly perCallCap: bigint;
      readonly txHash: `0x${string}`;
      readonly blockNumber: bigint;
      readonly logIndex: number;
    }
  | {
      readonly kind: "session-revoked";
      readonly sessionKey: `0x${string}`;
      readonly txHash: `0x${string}`;
      readonly blockNumber: bigint;
      readonly logIndex: number;
    }
  | {
      readonly kind: "spent";
      readonly budgetId: bigint;
      readonly sessionKey: `0x${string}`;
      readonly to: `0x${string}`;
      readonly amount: bigint;
      readonly txHash: `0x${string}`;
      readonly blockNumber: bigint;
      readonly logIndex: number;
    };

// ─── Chain provider ────────────────────────────────────────────

/**
 * Minimal RPC surface the client needs. Implementations wire this to
 * viem / ethers / a custom websocket — the client stays decoupled
 * from a specific RPC library.
 *
 * `call` returns the raw 0x-prefixed hex returned by `eth_call`.
 * `getLogs` returns raw log records in the standard Ethereum JSON
 * shape (topics, data, blockNumber, txHash, logIndex).
 */
export interface ChainProvider {
  readonly chainId: number;
  call(request: { readonly to: `0x${string}`; readonly data: `0x${string}` }): Promise<`0x${string}`>;
  getLogs(filter: {
    readonly address: `0x${string}`;
    readonly topics: ReadonlyArray<`0x${string}` | null>;
    readonly fromBlock?: bigint | "earliest" | "latest";
    readonly toBlock?: bigint | "earliest" | "latest";
  }): Promise<ReadonlyArray<RawLog>>;
}

export interface RawLog {
  readonly topics: ReadonlyArray<`0x${string}`>;
  readonly data: `0x${string}`;
  readonly blockNumber: `0x${string}` | bigint;
  readonly transactionHash: `0x${string}`;
  readonly logIndex: `0x${string}` | number;
}
