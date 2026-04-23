/**
 * `BudgetClient` — high-level interface to an on-chain AgentBudget
 * deployment.
 *
 * Responsibilities:
 *
 *   - Expose `canSpend(sessionKey, amount)` and `remainingInWindow
 *     (budgetId)` as ergonomic async methods (calldata + eth_call +
 *     decode).
 *   - Produce ready-to-submit calldata for every write path
 *     (`createBudget`, `updateCaps`, `revokeBudget`, `grantSession`,
 *     `revokeSession`, `spend`).
 *   - Decode on-chain logs into `AgentBudgetEvent[]` for audit.
 *
 * What this client DOES NOT do:
 *
 *   - Actually submit transactions. Callers pass the returned
 *     calldata to their signer / bundler / wallet-core. We keep the
 *     signing out of this package so the same client works under
 *     EOA flows, ERC-4337 user-ops, and paymaster-sponsored flows
 *     without branching.
 *   - Wire a specific RPC library. A `ChainProvider` interface is
 *     consumed; production callers plug viem / ethers / their own
 *     JSON-RPC client behind it.
 */

import type { ChainProvider, RawLog } from "./types";
import type { AgentBudgetEvent, Budget, CanSpendResult, Session } from "./types";
import { AgentBudgetError, CAN_SPEND_REASONS, type AgentBudgetErrorCode } from "./errors";
import {
  decodeCanSpend,
  decodeDataWords,
  decodeIndexedAddress,
  decodeIndexedUint256,
  decodeUint256,
  encodeCanSpend,
  encodeCreateBudget,
  encodeGrantSession,
  encodeRemainingInWindow,
  encodeRevokeBudget,
  encodeRevokeSession,
  encodeSpend,
  encodeUpdateCaps,
  type CreateBudgetArgs,
  type GrantSessionArgs,
  type RevokeBudgetArgs,
  type RevokeSessionArgs,
  type SpendArgs,
  type UpdateCapsArgs,
} from "./calldata";
import {
  TOPIC_BUDGET_CAPS_UPDATED,
  TOPIC_BUDGET_CREATED,
  TOPIC_BUDGET_REVOKED,
  TOPIC_SESSION_GRANTED,
  TOPIC_SESSION_REVOKED,
  TOPIC_SPENT,
} from "./abi";

export interface BudgetClientConfig {
  /** Deployed AgentBudget contract address. */
  readonly contract: `0x${string}`;
  readonly provider: ChainProvider;
  /**
   * Required `chainId` the caller expects the provider to be on.
   * Verified at construction; mismatch throws immediately.
   */
  readonly chainId: number;
}

/**
 * Write-path output: ready-to-submit calldata + metadata the caller
 * passes into their signer. We return a wrapped shape so callers
 * can't accidentally use the calldata without paying attention to
 * which contract it's for.
 */
export interface PreparedCall {
  readonly to: `0x${string}`;
  readonly data: `0x${string}`;
  /**
   * Decoded args — useful for building a confirmation dialog or a
   * structured audit entry before the transaction is signed.
   */
  readonly args: Readonly<Record<string, unknown>>;
}

export class BudgetClient {
  readonly contract: `0x${string}`;
  readonly provider: ChainProvider;
  readonly chainId: number;

  constructor(config: BudgetClientConfig) {
    if (config.provider.chainId !== config.chainId) {
      throw new AgentBudgetError(
        "chain-id-mismatch",
        `BudgetClient expected chainId ${config.chainId}, provider reports ${config.provider.chainId}`,
      );
    }
    this.contract = config.contract;
    this.provider = config.provider;
    this.chainId = config.chainId;
  }

  // ─── Views ────────────────────────────────────────────────

  /**
   * Read the remaining allowance in the current rolling window. If
   * the window is over (block.timestamp ≥ windowStart +
   * windowSeconds), the on-chain view returns the full dailyCap;
   * this matches what `spend` would see after rolling the window
   * forward.
   */
  async remainingInWindow(budgetId: bigint): Promise<bigint> {
    const data = encodeRemainingInWindow(budgetId);
    const ret = await this.safeCall({ to: this.contract, data });
    return decodeUint256(ret);
  }

  /**
   * Run the on-chain `canSpend` dry-run for `(sessionKey, amount)`.
   * Returns a typed result — callers inspect `result.reason` rather
   * than decoding the raw reason byte.
   */
  async canSpend(sessionKey: `0x${string}`, amount: bigint): Promise<CanSpendResult> {
    const data = encodeCanSpend(sessionKey, amount);
    const ret = await this.safeCall({ to: this.contract, data });
    const { ok, reasonByte } = decodeCanSpend(ret);
    const reason = CAN_SPEND_REASONS[reasonByte];
    if (!reason) {
      throw new AgentBudgetError(
        "provider-call-failed",
        `canSpend returned unknown reason byte ${reasonByte}`,
      );
    }
    // The map only returns codes in the CanSpendResult["reason"] set
    // for the 0..8 reason bytes the contract can produce; narrow with
    // a cast.
    return { ok, reasonByte, reason: reason as CanSpendResult["reason"] };
  }

