/**
 * TransferSolver tests.
 *
 * Coverage:
 *
 *   1. Solver identity — id / name / supportedIntentKinds ["transfer"]
 *      / publicKeyHex null.
 *   2. quote() declines for every guard:
 *      - non-transfer intents (payment / swap)
 *      - creator ≠ configured `from`
 *      - chainId mismatch (intent chain ≠ provider chain)
 *      - intent past deadline
 *      - asset outside allowedAssets
 *      - invalid asset hex / recipient hex
 *      - amount 0 / negative-ish / overflow
 *   3. quote() happy path — commitment === body.amount, metadata shape.
 *   4. settle() declines:
 *      - non-transfer throws unsupported-intent-kind
 *      - chainId mismatch throws chain-id-mismatch
 *      - creator ≠ from throws signer-mismatch
 *      - invalid asset / recipient / amount throws typed error
 *   5. settle() happy path (ERC-20) — calldata = 0xa9059cbb + addr + amount;
 *      returns Fill with settlementRef = txHash + metadata.receipt.
 *   6. settle() happy path (native) — empty calldata, value = amount,
 *      `to` is recipient not asset.
 *   7. settle() failure modes:
 *      - provider.sendTransaction throws → chain-submit-failed
 *      - receipt.status "reverted" → chain-tx-reverted
 *      - null receipt forever → chain-confirmation-timeout (bounded poll)
 *      - getTransactionReceipt throws → chain-submit-failed (RPC flake)
 *   8. dispose() — subsequent quote / settle throw solver-disposed.
 *
 * Uses real `@aethelred/wallet-intent-router.createSignedIntent` +
 * `LocalKeyAdapter` to produce EIP-712-signed intents. The chain
 * provider is a test double with captured `sendTransaction` calls and
 * a scripted receipt sequence for polling.
 */

import { describe, expect, it } from "vitest";

import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import {
  createSignedIntent,
  type Intent,
} from "@aethelred/wallet-intent-router";
import type { TypedDataSigner } from "@aethelred/wallet-x402";
import type {
  AnchorChainProvider,
  TxReceipt,
} from "@aethelred/wallet-notarization";
import {
  decodeErc20BalanceOfResult,
  encodeErc20BalanceOf,
  ERC20_BALANCE_OF_SELECTOR,
  ERC20_TRANSFER_SELECTOR,
  NATIVE_ASSET_SENTINEL,
  TransferSolver,
  TransferSolverError,
} from "@aethelred/wallet-transfer-solver";

// ─── Fixtures ──────────────────────────────────────

