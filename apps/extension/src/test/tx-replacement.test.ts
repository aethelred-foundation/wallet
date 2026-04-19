/**
 * Gas-bump / speed-up / cancel unit tests.
 *
 * Covers:
 *   - `computeReplacementGas` for EIP-1559 bumps BOTH fees by 11% min
 *   - `computeReplacementGas` for legacy bumps gasPrice by 11%
 *   - Custom bumpPercent respected
 *   - Cancel tx: to = sender, value = 0, data = 0x, same nonce + chain
 *   - Speed-up tx: preserves to/value/data, bumps gas
 *   - Low-base-fee network floors priority tip at 1 gwei
 *   - PendingTxTracker round-trip through in-memory storage adapter
 *   - getByNonce returns the right pending tx
 */

import { describe, it, expect } from "vitest";
import {
  computeReplacementGas,
  buildSpeedUpTransaction,
  buildCancelTransaction,
  GasReplacementError,
  type OriginalTransaction,
} from "@aethelred/wallet-core";
import {
  PendingTxTracker,
  PendingTxTrackerError,
  type PendingTxStorageAdapter,
  type TrackedPendingTransaction,
} from "@aethelred/wallet-chain";

/* ─── Test fixtures ─────────────────────────────────────────── */

const SENDER = "0x2c7536e3605d9c16a7a3d7b1898e529396a65c23" as const;
const RECIPIENT = "0x1111111111111111111111111111111111111111" as const;
const CHAIN_ID = 1;

function eip1559Tx(overrides?: Partial<OriginalTransaction>): OriginalTransaction {
  return {
    nonce: 42,
    to: RECIPIENT,
    value: 10n ** 18n, // 1 ETH
    data: "0x",
    chainId: CHAIN_ID,
    type: "eip1559",
    // 20 gwei maxFee, 2 gwei priority — typical mainnet values.
    maxFeePerGas: 20n * 10n ** 9n,
    maxPriorityFeePerGas: 2n * 10n ** 9n,
    gasLimit: 21_000n,
    ...overrides,
  };
}

function legacyTx(overrides?: Partial<OriginalTransaction>): OriginalTransaction {
  return {
    nonce: 7,
    to: RECIPIENT,
    value: 10n ** 17n, // 0.1 ETH
    data: "0x",
    chainId: CHAIN_ID,
    type: "legacy",
    gasPrice: 50n * 10n ** 9n, // 50 gwei
    gasLimit: 21_000n,
    ...overrides,
  };
}

/** Simple ceiling integer bump — mirrors production helper for asserting minimums. */
function expectedCeilBump(value: bigint, percent: number): bigint {
  return (value * BigInt(100 + percent) + 99n) / 100n;
}

