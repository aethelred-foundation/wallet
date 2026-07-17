import { RpcClient } from "./rpc-client";

export type TxStatus = "pending" | "confirmed" | "failed" | "dropped";

export interface PendingTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  nonce: number;
  gasLimit: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
  data: string;
  chainId: string;
  status: TxStatus;
  submittedAt: number;
  confirmedAt?: number;
  blockNumber?: number;
  blockHash?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
  error?: string;
}

export interface TxReceipt {
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  status: string; // "0x1" success, "0x0" failure
  gasUsed: string;
  effectiveGasPrice: string;
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
  }>;
}

/**
 * Transaction manager handles the full lifecycle:
 * nonce → sign → broadcast → poll receipt → confirm/fail
 *
 * **Nonce safety.** The previous implementation had a race: two concurrent
 * `getNonce()` calls could both read the chain's `eth_getTransactionCount`
 * + cache value and both allocate the same nonce, producing two signed
 * transactions with the same nonce — only one would broadcast successfully.
 * The fix is an in-flight map that serializes concurrent callers so each
 * one gets a distinct nonce.
 */
export class TxManager {
  private pending = new Map<string, PendingTransaction>();
  private nonceCache = new Map<string, number>();
  /**
   * Nonces returned by this manager and explicitly released before
   * broadcast. Values stay separate from the high-water cache so an
   * out-of-order rollback cannot move the cache backwards over another
   * concurrent reservation.
   */
  private reusableNonces = new Map<string, Set<number>>();
  /** Highest pending on-chain nonce observed for each address. */
  private observedNonceFloor = new Map<string, number>();
  /** In-flight nonce requests keyed by lowercase address — prevents races. */
  private pendingNonceRequests = new Map<string, Promise<number>>();
  private readonly listeners: Array<(tx: PendingTransaction) => void> = [];

  constructor(private readonly rpc: RpcClient) {}