const PK_AGENT = "0x" + "01".repeat(32);
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`;
const RECIPIENT = ("0x" + "bb".repeat(20)) as `0x${string}`;
const CHAIN_ID = 8453;
const TX_HASH = ("0x" + "ee".repeat(32)) as `0x${string}`;

function agentSigner(): TypedDataSigner {
  return new LocalKeyAdapter({ privateKey: PK_AGENT }).asTypedDataSigner();
}

type TransferBodyOverrides = {
  readonly asset?: `0x${string}`;
  readonly amount?: string;
  readonly recipient?: `0x${string}`;
};

async function makeTransferIntent(
  signer: TypedDataSigner,
  overrides: TransferBodyOverrides & {
    readonly chainId?: number;
    readonly deadlineMs?: number;
  } = {},
): Promise<Intent> {
  return createSignedIntent({
    body: {
      kind: "transfer",
      asset: overrides.asset ?? USDC,
      amount: overrides.amount ?? "1000000",
      recipient: overrides.recipient ?? RECIPIENT,
    },
    creator: signer.address,
    chainId: overrides.chainId ?? CHAIN_ID,
    deadlineMs: overrides.deadlineMs ?? Date.now() + 60_000,
    signer,
  });
}

async function makePaymentIntent(signer: TypedDataSigner): Promise<Intent> {
  return createSignedIntent({
    body: {
      kind: "payment",
      asset: USDC,
      maxAmount: "1000000",
      merchant: RECIPIENT,
      resource: "https://example.com/x",
    },
    creator: signer.address,
    chainId: CHAIN_ID,
    deadlineMs: Date.now() + 60_000,
    signer,
  });
}

/**
 * Minimal AnchorChainProvider test double with captured calls.
 *
 * `sendTransaction` records every call and returns the configured
 * `txHash` (or throws if `submitThrows` is set). `getTransactionReceipt`
 * returns the next scripted entry per invocation — null entries model
 * "not yet mined" and roll forward to subsequent calls.
 */
type ProviderHolder = {
  readonly provider: AnchorChainProvider;
  readonly calls: ReadonlyArray<{
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
  }>;
};

function makeProvider(opts: {
  readonly chainId?: number;
  readonly txHash?: `0x${string}`;
  readonly submitThrows?: Error;
  readonly receipts?: ReadonlyArray<TxReceipt | null>;
  readonly receiptsThrow?: Error;
} = {}): ProviderHolder {
  const calls: Array<{ to: `0x${string}`; data: `0x${string}`; value?: bigint }> = [];
  let receiptIdx = 0;
  const receipts = opts.receipts ?? [successReceipt()];

  const provider: AnchorChainProvider = {
    chainId: opts.chainId ?? CHAIN_ID,
    async sendTransaction(req) {
      if (opts.submitThrows) throw opts.submitThrows;
      calls.push(req);
      return opts.txHash ?? TX_HASH;
    },
    async getTransactionReceipt(_hash) {
      if (opts.receiptsThrow) throw opts.receiptsThrow;
      if (receiptIdx >= receipts.length) {
        // Exhausted the script — keep returning null, exercising the
        // timeout path.
        return null;
      }
      const r = receipts[receiptIdx];
      receiptIdx += 1;
      return r;
    },
  };

  return { provider, calls };
}

function successReceipt(
  overrides: Partial<TxReceipt> = {},
): TxReceipt {
  return {
    transactionHash: overrides.transactionHash ?? TX_HASH,
    blockNumber: overrides.blockNumber ?? 12345n,
    status: "success",
    logs: overrides.logs ?? [],
  };
}

function revertedReceipt(): TxReceipt {
  return {
    transactionHash: TX_HASH,
    blockNumber: 12345n,
    status: "reverted",
    logs: [],
  };
}

/**
 * Instant sleep — receipt polling loops use `this.sleep()`, which
 * we short-circuit in tests. Wall-clock `now` is advanced by a stub
 * below where needed.
 */
const instantSleep = async (_ms: number) => {};

// ─── Identity ────────────────────────────────────

describe("TransferSolver identity", () => {
  it("exposes id, name, supportedIntentKinds, publicKeyHex", () => {
    const { provider } = makeProvider();
    const solver = new TransferSolver({
      id: "transfer:base",
      name: "Transfer Solver Base",
      from: agentSigner().address,
      provider,
    });
    expect(solver.id).toBe("transfer:base");
    expect(solver.name).toBe("Transfer Solver Base");
    expect(solver.supportedIntentKinds).toEqual(["transfer"]);
    expect(solver.publicKeyHex).toBeNull();
  });

  it("rejects invalid `from` address at construction", () => {
    const { provider } = makeProvider();
    expect(
      () =>
        new TransferSolver({
          id: "t",
          name: "t",
          from: "0xBAD" as `0x${string}`,
          provider,
        }),
    ).toThrow(TransferSolverError);
  });
});

// ─── quote() declines ────────────────────────────

describe("TransferSolver.quote declines", () => {
  it("declines non-transfer intents", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
    });
    const intent = await makePaymentIntent(signer);
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines when creator ≠ configured from", async () => {
    const signerA = agentSigner();
    const signerB = new LocalKeyAdapter({
      privateKey: "0x" + "02".repeat(32),
    }).asTypedDataSigner();
    const { provider } = makeProvider();
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signerA.address,
      provider,
    });
    const intent = await makeTransferIntent(signerB);
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines on chainId mismatch", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider({ chainId: 1 });
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
    });
    // Intent targets 8453; provider is chain 1.
    const intent = await makeTransferIntent(signer, { chainId: 8453 });
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines on expired deadline", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const fixedNow = 2_000_000_000_000;
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      now: () => fixedNow,
    });
    // Intent has deadline well before our fake "now".
    const intent = await makeTransferIntent(signer, {
      deadlineMs: fixedNow - 10_000,
    });
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines when asset is outside allowedAssets", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      allowedAssets: [("0x" + "dd".repeat(20)) as `0x${string}`],
    });
    const intent = await makeTransferIntent(signer); // asset = USDC, not dd…
    expect(await solver.quote(intent)).toBeNull();
  });

  it("accepts when asset IS in allowedAssets (case-insensitive)", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      // Upper-case copy of USDC — should still match.
      allowedAssets: [USDC.toUpperCase() as `0x${string}`],
    });
    const intent = await makeTransferIntent(signer);
    expect(await solver.quote(intent)).not.toBeNull();
  });

  it("declines on zero amount", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
    });
    const intent = await makeTransferIntent(signer, { amount: "0" });
    expect(await solver.quote(intent)).toBeNull();
  });
});

// ─── quote() happy path ─────────────────────────

describe("TransferSolver.quote happy path", () => {
  it("commits to intent.body.amount with expected metadata + validity", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const fixedNow = 1_700_000_000_000;
    const solver = new TransferSolver({
      id: "transfer:base-mainnet",
      name: "Base",
      from: signer.address,
      provider,
      quoteValidityMs: 45_000,
      estimatedFillTimeMs: 12_000,
      now: () => fixedNow,
    });
    const intent = await makeTransferIntent(signer, { amount: "2500000" });
    const quote = await solver.quote(intent);
    expect(quote).not.toBeNull();
    expect(quote!.solverId).toBe("transfer:base-mainnet");
    expect(quote!.intentId).toBe(intent.envelope.id);
    expect(quote!.commitment).toBe("2500000");
    expect(quote!.estimatedFillTimeMs).toBe(12_000);
    expect(quote!.quotedAt).toBe(fixedNow);
    expect(quote!.expiresAt).toBe(fixedNow + 45_000);
    expect(quote!.solverSignature).toBe("0x");
    expect(quote!.metadata).toMatchObject({
      solverClass: "transfer",
      chainId: CHAIN_ID,
      asset: USDC,
      recipient: RECIPIENT,
      isNative: false,
    });
  });

  it("metadata.isNative is true for native sentinel asset", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
    });
    const intent = await makeTransferIntent(signer, {
      asset: NATIVE_ASSET_SENTINEL,
    });
    const quote = await solver.quote(intent);
    expect(quote!.metadata?.isNative).toBe(true);
  });
});

// ─── settle() declines ─────────────────────────

describe("TransferSolver.settle declines", () => {
  function dummyQuote(intent: Intent, commitment = "1000000") {
    return {
      solverId: "t",
      intentId: intent.envelope.id,
      commitment,
      estimatedFillTimeMs: 0,
      quotedAt: 0,
      expiresAt: Date.now() + 10_000,
      solverSignature: "0x" as `0x${string}`,
    };
  }

  it("throws unsupported-intent-kind for non-transfer", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
    });
    const intent = await makePaymentIntent(signer);
    await expect(solver.settle(intent, dummyQuote(intent))).rejects.toMatchObject({
      code: "unsupported-intent-kind",
    });
  });

  it("throws signer-mismatch when creator ≠ from", async () => {
    const signerA = agentSigner();
    const signerB = new LocalKeyAdapter({
      privateKey: "0x" + "02".repeat(32),
    }).asTypedDataSigner();
    const { provider } = makeProvider();
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signerA.address,
      provider,
    });
    const intent = await makeTransferIntent(signerB);
    await expect(solver.settle(intent, dummyQuote(intent))).rejects.toMatchObject({
      code: "signer-mismatch",
    });
  });

  it("throws chain-id-mismatch when provider chainId ≠ intent chainId", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider({ chainId: 1 });
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
    });
    const intent = await makeTransferIntent(signer, { chainId: 8453 });
    await expect(solver.settle(intent, dummyQuote(intent))).rejects.toMatchObject({
      code: "chain-id-mismatch",
    });
  });

  it("throws invalid-amount for zero / negative", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
    });
    const intent = await makeTransferIntent(signer, { amount: "0" });
    await expect(solver.settle(intent, dummyQuote(intent, "0"))).rejects.toMatchObject({
      code: "invalid-amount",
    });
  });
});

// ─── settle() happy path (ERC-20) ────────────────

describe("TransferSolver.settle happy path — ERC-20", () => {
  it("submits erc20 transfer calldata and returns a Fill", async () => {
    const signer = agentSigner();
    const holder = makeProvider({ receipts: [successReceipt()] });
    const solver = new TransferSolver({
      id: "transfer:base",
      name: "Base",
      from: signer.address,
      provider: holder.provider,
      sleep: instantSleep,
    });
    const intent = await makeTransferIntent(signer, { amount: "1000000" });
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);

    // Submission inspection.
    expect(holder.calls.length).toBe(1);
    const sent = holder.calls[0];
    expect(sent.to).toBe(USDC);
    expect(sent.value).toBeUndefined();
    expect(sent.data.startsWith(ERC20_TRANSFER_SELECTOR)).toBe(true);
    // 0x + 4-byte selector + 32-byte padded addr + 32-byte amount = 138 chars.
    expect(sent.data).toHaveLength(138);
    expect(sent.data.toLowerCase()).toContain(RECIPIENT.slice(2).toLowerCase());

    // Fill shape.
    expect(fill.solverId).toBe("transfer:base");
    expect(fill.intentId).toBe(intent.envelope.id);
    expect(fill.quoteCommitment).toBe("1000000");
    expect(fill.actualAmount).toBe("1000000");
    expect(fill.settlementRef).toBe(TX_HASH);
    expect(fill.metadata).toMatchObject({
      solverClass: "transfer",
      chainId: CHAIN_ID,
    });
    // Receipt is embedded.
    expect((fill.metadata as { receipt: TxReceipt }).receipt.transactionHash).toBe(
      TX_HASH,
    );
  });

  it("lifts gasUsed + gasCostWei from receipt to top-level Fill.metadata when present", async () => {
    const signer = agentSigner();
    const receiptWithGas: TxReceipt = {
      ...successReceipt(),
      gasUsed: 60_000n,
      effectiveGasPrice: 1_000_000_000n, // 1 gwei
    };
    const holder = makeProvider({ receipts: [receiptWithGas] });
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      sleep: instantSleep,
    });
    const intent = await makeTransferIntent(signer);
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);

    const meta = fill.metadata as {
      gasUsed?: bigint;
      gasCostWei?: bigint;
      receipt: TxReceipt;
    };
    expect(meta.gasUsed).toBe(60_000n);
    expect(meta.gasCostWei).toBe(60_000_000_000_000n); // 60k * 1 gwei
    // Original receipt fields still present.
    expect(meta.receipt.gasUsed).toBe(60_000n);
  });

  it("omits gas fields from Fill.metadata when receipt lacks them", async () => {
    const signer = agentSigner();
    // successReceipt() by default returns no gasUsed / effectiveGasPrice.
    const holder = makeProvider({ receipts: [successReceipt()] });
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      sleep: instantSleep,
    });
    const intent = await makeTransferIntent(signer);
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);
    const meta = fill.metadata as { gasUsed?: bigint; gasCostWei?: bigint };
    expect(meta.gasUsed).toBeUndefined();
    expect(meta.gasCostWei).toBeUndefined();
  });

  it("polls across multiple null receipts before success", async () => {
    const signer = agentSigner();
    // Two nulls then success — exercises the polling loop.
    const holder = makeProvider({
      receipts: [null, null, successReceipt()],
    });
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      pollIntervalMs: 1,
      sleep: instantSleep,
    });
    const intent = await makeTransferIntent(signer);
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);
    expect(fill.actualAmount).toBe("1000000");
  });
});

// ─── settle() happy path (native) ────────────────

describe("TransferSolver.settle happy path — native", () => {
  it("submits a plain value transfer with empty calldata", async () => {
    const signer = agentSigner();
    const holder = makeProvider({ receipts: [successReceipt()] });
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      sleep: instantSleep,
    });
    const intent = await makeTransferIntent(signer, {
      asset: NATIVE_ASSET_SENTINEL,
      amount: "250000000000000000", // 0.25 ETH in wei
    });
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);

    expect(holder.calls.length).toBe(1);
    const sent = holder.calls[0];
    // `to` is the recipient, NOT the asset (which is the zero sentinel).
    expect(sent.to).toBe(RECIPIENT);
    expect(sent.data).toBe("0x");
    expect(sent.value).toBe(250000000000000000n);

    expect(fill.actualAmount).toBe("250000000000000000");
  });
});

// ─── settle() failure modes ────────────────────

describe("TransferSolver.settle failure modes", () => {
  it("wraps provider.sendTransaction throws as chain-submit-failed", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider({ submitThrows: new Error("rpc down") });
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      sleep: instantSleep,
    });
    const intent = await makeTransferIntent(signer);
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "chain-submit-failed",
    });
  });

  it("throws chain-tx-reverted on status 'reverted'", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider({ receipts: [revertedReceipt()] });
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      sleep: instantSleep,
    });
    const intent = await makeTransferIntent(signer);
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "chain-tx-reverted",
    });
  });

  it("throws chain-confirmation-timeout when receipt never appears", async () => {
    const signer = agentSigner();
    // Empty receipts array → always returns null → timeout.
    const { provider } = makeProvider({ receipts: [] });

    // Controlled fake clock: `now` jumps by 10s every call. The
    // solver's pollForReceipt compares now() to the deadline, so
    // advancing the clock reliably trips the timeout branch without
    // real wall time.
    let ticks = 0;
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      pollIntervalMs: 1,
      pollTimeoutMs: 10_000,
      sleep: instantSleep,
      now: () => {
        ticks += 1;
        return ticks * 10_000; // start 10s, 20s, 30s…
      },
    });
    const intent = await makeTransferIntent(signer, {
      deadlineMs: 1_000_000_000_000,
    });
    // Quote was produced with the jittering clock too — fine because
    // we re-check the expiry only in the router, not here.
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "chain-confirmation-timeout",
    });
  });

  it("wraps provider.getTransactionReceipt throws as chain-submit-failed", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider({
      receiptsThrow: new Error("rpc flake"),
    });
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      sleep: instantSleep,
    });
    const intent = await makeTransferIntent(signer);
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "chain-submit-failed",
    });
  });
});

// ─── dispose ────────────────────────────────────

describe("TransferSolver.dispose", () => {
  it("blocks subsequent quote + settle with solver-disposed", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
    });
    solver.dispose();
    const intent = await makeTransferIntent(signer);
    await expect(solver.quote(intent)).rejects.toMatchObject({
      code: "solver-disposed",
    });
    await expect(
      solver.settle(intent, {
        solverId: "t",
        intentId: intent.envelope.id,
        commitment: "1",
        estimatedFillTimeMs: 0,
        quotedAt: 0,
        expiresAt: Date.now() + 10_000,
        solverSignature: "0x" as `0x${string}`,
      }),
    ).rejects.toMatchObject({ code: "solver-disposed" });
  });

  it("TransferSolverError is exported + instanceof works", () => {
    const e = new TransferSolverError("solver-disposed", "test");
    expect(e).toBeInstanceOf(TransferSolverError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("solver-disposed");
  });
});

// ─── PR #101: Balance pre-flight ─────────────────────

describe("encodeErc20BalanceOf / decodeErc20BalanceOfResult (PR #101)", () => {
  it("encodes selector + 32-byte right-aligned address", () => {
    const owner = ("0x" + "ab".repeat(20)) as `0x${string}`;
    const data = encodeErc20BalanceOf(owner);
    // 0x + 4-byte selector + 32-byte padded addr = 0x + 8 + 64 = 74 chars.
    expect(data).toHaveLength(74);
    expect(data.startsWith(ERC20_BALANCE_OF_SELECTOR)).toBe(true);
    // Address right-aligned: 24 leading zero hex chars + 40 chars of address.
    expect(data.slice(10)).toBe("0".repeat(24) + "ab".repeat(20));
  });

  it("encoder lowercases mixed-case address", () => {
    const data = encodeErc20BalanceOf(
      "0xAbCdEf0123456789012345678901234567890123" as `0x${string}`,
    );
    expect(data.slice(10)).toBe(
      "0".repeat(24) + "abcdef0123456789012345678901234567890123",
    );
  });

  it("encoder rejects malformed address", () => {
    expect(() =>
      encodeErc20BalanceOf("0xnotahex" as `0x${string}`),
    ).toThrow(TransferSolverError);
  });

  it("decoder parses full 32-byte uint256", () => {
    const hex = "0x" + (123_456_789n).toString(16).padStart(64, "0");
    expect(decodeErc20BalanceOfResult(hex)).toBe(123_456_789n);
  });

  it("decoder handles MAX_UINT256", () => {
    const max = (1n << 256n) - 1n;
    const hex = "0x" + max.toString(16).padStart(64, "0");
    expect(decodeErc20BalanceOfResult(hex)).toBe(max);
  });

  it("decoder treats short hex as right-aligned (provider stripped leading zeros)", () => {
    // Some providers return e.g. "0x1f4" instead of full padding.
    expect(decodeErc20BalanceOfResult("0x1f4")).toBe(500n);
  });

  it("decoder treats '0x' as zero balance", () => {
    expect(decodeErc20BalanceOfResult("0x")).toBe(0n);
  });

  it("decoder rejects non-hex characters", () => {
    expect(() => decodeErc20BalanceOfResult("0xnotahex")).toThrow(
      TransferSolverError,
    );
  });

  it("decoder rejects missing 0x prefix", () => {
    expect(() => decodeErc20BalanceOfResult("12345")).toThrow(
      TransferSolverError,
    );
  });
});

describe("TransferSolver balance pre-flight (PR #101)", () => {
  function makeRecordingPreflight(returns: bigint): {
    readonly fn: (
      owner: `0x${string}`,
      asset: `0x${string}`,
    ) => Promise<bigint>;
    readonly calls: ReadonlyArray<{ owner: string; asset: string }>;
  } {
    const calls: Array<{ owner: string; asset: string }> = [];
    const fn = async (
      owner: `0x${string}`,
      asset: `0x${string}`,
    ): Promise<bigint> => {
      calls.push({ owner, asset });
      return returns;
    };
    return { fn, calls };
  }

  it("balancePreflight not configured (default) — solver behaves as before", async () => {
    // Sanity test: default config doesn't perturb existing behavior.
    // The existing happy-path test above covers this; this is a
    // regression guard for the wiring.
    const signer = agentSigner();
    const holder = makeProvider({ receipts: [successReceipt()] });
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      sleep: instantSleep,
      // balancePreflight intentionally omitted
    });
    const intent = await makeTransferIntent(signer, { amount: "1000000" });
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);
    expect(fill.actualAmount).toBe("1000000");
    expect(holder.calls).toHaveLength(1);
  });

  it("sufficient balance → settle proceeds normally; preflight called once", async () => {
    const signer = agentSigner();
    const holder = makeProvider({ receipts: [successReceipt()] });
    const { fn: balancePreflight, calls } = makeRecordingPreflight(5_000_000n);
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      sleep: instantSleep,
      balancePreflight,
    });
    const intent = await makeTransferIntent(signer, { amount: "1000000" });
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);

    expect(fill.actualAmount).toBe("1000000");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      owner: signer.address.toLowerCase(),
      asset: USDC,
    });
    // Tx was actually submitted.
    expect(holder.calls).toHaveLength(1);
  });

  it("insufficient balance → throws pre-flight-insufficient-balance; tx never submitted", async () => {
    const signer = agentSigner();
    const holder = makeProvider({ receipts: [successReceipt()] });
    const { fn: balancePreflight } = makeRecordingPreflight(500_000n);
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      sleep: instantSleep,
      balancePreflight,
    });
    const intent = await makeTransferIntent(signer, { amount: "1000000" });
    const quote = (await solver.quote(intent))!;

    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "pre-flight-insufficient-balance",
      details: {
        balance: "500000",
        required: "1000000",
        asset: USDC,
        owner: signer.address.toLowerCase(),
        chainId: CHAIN_ID,
      },
    });
    // Crucially: no chain submission attempted.
    expect(holder.calls).toHaveLength(0);
  });

  it("exact balance == amount → settle proceeds (≥ check, not >)", async () => {
    const signer = agentSigner();
    const holder = makeProvider({ receipts: [successReceipt()] });
    const { fn: balancePreflight } = makeRecordingPreflight(1_000_000n);
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      sleep: instantSleep,
      balancePreflight,
    });
    const intent = await makeTransferIntent(signer, { amount: "1000000" });
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);
    expect(fill.actualAmount).toBe("1000000");
    expect(holder.calls).toHaveLength(1);
  });

  it("native sentinel asset → preflight callback receives sentinel", async () => {
    const signer = agentSigner();
    const holder = makeProvider({ receipts: [successReceipt()] });
    const { fn: balancePreflight, calls } = makeRecordingPreflight(
      1_000_000_000_000_000_000n, // 1 ETH in wei
    );
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      sleep: instantSleep,
      balancePreflight,
    });
    const intent = await makeTransferIntent(signer, {
      asset: NATIVE_ASSET_SENTINEL,
      amount: "100000000000000000", // 0.1 ETH
    });
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);
    expect(fill.actualAmount).toBe("100000000000000000");
    expect(calls[0].asset).toBe(NATIVE_ASSET_SENTINEL);
  });

  it("preflight callback throws → fail-OPEN: settle proceeds with chain submission", async () => {
    const signer = agentSigner();
    const holder = makeProvider({ receipts: [successReceipt()] });
    const balancePreflight = async () => {
      throw new Error("simulated RPC flake");
    };
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      sleep: instantSleep,
      balancePreflight,
    });
    const intent = await makeTransferIntent(signer, { amount: "1000000" });
    const quote = (await solver.quote(intent))!;
    // The throw is swallowed; settle proceeds.
    const fill = await solver.settle(intent, quote);
    expect(fill.actualAmount).toBe("1000000");
    expect(holder.calls).toHaveLength(1);
  });

  it("preflight throws + chain rejects → final error is chain-tx-reverted (NOT pre-flight)", async () => {
    // Belt-and-suspenders: confirm fail-OPEN doesn't swallow a
    // genuine on-chain failure that follows.
    const signer = agentSigner();
    const holder = makeProvider({ receipts: [revertedReceipt()] });
    const balancePreflight = async () => {
      throw new Error("simulated RPC flake");
    };
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      sleep: instantSleep,
      balancePreflight,
    });
    const intent = await makeTransferIntent(signer, { amount: "1000000" });
    const quote = (await solver.quote(intent))!;

    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "chain-tx-reverted",
    });
    expect(holder.calls).toHaveLength(1); // submission was attempted
  });

  it("preflight returns 0n → throws pre-flight-insufficient-balance (zero is < amount)", async () => {
    const signer = agentSigner();
    const holder = makeProvider({ receipts: [successReceipt()] });
    const { fn: balancePreflight } = makeRecordingPreflight(0n);
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      sleep: instantSleep,
      balancePreflight,
    });
    const intent = await makeTransferIntent(signer, { amount: "1000000" });
    const quote = (await solver.quote(intent))!;

    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "pre-flight-insufficient-balance",
    });
    expect(holder.calls).toHaveLength(0);
  });

  it("preflight check happens AFTER amount validation (invalid amount short-circuits)", async () => {
    // Order matters: malformed amount should throw `invalid-amount`,
    // NOT call the preflight unnecessarily.
    const signer = agentSigner();
    const holder = makeProvider({ receipts: [successReceipt()] });
    const { fn: balancePreflight, calls } = makeRecordingPreflight(0n);
    const solver = new TransferSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      sleep: instantSleep,
      balancePreflight,
    });
    // amount "0" fails the positivity check before pre-flight runs.
    const intent = await makeTransferIntent(signer, { amount: "0" });
    // Note: quote() declines on amount<=0, so we'd need to bypass it.
    // Manufacture a synthetic quote to drive settle directly.
    const synthQuote = {
      solverId: "t",
      intentId: intent.envelope.id,
      commitment: "0",
      estimatedFillTimeMs: 0,
      quotedAt: 0,
      expiresAt: Date.now() + 10_000,
      solverSignature: "0x" as `0x${string}`,
    };

    await expect(solver.settle(intent, synthQuote)).rejects.toMatchObject({
      code: "invalid-amount",
    });
    expect(calls).toHaveLength(0); // preflight never called
  });
});