class InMemoryStorageAdapter implements PendingTxStorageAdapter {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/* ─── computeReplacementGas — EIP-1559 ───────────────────────── */

describe("computeReplacementGas (EIP-1559)", () => {
  it("bumps both maxFeePerGas and maxPriorityFeePerGas by at least 11%", () => {
    const tx = eip1559Tx();
    const s = computeReplacementGas(tx);
    // Minimum acceptable: strictly greater than 10% of the originals.
    // We bump by 11% and we floor priority at 1 gwei, so both are
    // guaranteed above the 10% threshold.
    const minMax = (tx.maxFeePerGas! * 110n) / 100n;
    const minPrio = (tx.maxPriorityFeePerGas! * 110n) / 100n;
    expect(s.speedUp.maxFeePerGas).toBeGreaterThan(minMax);
    expect(s.speedUp.maxPriorityFeePerGas).toBeGreaterThan(minPrio);
    expect(s.cancel.maxFeePerGas).toBeGreaterThan(minMax);
    expect(s.cancel.maxPriorityFeePerGas).toBeGreaterThan(minPrio);
    expect(s.minBumpPercent).toBe(11);
  });

  it("respects a custom bumpPercent", () => {
    const tx = eip1559Tx();
    const s = computeReplacementGas(tx, { bumpPercent: 25 });
    // 25% of 2 gwei = 0.5 gwei bump → 2.5 gwei, but priority floor is
    // 1 gwei so this ends up around 2.5 gwei.
    const expectedPriority = expectedCeilBump(tx.maxPriorityFeePerGas!, 25);
    const expectedMax = expectedCeilBump(tx.maxFeePerGas!, 25);
    expect(s.speedUp.maxPriorityFeePerGas).toBe(expectedPriority);
    expect(s.speedUp.maxFeePerGas).toBe(expectedMax);
    expect(s.minBumpPercent).toBe(25);
  });

  it("floors priority tip at 1 gwei when original priority is extremely low", () => {
    const tx = eip1559Tx({ maxPriorityFeePerGas: 1n }); // 1 wei!
    const s = computeReplacementGas(tx);
    // 1 wei * 1.11 = still ~1 wei, but the floor is 1 gwei.
    expect(s.speedUp.maxPriorityFeePerGas).toBe(1_000_000_000n);
    // maxFeePerGas must still be >= priority (defensive).
    expect(s.speedUp.maxFeePerGas).toBeGreaterThanOrEqual(s.speedUp.maxPriorityFeePerGas);
  });

  it("ensures maxFeePerGas >= networkBaseFee + priority when networkBaseFeePerGas is provided", () => {
    const tx = eip1559Tx({ maxFeePerGas: 5n * 10n ** 9n, maxPriorityFeePerGas: 1n * 10n ** 9n });
    const baseFee = 100n * 10n ** 9n; // base fee spiked to 100 gwei
    const s = computeReplacementGas(tx, { networkBaseFeePerGas: baseFee });
    expect(s.speedUp.maxFeePerGas).toBeGreaterThanOrEqual(baseFee + s.speedUp.maxPriorityFeePerGas);
  });

  it("throws GasReplacementError when EIP-1559 fee fields are missing", () => {
    const tx: OriginalTransaction = {
      ...eip1559Tx(),
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
    };
    expect(() => computeReplacementGas(tx)).toThrow(GasReplacementError);
  });

  it("rejects sub-10% bump percents", () => {
    expect(() => computeReplacementGas(eip1559Tx(), { bumpPercent: 5 })).toThrow(GasReplacementError);
  });
});

/* ─── computeReplacementGas — Legacy ────────────────────────── */

describe("computeReplacementGas (legacy)", () => {
  it("bumps gasPrice by 11% by default", () => {
    const tx = legacyTx();
    const s = computeReplacementGas(tx);
    const min = (tx.gasPrice! * 110n) / 100n;
    expect(s.speedUp.gasPrice).toBeGreaterThan(min);
    expect(s.cancel.gasPrice).toBeGreaterThan(min);
  });

  it("throws when legacy gasPrice is missing", () => {
    const tx: OriginalTransaction = { ...legacyTx(), gasPrice: undefined };
    expect(() => computeReplacementGas(tx)).toThrow(GasReplacementError);
  });

  it("floors gas price at 1 gwei for very-low-fee originals", () => {
    const tx = legacyTx({ gasPrice: 1n });
    const s = computeReplacementGas(tx);
    expect(s.speedUp.gasPrice).toBe(1_000_000_000n);
  });
});

/* ─── buildSpeedUpTransaction ───────────────────────────────── */

describe("buildSpeedUpTransaction", () => {
  it("preserves to/value/data/nonce/chain and bumps gas (EIP-1559)", () => {
    const tx = eip1559Tx();
    const s = computeReplacementGas(tx);
    const replacement = buildSpeedUpTransaction(tx, s);
    expect(replacement.to).toBe(tx.to);
    expect(replacement.value).toBe(tx.value);
    expect(replacement.data).toBe(tx.data);
    expect(replacement.nonce).toBe(tx.nonce);
    expect(replacement.chainId).toBe(tx.chainId);
    expect(replacement.type).toBe("eip1559");
    // Must bump more than 10%
    expect(replacement.maxFeePerGas!).toBeGreaterThan((tx.maxFeePerGas! * 110n) / 100n);
    expect(replacement.maxPriorityFeePerGas!).toBeGreaterThan((tx.maxPriorityFeePerGas! * 110n) / 100n);
  });

  it("preserves to/value/data and bumps gasPrice (legacy)", () => {
    const tx = legacyTx();
    const s = computeReplacementGas(tx);
    const replacement = buildSpeedUpTransaction(tx, s);
    expect(replacement.to).toBe(tx.to);
    expect(replacement.value).toBe(tx.value);
    expect(replacement.data).toBe(tx.data);
    expect(replacement.gasPrice!).toBeGreaterThan((tx.gasPrice! * 110n) / 100n);
  });
});

/* ─── buildCancelTransaction ────────────────────────────────── */

describe("buildCancelTransaction", () => {
  it("produces a zero-value self-send with 0x data (EIP-1559)", () => {
    const tx = eip1559Tx();
    const s = computeReplacementGas(tx);
    const cancel = buildCancelTransaction(tx, SENDER, s);
    expect(cancel.to.toLowerCase()).toBe(SENDER);
    expect(cancel.value).toBe(0n);
    expect(cancel.data).toBe("0x");
    // Same identity markers
    expect(cancel.nonce).toBe(tx.nonce);
    expect(cancel.chainId).toBe(tx.chainId);
    expect(cancel.type).toBe("eip1559");
    // Bumped fees
    expect(cancel.maxFeePerGas!).toBeGreaterThan((tx.maxFeePerGas! * 110n) / 100n);
    expect(cancel.maxPriorityFeePerGas!).toBeGreaterThan((tx.maxPriorityFeePerGas! * 110n) / 100n);
  });

  it("produces a zero-value self-send with bumped gasPrice (legacy)", () => {
    const tx = legacyTx();
    const s = computeReplacementGas(tx);
    const cancel = buildCancelTransaction(tx, SENDER, s);
    expect(cancel.to.toLowerCase()).toBe(SENDER);
    expect(cancel.value).toBe(0n);
    expect(cancel.data).toBe("0x");
    expect(cancel.gasPrice!).toBeGreaterThan((tx.gasPrice! * 110n) / 100n);
  });

  it("floors gas limit at 21_000 even if original was tiny", () => {
    const tx = eip1559Tx({ gasLimit: 1_000n });
    const s = computeReplacementGas(tx);
    const cancel = buildCancelTransaction(tx, SENDER, s);
    expect(cancel.gasLimit).toBe(21_000n);
  });
});

/* ─── PendingTxTracker ──────────────────────────────────────── */

function sampleTracked(overrides?: Partial<TrackedPendingTransaction>): TrackedPendingTransaction {
  return {
    txHash: "0xaaa1" as `0x${string}`,
    nonce: 42,
    fromAddress: SENDER,
    chainId: CHAIN_ID,
    submittedAt: 1_700_000_000_000,
    original: eip1559Tx(),
    ...overrides,
  };
}

describe("PendingTxTracker", () => {
  it("round-trips add → list through the storage adapter", async () => {
    const storage = new InMemoryStorageAdapter();
    const tracker = new PendingTxTracker(storage);
    const tx = sampleTracked();
    await tracker.add(tx);
    const listed = await tracker.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].txHash).toBe(tx.txHash);
    // bigint fields survive the JSON round-trip
    expect(listed[0].original.value).toBe(10n ** 18n);
    expect(listed[0].original.gasLimit).toBe(21_000n);
  });