  /**
   * Atomically allocate the next nonce for `address`. Safe under
   * concurrent invocation: a second caller joins the first caller's
   * in-flight promise, waits for it to resolve, then recurses into a
   * fresh call so it gets the NEXT nonce, not a duplicate.
   */
  async getNonce(address: string): Promise<number> {
    const key = address.toLowerCase();

    const existing = this.pendingNonceRequests.get(key);
    if (existing) {
      // Wait for the current allocation to finish, then ask for
      // another one — the cache increment in the first promise
      // guarantees we'll receive N+1 instead of duplicating N.
      return existing.then(() => this.getNonce(address));
    }

    const promise = (async () => {
      const onChainHex = await this.rpc.call<string>("eth_getTransactionCount", [address, "pending"]);
      const onChain = parseInt(onChainHex, 16);
      const observedFloor = Math.max(onChain, this.observedNonceFloor.get(key) ?? 0);
      this.observedNonceFloor.set(key, observedFloor);

      const cached = this.nonceCache.get(key) ?? 0;
      const highWater = Math.max(observedFloor, cached);
      this.nonceCache.set(key, highWater);

      const reusable = this.reusableNonces.get(key);
      let lowestReusable: number | undefined;
      if (reusable) {
        for (const releasedNonce of reusable) {
          // Anything below the pending chain nonce has already been
          // consumed. Anything at/above high-water was never issued by
          // this manager and must not enter the allocation path.
          if (releasedNonce < observedFloor || releasedNonce >= highWater) {
            reusable.delete(releasedNonce);
            continue;
          }
          if (lowestReusable === undefined || releasedNonce < lowestReusable) {
            lowestReusable = releasedNonce;
          }
        }

        if (lowestReusable !== undefined) {
          reusable.delete(lowestReusable);
          if (reusable.size === 0) this.reusableNonces.delete(key);
          return lowestReusable;
        }

        if (reusable.size === 0) this.reusableNonces.delete(key);
      }

      const nonce = highWater;
      this.nonceCache.set(key, nonce + 1);
      return nonce;
    })();

    this.pendingNonceRequests.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pendingNonceRequests.delete(key);
    }
  }

  /**
   * Reserve the next nonce WITHOUT an RPC round-trip. Useful for
   * pre-allocating during a `prepare-tx` flow so `execute-tx` can reuse
   * the same value without re-fetching. This deliberately does not consume
   * a released nonce: only `getNonce()` may reuse one after reconciling it
   * against the chain's current pending nonce.
   */
  reserveNonce(address: string): number {
    const key = address.toLowerCase();
    const cached = Math.max(
      this.nonceCache.get(key) ?? 0,
      this.observedNonceFloor.get(key) ?? 0,
    );
    this.nonceCache.set(key, cached + 1);
    return cached;
  }

  /**
   * Mark an allocated nonce as reusable after a transaction is abandoned
   * before broadcast submission begins. The high-water cache never moves
   * backwards, so any number of reservations can be released out of order
   * without colliding with reservations that remain active. Releasing the
   * same nonce repeatedly while it remains in the pool is idempotent.
   *
   * Callers MUST NOT release a nonce after handing a signed transaction to
   * `broadcast()` (or to any external broadcaster).
   */
  releaseNonce(address: string, nonce: number): void {
    const key = address.toLowerCase();
    const cached = this.nonceCache.get(key) ?? 0;
    const observedFloor = this.observedNonceFloor.get(key) ?? 0;

    // Only a finite, non-negative nonce below this manager's high-water
    // mark could have been allocated here. A nonce below the latest chain
    // floor has already been consumed and is no longer safe to recycle.
    if (!Number.isSafeInteger(nonce) || nonce < observedFloor || nonce >= cached) return;

    let reusable = this.reusableNonces.get(key);
    if (!reusable) {
      reusable = new Set<number>();
      this.reusableNonces.set(key, reusable);
    }
    reusable.add(nonce);
  }

  async broadcast(signedTx: string): Promise<string> {
    const hash = await this.rpc.call<string>("eth_sendRawTransaction", [signedTx]);
    return hash;
  }

  trackTransaction(tx: Omit<PendingTransaction, "status" | "submittedAt">): PendingTransaction {
    const pending: PendingTransaction = {
      ...tx,
      status: "pending",
      submittedAt: Date.now(),
    };
    this.pending.set(tx.hash, pending);
    this.notify(pending);
    return pending;
  }

  async pollReceipt(hash: string, maxAttempts = 60, intervalMs = 5000): Promise<TxReceipt | null> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const receipt = await this.rpc.call<TxReceipt | null>("eth_getTransactionReceipt", [hash]);
        if (receipt) {
          const tx = this.pending.get(hash);
          if (tx) {
            tx.status = receipt.status === "0x1" ? "confirmed" : "failed";
            tx.confirmedAt = Date.now();
            tx.blockNumber = parseInt(receipt.blockNumber, 16);
            tx.blockHash = receipt.blockHash;
            tx.gasUsed = receipt.gasUsed;
            tx.effectiveGasPrice = receipt.effectiveGasPrice;
            this.notify(tx);
          }
          return receipt;
        }
      } catch {
        // Receipt not available yet
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    // Transaction may have been dropped
    const tx = this.pending.get(hash);
    if (tx) {
      tx.status = "dropped";
      tx.error = "Transaction not confirmed after maximum polling attempts";
      this.notify(tx);
    }
    return null;
  }

  async getTransaction(hash: string): Promise<unknown> {
    return this.rpc.call("eth_getTransactionByHash", [hash]);
  }

  getPending(): PendingTransaction[] {
    return Array.from(this.pending.values()).filter((tx) => tx.status === "pending");
  }

  getAll(): PendingTransaction[] {
    return Array.from(this.pending.values());
  }

  getByAddress(address: string): PendingTransaction[] {
    const lower = address.toLowerCase();
    return Array.from(this.pending.values()).filter(
      (tx) => tx.from.toLowerCase() === lower
    );
  }

  onUpdate(listener: (tx: PendingTransaction) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private notify(tx: PendingTransaction): void {
    for (const listener of this.listeners) {
      try { listener(tx); } catch { /* listeners must not break */ }
    }
  }

  loadFromSnapshot(txs: PendingTransaction[]): void {
    this.pending.clear();
    for (const tx of txs) this.pending.set(tx.hash, tx);
  }

  toSnapshot(): PendingTransaction[] {
    return Array.from(this.pending.values());
  }
}