  /**
   * Convenience: asserts `canSpend` is ok. Throws `AgentBudgetError`
   * with the specific code on failure. Use from paymasters and
   * intent-router preflight checks where the caller wants to fail
   * loudly.
   */
  async assertCanSpend(sessionKey: `0x${string}`, amount: bigint): Promise<void> {
    const result = await this.canSpend(sessionKey, amount);
    if (!result.ok) {
      throw new AgentBudgetError(
        result.reason as AgentBudgetErrorCode,
        `spend rejected: ${result.reason}`,
      );
    }
  }

  // ─── Write-path calldata builders ────────────────────────

  prepareCreateBudget(args: CreateBudgetArgs): PreparedCall {
    const data = encodeCreateBudget(args);
    return {
      to: this.contract,
      data,
      args: {
        asset: args.asset,
        dailyCap: args.dailyCap.toString(),
        perTxCap: args.perTxCap.toString(),
        windowSeconds: args.windowSeconds.toString(),
      },
    };
  }

  prepareUpdateCaps(args: UpdateCapsArgs): PreparedCall {
    const data = encodeUpdateCaps(args);
    return {
      to: this.contract,
      data,
      args: {
        budgetId: args.budgetId.toString(),
        dailyCap: args.dailyCap.toString(),
        perTxCap: args.perTxCap.toString(),
      },
    };
  }

  prepareRevokeBudget(args: RevokeBudgetArgs): PreparedCall {
    const data = encodeRevokeBudget(args);
    return {
      to: this.contract,
      data,
      args: { budgetId: args.budgetId.toString() },
    };
  }

  prepareGrantSession(args: GrantSessionArgs): PreparedCall {
    const data = encodeGrantSession(args);
    return {
      to: this.contract,
      data,
      args: {
        budgetId: args.budgetId.toString(),
        sessionKey: args.sessionKey,
        expiresAt: args.expiresAt.toString(),
        perCallCap: args.perCallCap.toString(),
      },
    };
  }

  prepareRevokeSession(args: RevokeSessionArgs): PreparedCall {
    const data = encodeRevokeSession(args);
    return {
      to: this.contract,
      data,
      args: { sessionKey: args.sessionKey },
    };
  }

  prepareSpend(args: SpendArgs): PreparedCall {
    const data = encodeSpend(args);
    return {
      to: this.contract,
      data,
      args: {
        sessionKey: args.sessionKey,
        amount: args.amount.toString(),
        to: args.to,
      },
    };
  }

  // ─── Logs / audit ────────────────────────────────────────

  /**
   * Fetch + decode events emitted by the budget contract within a
   * block range. Callers pass this into their audit sink or replay
   * stream.
   */
  async getEvents(opts: {
    readonly fromBlock: bigint | "earliest";
    readonly toBlock: bigint | "latest";
    readonly topics?: ReadonlyArray<`0x${string}` | null>;
  }): Promise<ReadonlyArray<AgentBudgetEvent>> {
    const raw = await this.provider.getLogs({
      address: this.contract,
      topics: opts.topics ?? [],
      fromBlock: opts.fromBlock,
      toBlock: opts.toBlock,
    });
    return this.parseLogs(raw);
  }