  it("filters list by fromAddress (case-insensitive)", async () => {
    const storage = new InMemoryStorageAdapter();
    const tracker = new PendingTxTracker(storage);
    await tracker.add(sampleTracked({ txHash: "0xbbb1" as `0x${string}`, fromAddress: SENDER }));
    await tracker.add(sampleTracked({
      txHash: "0xbbb2" as `0x${string}`,
      fromAddress: "0x9999999999999999999999999999999999999999",
    }));
    const filtered = await tracker.list(SENDER.toUpperCase() as `0x${string}`);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].txHash).toBe("0xbbb1");
  });

  it("markReplaced sets replacedBy and replacementKind", async () => {
    const storage = new InMemoryStorageAdapter();
    const tracker = new PendingTxTracker(storage);
    await tracker.add(sampleTracked());
    await tracker.markReplaced("0xaaa1", "0xaaa2", "speed-up");
    const [after] = await tracker.list();
    expect(after.replacedBy?.toLowerCase()).toBe("0xaaa2");
    expect(after.replacementKind).toBe("speed-up");
  });

  it("markReplaced throws PendingTxTrackerError for unknown hash", async () => {
    const storage = new InMemoryStorageAdapter();
    const tracker = new PendingTxTracker(storage);
    await expect(tracker.markReplaced("0xnever", "0xnope", "cancel")).rejects.toBeInstanceOf(
      PendingTxTrackerError,
    );
  });

  it("markConfirmed evicts the confirmed tx and its replaced ancestor", async () => {
    const storage = new InMemoryStorageAdapter();
    const tracker = new PendingTxTracker(storage);
    await tracker.add(sampleTracked({ txHash: "0xaaa1" as `0x${string}` }));
    await tracker.add(sampleTracked({ txHash: "0xaaa2" as `0x${string}`, nonce: 43 }));
    await tracker.markReplaced("0xaaa1", "0xaaa2", "speed-up");
    await tracker.markConfirmed("0xaaa2");
    const remaining = await tracker.list();
    expect(remaining).toHaveLength(0);
  });

  it("getByNonce resolves the right pending tx", async () => {
    const storage = new InMemoryStorageAdapter();
    const tracker = new PendingTxTracker(storage);
    await tracker.add(sampleTracked({ txHash: "0xaaa1" as `0x${string}`, nonce: 42 }));
    await tracker.add(sampleTracked({ txHash: "0xaaa2" as `0x${string}`, nonce: 43 }));
    const found = await tracker.getByNonce(SENDER, CHAIN_ID, 43);
    expect(found?.txHash).toBe("0xaaa2");
    const missing = await tracker.getByNonce(SENDER, CHAIN_ID, 999);
    expect(missing).toBeNull();
  });

  it("persists across separate tracker instances via the shared adapter", async () => {
    const storage = new InMemoryStorageAdapter();
    const t1 = new PendingTxTracker(storage);
    await t1.add(sampleTracked());
    const t2 = new PendingTxTracker(storage);
    const listed = await t2.list();
    expect(listed).toHaveLength(1);
  });
});
