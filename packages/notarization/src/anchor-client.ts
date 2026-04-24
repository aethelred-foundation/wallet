/**
 * `OnChainAnchorAdapter` — implements the audit package's
 * `BatchNotarizationAdapter` by submitting the Merkle root to the
 * on-chain `Notary` contract.
 *
 * Flow on every `notarize(batch)`:
 *
 *   1. Encode `anchor(root, eventCount)` calldata.
 *   2. Send the tx via the pluggable `AnchorChainProvider`.
 *   3. Poll `getTransactionReceipt` until confirmed (or timeout).
 *   4. Parse the `BatchAnchored` event from the receipt logs.
 *   5. Return an `AnchoredReceipt` wrapping both the audit-layer
 *      `NotarizationReceipt` and the full `OnChainBatchRecord`.
 *
 * The adapter is reusable across chains — construct one per
 * `(chain, contract, provider)` triple. Retry + nonce management
 * are the provider's concern; we just orchestrate.
 */

import type { FinalizedBatch, NotarizationReceipt } from "@aethelred/wallet-audit";

import { NotarizationError } from "./errors";
import { encodeAnchor, extractAnchoredRecord } from "./calldata";
import type {
  AnchoredReceipt,
  AnchorChainProvider,
  OnChainBatchRecord,
} from "./types";

export interface OnChainAnchorAdapterConfig {
  readonly provider: AnchorChainProvider;
  /** Deployed `Notary` contract address. */
  readonly contract: `0x${string}`;
  /** Chain id the contract lives on. Must match provider.chainId. */
  readonly chainId: number;
  /** Poll interval for receipt confirmation, ms. Default: 2_000. */
  readonly pollIntervalMs?: number;
  /** Max wall-clock wait for confirmation, ms. Default: 120_000 (2 min). */
  readonly pollTimeoutMs?: number;
  /** Clock override for tests. */
  readonly now?: () => number;
  /** Sleep override for tests — by default `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Default URL-builder for `NotarizationReceipt.verifyUrl`. Optional. */
  readonly verifyUrlBuilder?: (record: OnChainBatchRecord) => string;
}

export class OnChainAnchorAdapter {
  private readonly provider: AnchorChainProvider;
  private readonly contract: `0x${string}`;
  private readonly chainId: number;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly verifyUrlBuilder?: (record: OnChainBatchRecord) => string;

  constructor(config: OnChainAnchorAdapterConfig) {
    if (config.provider.chainId !== config.chainId) {
      throw new NotarizationError(
        "chain-id-mismatch",
        `adapter configured for chain ${config.chainId}, provider reports ${config.provider.chainId}`,
      );
    }
    this.provider = config.provider;
    this.contract = config.contract;
    this.chainId = config.chainId;
    this.pollIntervalMs = config.pollIntervalMs ?? 2_000;
    this.pollTimeoutMs = config.pollTimeoutMs ?? 120_000;
    this.now = config.now ?? (() => Date.now());
    this.sleep =
      config.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.verifyUrlBuilder = config.verifyUrlBuilder;
  }

  /**
   * Satisfies the audit package's `BatchNotarizationAdapter`
   * contract. The returned receipt includes both the minimal
   * audit-layer fields AND the richer on-chain record.
   */
  async notarize(batch: FinalizedBatch): Promise<AnchoredReceipt> {
    if (batch.leafCount <= 0) {
      throw new NotarizationError(
        "batch-empty",
        `cannot notarize empty batch ${batch.batchId}`,
      );
    }
    const rootHex = normalizeRoot(batch.root);

    const data = encodeAnchor({
      merkleRoot: rootHex,
      eventCount: batch.leafCount,
    });

    let txHash: `0x${string}`;
    try {
      txHash = await this.provider.sendTransaction({
        to: this.contract,
        data,
      });
    } catch (cause) {
      throw new NotarizationError(
        "anchor-submit-failed",
        `submit failed: ${describeCause(cause)}`,
        { cause },
      );
    }

    const receipt = await this.waitForReceipt(txHash);
    if (receipt.status !== "success") {
      throw new NotarizationError(
        "anchor-tx-reverted",
        `anchor tx ${txHash} reverted on chain ${this.chainId}`,
        { details: { txHash, chainId: this.chainId } },
      );
    }

    const record = extractAnchoredRecord(receipt.logs, this.chainId, this.contract);

    // Cross-check: on-chain root must match what we submitted.
    if (record.merkleRoot.toLowerCase() !== rootHex.toLowerCase()) {
      throw new NotarizationError(
        "anchor-receipt-malformed",
        `on-chain root ${record.merkleRoot} does not match submitted ${rootHex}`,
      );
    }

    const notarizationReceipt: NotarizationReceipt = {
      batchId: batch.batchId,
      externalId: txHash,
      publishedAt: this.now(),
      verifyUrl: this.verifyUrlBuilder?.(record),
    };

    return { ...notarizationReceipt, record };
  }

  // ─── Private ──────────────────────────────────────────

  private async waitForReceipt(txHash: `0x${string}`) {
    const deadline = this.now() + this.pollTimeoutMs;
    while (this.now() < deadline) {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (receipt) return receipt;
      await this.sleep(this.pollIntervalMs);
    }
    throw new NotarizationError(
      "anchor-confirmation-timeout",
      `tx ${txHash} did not confirm within ${this.pollTimeoutMs}ms`,
      { details: { txHash, pollTimeoutMs: this.pollTimeoutMs } },
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────

function normalizeRoot(root: string): `0x${string}` {
  const hex = root.startsWith("0x") ? root : `0x${root}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new NotarizationError(
      "batch-malformed",
      `Merkle root must be a 32-byte 0x hex string, got "${root}" (length ${root.length})`,
    );
  }
  return hex.toLowerCase() as `0x${string}`;
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return "unknown";
}