  /** Decode an array of raw logs. Exposed publicly for tests and for
   *  callers that fetch logs through their own filter/index chain. */
  parseLogs(logs: ReadonlyArray<RawLog>): ReadonlyArray<AgentBudgetEvent> {
    const out: AgentBudgetEvent[] = [];
    for (const log of logs) {
      if (log.topics.length === 0) continue;
      const topic0 = log.topics[0];
      const blockNumber =
        typeof log.blockNumber === "bigint" ? log.blockNumber : BigInt(log.blockNumber);
      const logIndex =
        typeof log.logIndex === "number" ? log.logIndex : parseInt(log.logIndex, 16);

      switch (topic0) {
        case TOPIC_BUDGET_CREATED: {
          // event BudgetCreated(uint256 indexed budgetId, address indexed owner,
          //                     address indexed asset, uint256 dailyCap,
          //                     uint256 perTxCap, uint64 windowSeconds);
          const words = decodeDataWords(log.data);
          out.push({
            kind: "budget-created",
            budgetId: decodeIndexedUint256(log.topics[1]),
            owner: decodeIndexedAddress(log.topics[2]),
            asset: decodeIndexedAddress(log.topics[3]),
            dailyCap: words[0] ?? 0n,
            perTxCap: words[1] ?? 0n,
            windowSeconds: words[2] ?? 0n,
            txHash: log.transactionHash,
            blockNumber,
            logIndex,
          });
          break;
        }
        case TOPIC_BUDGET_CAPS_UPDATED: {
          const words = decodeDataWords(log.data);
          out.push({
            kind: "budget-caps-updated",
            budgetId: decodeIndexedUint256(log.topics[1]),
            dailyCap: words[0] ?? 0n,
            perTxCap: words[1] ?? 0n,
            txHash: log.transactionHash,
            blockNumber,
            logIndex,
          });
          break;
        }
        case TOPIC_BUDGET_REVOKED: {
          out.push({
            kind: "budget-revoked",
            budgetId: decodeIndexedUint256(log.topics[1]),
            txHash: log.transactionHash,
            blockNumber,
            logIndex,
          });
          break;
        }
        case TOPIC_SESSION_GRANTED: {
          // event SessionGranted(uint256 indexed budgetId,
          //                      address indexed sessionKey,
          //                      uint64 expiresAt, uint256 perCallCap);
          const words = decodeDataWords(log.data);
          out.push({
            kind: "session-granted",
            budgetId: decodeIndexedUint256(log.topics[1]),
            sessionKey: decodeIndexedAddress(log.topics[2]),
            expiresAt: words[0] ?? 0n,
            perCallCap: words[1] ?? 0n,
            txHash: log.transactionHash,
            blockNumber,
            logIndex,
          });
          break;
        }
        case TOPIC_SESSION_REVOKED: {
          out.push({
            kind: "session-revoked",
            sessionKey: decodeIndexedAddress(log.topics[1]),
            txHash: log.transactionHash,
            blockNumber,
            logIndex,
          });
          break;
        }
        case TOPIC_SPENT: {
          // event Spent(uint256 indexed budgetId, address indexed sessionKey,
          //             address indexed to, uint256 amount);
          const words = decodeDataWords(log.data);
          out.push({
            kind: "spent",
            budgetId: decodeIndexedUint256(log.topics[1]),
            sessionKey: decodeIndexedAddress(log.topics[2]),
            to: decodeIndexedAddress(log.topics[3]),
            amount: words[0] ?? 0n,
            txHash: log.transactionHash,
            blockNumber,
            logIndex,
          });
          break;
        }
        // Unknown topic: skip silently so unrelated logs from the
        // same address (e.g. proxy admin events) don't crash the
        // parser.
      }
    }
    return out;
  }

  // ─── Internals ──────────────────────────────────────────

  private async safeCall(request: {
    readonly to: `0x${string}`;
    readonly data: `0x${string}`;
  }): Promise<`0x${string}`> {
    try {
      return await this.provider.call(request);
    } catch (cause) {
      throw new AgentBudgetError("provider-call-failed", describeCause(cause), { cause });
    }
  }
}

/**
 * Pure-function helper: project the return of an eth_call against
 * the `budgets(uint256)` auto-generated getter into a `Budget`
 * struct. Exported so callers that fetch the raw struct via their
 * own encoding can still decode without re-implementing layout.
 *
 * Solidity auto-getter returns each struct field in declared order
 * (10 fields for Budget), all packed into 32-byte words.
 *
 * Layout:
 *   [0]  owner                 (address, last 20 bytes of word)
 *   [1]  asset                 (address)
 *   [2]  dailyCap              (uint256)
 *   [3]  perTxCap              (uint256)
 *   [4]  windowSeconds         (uint64 in the low 8 bytes of word)
 *   [5]  windowStart           (uint64)
 *   [6]  spentInWindow         (uint256)
 *   [7]  lifetimeSpent         (uint256)
 *   [8]  revoked               (bool — 0x00..01 or 0x00..00)
 *
 * The on-chain getter synthesised by Solidity doesn't return the
 * full nested struct in one call — each field has its own getter.
 * We model the shape here for callers that use a custom view
 * function that DOES return the full struct.
 */
export function decodeBudgetStruct(ret: `0x${string}`, id: bigint): Budget {
  const words = decodeDataWords(ret);
  if (words.length < 9) {
    throw new AgentBudgetError(
      "provider-call-failed",
      `Budget struct return too short: ${words.length} words`,
    );
  }
  return {
    id,
    owner: addressFromWord(words[0]),
    asset: addressFromWord(words[1]),
    dailyCap: words[2],
    perTxCap: words[3],
    windowSeconds: words[4],
    windowStart: words[5],
    spentInWindow: words[6],
    lifetimeSpent: words[7],
    revoked: words[8] === 1n,
  };
}

export function decodeSessionStruct(ret: `0x${string}`): Session {
  const words = decodeDataWords(ret);
  if (words.length < 5) {
    throw new AgentBudgetError(
      "provider-call-failed",
      `Session struct return too short: ${words.length} words`,
    );
  }
  return {
    budgetId: words[0],
    sessionKey: addressFromWord(words[1]),
    expiresAt: words[2],
    perCallCap: words[3],
    revoked: words[4] === 1n,
  };
}

// ─── Primitive helpers ─────────────────────────────────────

function addressFromWord(word: bigint): `0x${string}` {
  const masked = word & ((1n << 160n) - 1n);
  let hex = masked.toString(16).padStart(40, "0");
  return ("0x" + hex) as `0x${string}`;
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return `provider call failed: ${cause.message}`;
  if (typeof cause === "string") return `provider call failed: ${cause}`;
  return "provider call failed";
}
