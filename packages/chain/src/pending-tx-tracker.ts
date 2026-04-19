/**
 * PendingTxTracker — durable ledger of broadcast-but-not-yet-confirmed
 * transactions, with first-class support for fee-bump / speed-up / cancel
 * replacement lineage.
 *
 * This sits alongside the in-memory `TxManager.pending` map: TxManager
 * tracks the current-session lifecycle (broadcast → receipt poll →
 * confirmed/dropped), while this tracker persists across SW restarts
 * AND records the `originalTxHash → replacementHash` chain that the
 * popup's Activity view needs to render "Speed up" / "Cancel" buttons.
 *
 * Storage design:
 *   - Same `StorageAdapter` shape as VelocityTracker (get/set/delete).
 *   - Single JSON blob under `storageKey` — the number of pending
 *     transactions per user is typically < 20 so we don't bother with
 *     a per-hash key scheme.
 *   - All persist operations are awaited — we'd rather block the
 *     caller for a few ms than return optimistically and lose state
 *     on SW eviction.
 *   - Hydration happens on first access and is cached.
 */

import type { OriginalTransaction, ReplacementGasSuggestion } from "@aethelred/wallet-core";

export interface PendingTxStorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PendingTransaction {
  txHash: `0x${string}`;
  nonce: number;
  fromAddress: `0x${string}`;
  chainId: number;
  submittedAt: number;
  gasSuggestion?: ReplacementGasSuggestion;
  /** Set when the user issues a replacement (speed-up or cancel). */
  replacedBy?: `0x${string}`;
  replacementKind?: "speed-up" | "cancel";
  original: OriginalTransaction;
}

/**
 * Typed error thrown by the tracker on lookup / state-transition
 * failures. Carrying a stable `code` lets the popup surface
 * user-readable strings without string-matching on `err.message`.
 */
export class PendingTxTrackerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PendingTxTrackerError";
    this.code = code;
  }
}

/* ─── Serialization helpers ──────────────────────────────────
 * `OriginalTransaction` holds bigints for gas/value fields, which
 * `JSON.stringify` refuses to serialize. We round-trip bigints as
 * decimal strings and restore them on load. */

interface SerializedOriginalTx {
  nonce: number;
  to: string;
  value: string;
  data: string;
  chainId: number;
  type: "eip1559" | "legacy";
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
  gasLimit: string;
}

interface SerializedGasSuggestion {
  minBumpPercent: number;
  speedUp: { maxFeePerGas: string; maxPriorityFeePerGas: string; gasPrice?: string };
  cancel: { maxFeePerGas: string; maxPriorityFeePerGas: string; gasPrice?: string };
}

interface SerializedPendingTx {
  txHash: string;
  nonce: number;
  fromAddress: string;
  chainId: number;
  submittedAt: number;
  gasSuggestion?: SerializedGasSuggestion;
  replacedBy?: string;
  replacementKind?: "speed-up" | "cancel";
  original: SerializedOriginalTx;
}

function serializeOriginalTx(tx: OriginalTransaction): SerializedOriginalTx {
  return {
    nonce: tx.nonce,
    to: tx.to,
    value: tx.value.toString(),
    data: tx.data,
    chainId: tx.chainId,
    type: tx.type,
    maxFeePerGas: tx.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString(),
    gasPrice: tx.gasPrice?.toString(),
    gasLimit: tx.gasLimit.toString(),
  };
}

function deserializeOriginalTx(raw: SerializedOriginalTx): OriginalTransaction {
  return {
    nonce: raw.nonce,
    to: raw.to as `0x${string}`,
    value: BigInt(raw.value),
    data: raw.data as `0x${string}`,
    chainId: raw.chainId,
    type: raw.type,
    maxFeePerGas: raw.maxFeePerGas !== undefined ? BigInt(raw.maxFeePerGas) : undefined,
    maxPriorityFeePerGas: raw.maxPriorityFeePerGas !== undefined ? BigInt(raw.maxPriorityFeePerGas) : undefined,
    gasPrice: raw.gasPrice !== undefined ? BigInt(raw.gasPrice) : undefined,
    gasLimit: BigInt(raw.gasLimit),
  };
}

