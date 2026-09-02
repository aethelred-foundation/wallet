import { describe, expect, it } from "vitest";
import type { TrackedPendingTransaction } from "@aethelred/wallet-chain";
import { toPendingTxSummary } from "../background/pending-tx-summary";

describe("pending transaction bridge summary", () => {
  it("flattens nested tracker fields and every bigint before messaging", () => {
    const tracked: TrackedPendingTransaction = {
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nonce: 4,
      fromAddress: "0x1111111111111111111111111111111111111111",
      chainId: 7332,
      submittedAt: 1_700_000_000_000,
      original: {
        nonce: 4,
        to: "0x2222222222222222222222222222222222222222",
        value: 1_000_000_000_000_000_000n,
        data: "0x",
        chainId: 7332,
        type: "eip1559",
        maxFeePerGas: 25_000_000_000n,
        maxPriorityFeePerGas: 2_000_000_000n,
        gasLimit: 21_000n,
      },
      gasSuggestion: {
        minBumpPercent: 11,
        speedUp: {
          maxFeePerGas: 27_750_000_000n,
          maxPriorityFeePerGas: 2_220_000_000n,
        },
        cancel: {
          maxFeePerGas: 27_750_000_000n,
          maxPriorityFeePerGas: 2_220_000_000n,
        },
      },
    };

    const summary = toPendingTxSummary(tracked);

    expect(summary).toMatchObject({
      to: tracked.original.to,
      value: "1000000000000000000",
      gasLimit: "21000",
      maxFeePerGas: "25000000000",
      suggestion: {
        speedUp: { maxFeePerGas: "27750000000" },
        cancel: { maxPriorityFeePerGas: "2220000000" },
      },
    });
    expect(() => JSON.stringify(summary)).not.toThrow();
    expect(JSON.stringify(summary)).not.toContain("original");
  });
});