function serializeSuggestion(s: ReplacementGasSuggestion): SerializedGasSuggestion {
  return {
    minBumpPercent: s.minBumpPercent,
    speedUp: {
      maxFeePerGas: s.speedUp.maxFeePerGas.toString(),
      maxPriorityFeePerGas: s.speedUp.maxPriorityFeePerGas.toString(),
      gasPrice: s.speedUp.gasPrice?.toString(),
    },
    cancel: {
      maxFeePerGas: s.cancel.maxFeePerGas.toString(),
      maxPriorityFeePerGas: s.cancel.maxPriorityFeePerGas.toString(),
      gasPrice: s.cancel.gasPrice?.toString(),
    },
  };
}

function deserializeSuggestion(raw: SerializedGasSuggestion): ReplacementGasSuggestion {
  return {
    minBumpPercent: raw.minBumpPercent,
    speedUp: {
      maxFeePerGas: BigInt(raw.speedUp.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(raw.speedUp.maxPriorityFeePerGas),
      gasPrice: raw.speedUp.gasPrice !== undefined ? BigInt(raw.speedUp.gasPrice) : undefined,
    },
    cancel: {
      maxFeePerGas: BigInt(raw.cancel.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(raw.cancel.maxPriorityFeePerGas),
      gasPrice: raw.cancel.gasPrice !== undefined ? BigInt(raw.cancel.gasPrice) : undefined,
    },
  };
}

function serializePending(tx: PendingTransaction): SerializedPendingTx {
  return {
    txHash: tx.txHash,
    nonce: tx.nonce,
    fromAddress: tx.fromAddress,
    chainId: tx.chainId,
    submittedAt: tx.submittedAt,
    gasSuggestion: tx.gasSuggestion ? serializeSuggestion(tx.gasSuggestion) : undefined,
    replacedBy: tx.replacedBy,
    replacementKind: tx.replacementKind,
    original: serializeOriginalTx(tx.original),
  };
}

function deserializePending(raw: SerializedPendingTx): PendingTransaction {
  return {
    txHash: raw.txHash as `0x${string}`,
    nonce: raw.nonce,
    fromAddress: raw.fromAddress as `0x${string}`,
    chainId: raw.chainId,
    submittedAt: raw.submittedAt,
    gasSuggestion: raw.gasSuggestion ? deserializeSuggestion(raw.gasSuggestion) : undefined,
    replacedBy: raw.replacedBy as `0x${string}` | undefined,
    replacementKind: raw.replacementKind,
    original: deserializeOriginalTx(raw.original),
  };
}

/* ─── Tracker ──────────────────────────────────────────────── */

export class PendingTxTracker {
  /** Default storage key; callers can override for scope isolation. */
  static readonly DEFAULT_STORAGE_KEY = "pending-tx-tracker";

  private readonly storage: PendingTxStorageAdapter;
  private readonly storageKey: string;
  private cache: PendingTransaction[] = [];
  private hydrated = false;

  constructor(storage: PendingTxStorageAdapter, options?: { storageKey?: string }) {
    this.storage = storage;
    this.storageKey = options?.storageKey ?? PendingTxTracker.DEFAULT_STORAGE_KEY;
  }

  /**
   * List tracked pending transactions. Pass `fromAddress` to narrow
   * by sender — case-insensitive to tolerate checksummed vs lowercase
   * inputs from different parts of the stack. Confirmed transactions
   * (via `markConfirmed`) are evicted so the list is always "live".
   */
  async list(fromAddress?: `0x${string}`): Promise<PendingTransaction[]> {
    await this.hydrate();
    if (!fromAddress) {
      return [...this.cache];
    }
    const target = fromAddress.toLowerCase();
    return this.cache.filter((t) => t.fromAddress.toLowerCase() === target);
  }

  /**
   * Add a new pending tx. Idempotent on `txHash` — if the same hash
   * has already been recorded we overwrite (the tracker is the source
   * of truth for the REPLACEMENT lineage, so overwriting is the right
   * semantics: the caller is re-asserting the tx with potentially
   * updated fields).
   */
  async add(tx: PendingTransaction): Promise<void> {
    await this.hydrate();
    const existingIdx = this.cache.findIndex((t) => t.txHash.toLowerCase() === tx.txHash.toLowerCase());
    if (existingIdx >= 0) {
      this.cache[existingIdx] = tx;
    } else {
      this.cache.push(tx);
    }
    await this.persist();
  }

  /**
   * Mark `originalTxHash` as having been replaced by `replacementHash`
   * (speed-up or cancel). Does not delete the original — keeping it
   * with `replacedBy` set lets the UI render the lineage ("Replacing
   * 0xabc... → 0xdef..."). When the replacement confirms, the caller
   * invokes `markConfirmed(replacementHash)` which also removes the
   * original.
   */
  async markReplaced(
    originalTxHash: `0x${string}`,
    replacementHash: `0x${string}`,
    kind: "speed-up" | "cancel",
  ): Promise<void> {
    await this.hydrate();
    const original = this.cache.find((t) => t.txHash.toLowerCase() === originalTxHash.toLowerCase());
    if (!original) {
      throw new PendingTxTrackerError(
        "ORIGINAL_NOT_FOUND",
        `cannot mark replaced: no pending tx with hash ${originalTxHash}`,
      );
    }
    original.replacedBy = replacementHash;
    original.replacementKind = kind;
    await this.persist();
  }

  /**
   * Remove the given tx from the tracker. If it has a chained
   * `replacedBy` ancestor in the cache, that ancestor is also
   * evicted — confirming a replacement implicitly confirms that the
   * original can never mine (the replacement took its nonce slot).
   */
  async markConfirmed(txHash: `0x${string}`): Promise<void> {
    await this.hydrate();
    const lower = txHash.toLowerCase();
    const before = this.cache.length;
    // Evict the confirmed tx plus anything it replaced.
    this.cache = this.cache.filter((t) => {
      if (t.txHash.toLowerCase() === lower) return false;
      if (t.replacedBy?.toLowerCase() === lower) return false;
      return true;
    });
    if (this.cache.length === before) {
      // Not a hard error — may have been evicted by a previous call —
      // but callers can check the list if they care.
      return;
    }
    await this.persist();
  }

  /**
   * Look up a pending tx by sender + chain + nonce. Useful for the
   * replacement flow: the popup passes `originalTxHash` but the
   * background may want to resolve it via the canonical
   * `(from, chain, nonce)` triple to confirm it's still pending.
   */
  async getByNonce(
    fromAddress: `0x${string}`,
    chainId: number,
    nonce: number,
  ): Promise<PendingTransaction | null> {
    await this.hydrate();
    const target = fromAddress.toLowerCase();
    return (
      this.cache.find(
        (t) =>
          t.fromAddress.toLowerCase() === target &&
          t.chainId === chainId &&
          t.nonce === nonce,
      ) ?? null
    );
  }

  /** Hard reset — for wallet-reset flows. */
  async clear(): Promise<void> {
    this.cache = [];
    this.hydrated = true;
    await this.storage.delete(this.storageKey);
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    try {
      const raw = await this.storage.get(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as SerializedPendingTx[];
        if (Array.isArray(parsed)) {
          this.cache = parsed.map(deserializePending);
        }
      }
    } catch {
      // Corrupted or unreadable — wipe and start fresh. Better than
      // refusing to boot the wallet over a malformed cache.
      this.cache = [];
    }
    this.hydrated = true;
  }

  private async persist(): Promise<void> {
    const serialized = JSON.stringify(this.cache.map(serializePending));
    await this.storage.set(this.storageKey, serialized);
  }
}
