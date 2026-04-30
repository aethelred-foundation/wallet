/**
 * SwapSolver + StubSwapVenue tests.
 *
 * Coverage:
 *
 *   1. Solver identity — id / name / supportedIntentKinds ["swap"]
 *      / publicKeyHex null.
 *   2. Constructor guards — invalid `from`, venue/provider chainId
 *      mismatch, slippageBps out of range.
 *   3. StubSwapVenue unit — quote math, pair filter,
 *      forceNoLiquidity, scripted decode, fallback decode.
 *   4. quote() declines for every guard:
 *      - non-swap intents (transfer / payment)
 *      - creator ≠ configured `from`
 *      - chainId mismatch
 *      - past deadline
 *      - invalid sellAsset / buyAsset / recipient hex
 *      - same sellAsset and buyAsset
 *      - pair outside allowedPairs
 *      - zero / overflow amounts
 *      - venue returns null (no liquidity)
 *      - venue throws during quote (degrades to decline)
 *      - venue floor below intent.minBuyAmount
 *   5. quote() happy path — commitment = expected * (1 - bps) / 1,
 *      metadata shape (includes expectedBuyAmount + internalSlippageBps).
 *   6. settle() declines:
 *      - non-swap → unsupported-intent-kind
 *      - creator mismatch → signer-mismatch
 *      - chainId mismatch → chain-id-mismatch
 *      - same-asset → same-sell-and-buy-asset
 *      - invalid amounts → invalid-amount
 *   7. settle() failure modes:
 *      - venue quote at settle time returns null → venue-no-liquidity
 *      - venue quote at settle throws → venue-quote-failed
 *      - venue floor dropped below commitment → venue-quote-below-min-buy-amount
 *      - buildSwapTxs throws → venue-build-failed
 *      - buildSwapTxs returns empty → venue-build-failed
 *      - provider.sendTransaction throws on any tx → chain-submit-failed
 *      - receipt reverts → chain-tx-reverted
 *      - receipt never appears → chain-confirmation-timeout
 *      - getTransactionReceipt throws → chain-submit-failed
 *      - decodeFillAmount throws → venue-decode-failed
 *      - decoded fill below commitment → fill-below-commitment
 *   8. settle() happy path:
 *      - single-tx venue (stub default)
 *      - multi-tx venue (custom venue returning [approve, swap])
 *      - native sell-asset path (value carried, not data)
 *   9. dispose() — subsequent quote / settle throw solver-disposed.
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
  StubSwapVenue,
  SwapSolver,
  SwapSolverError,
  pairOf,
  type SwapBuildParams,
  type SwapQuoteParams,
  type SwapQuoteResult,
  type SwapTxRequest,
  type SwapVenue,
} from "@aethelred/wallet-swap-solver";

// ─── Fixtures ──────────────────────────────────────

const PK_AGENT = "0x" + "01".repeat(32);
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`;
const WETH = "0x4200000000000000000000000000000000000006" as `0x${string}`;
const NATIVE = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const RECIPIENT = ("0x" + "bb".repeat(20)) as `0x${string}`;
const ROUTER = ("0x" + "cc".repeat(20)) as `0x${string}`;
const CHAIN_ID = 8453;
const TX_HASH = ("0x" + "ee".repeat(32)) as `0x${string}`;

function agentSigner(): TypedDataSigner {
  return new LocalKeyAdapter({ privateKey: PK_AGENT }).asTypedDataSigner();
}

async function makeSwapIntent(
  signer: TypedDataSigner,
  overrides: {
    readonly sellAsset?: `0x${string}`;
    readonly sellAmount?: string;
    readonly buyAsset?: `0x${string}`;
    readonly minBuyAmount?: string;
    readonly recipient?: `0x${string}`;
    readonly chainId?: number;
    readonly deadlineMs?: number;
  } = {},
): Promise<Intent> {
  return createSignedIntent({
    body: {
      kind: "swap",
      sellAsset: overrides.sellAsset ?? USDC,
      sellAmount: overrides.sellAmount ?? "1000000", // 1 USDC
      buyAsset: overrides.buyAsset ?? WETH,
      // Priced with headroom so the default 50-bps internal slippage
      // doesn't drop the floor below the min. Tests wanting tight
      // bounds override this explicitly.
      minBuyAmount: overrides.minBuyAmount ?? "99000000000000", // 0.000099 WETH
      recipient: overrides.recipient ?? RECIPIENT,
    },
    creator: signer.address,
    chainId: overrides.chainId ?? CHAIN_ID,
    deadlineMs: overrides.deadlineMs ?? Date.now() + 60_000,
    signer,
  });
}

async function makeTransferIntent(signer: TypedDataSigner): Promise<Intent> {
  return createSignedIntent({
    body: {
      kind: "transfer",
      asset: USDC,
      amount: "1000000",
      recipient: RECIPIENT,
    },
    creator: signer.address,
    chainId: CHAIN_ID,
    deadlineMs: Date.now() + 60_000,
    signer,
  });
}

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
  readonly txHashes?: ReadonlyArray<`0x${string}`>;
  readonly submitThrowsOnCall?: number; // 1-indexed tx in sequence
  readonly receipts?: ReadonlyArray<TxReceipt | null>;
  readonly receiptsThrow?: Error;
} = {}): ProviderHolder {
  const calls: Array<{ to: `0x${string}`; data: `0x${string}`; value?: bigint }> = [];
  let sendCount = 0;
  let receiptIdx = 0;
  const receipts = opts.receipts ?? [successReceipt()];
  const hashes = opts.txHashes ?? [TX_HASH];

  const provider: AnchorChainProvider = {
    chainId: opts.chainId ?? CHAIN_ID,
    async sendTransaction(req) {
      sendCount += 1;
      if (opts.submitThrowsOnCall && sendCount === opts.submitThrowsOnCall) {
        throw new Error("rpc down");
      }
      calls.push(req);
      return hashes[sendCount - 1] ?? TX_HASH;
    },
    async getTransactionReceipt(_hash) {
      if (opts.receiptsThrow) throw opts.receiptsThrow;
      if (receiptIdx >= receipts.length) return null;
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

function revertedReceipt(hash: `0x${string}` = TX_HASH): TxReceipt {
  return {
    transactionHash: hash,
    blockNumber: 12345n,
    status: "reverted",
    logs: [],
  };
}

const instantSleep = async (_ms: number) => {};

function makeVenue(opts: Partial<ConstructorParameters<typeof StubSwapVenue>[0]> = {}) {
  return new StubSwapVenue({
    id: "stub-v1",
    chainId: CHAIN_ID,
    router: ROUTER,
    priceNumerator: 100000000000000n, // 1 USDC = 0.0001 WETH (mid)
    priceDenominator: 1000000n,
    ...opts,
  });
}

// ─── Identity + constructor ────────────────────────

describe("SwapSolver identity", () => {
  it("exposes id, name, supportedIntentKinds, publicKeyHex", () => {
    const { provider } = makeProvider();
    const solver = new SwapSolver({
      id: "swap:base",
      name: "Swap Solver Base",
      from: agentSigner().address,
      provider,
      venue: makeVenue(),
    });
    expect(solver.id).toBe("swap:base");
    expect(solver.name).toBe("Swap Solver Base");
    expect(solver.supportedIntentKinds).toEqual(["swap"]);
    expect(solver.publicKeyHex).toBeNull();
  });

  it("rejects invalid `from` at construction", () => {
    const { provider } = makeProvider();
    expect(
      () =>
        new SwapSolver({
          id: "t",
          name: "t",
          from: "0xBAD" as `0x${string}`,
          provider,
          venue: makeVenue(),
        }),
    ).toThrow(SwapSolverError);
  });

  it("rejects venue/provider chainId mismatch at construction", () => {
    const { provider } = makeProvider({ chainId: 1 });
    try {
      new SwapSolver({
        id: "t",
        name: "t",
        from: agentSigner().address,
        provider,
        venue: makeVenue({ chainId: 8453 }),
      });
      // eslint-disable-next-line no-undef
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SwapSolverError);
      expect((e as SwapSolverError).code).toBe("chain-id-mismatch");
    }
  });

  it("rejects internalSlippageBps out of range", () => {
    const { provider } = makeProvider();
    expect(
      () =>
        new SwapSolver({
          id: "t",
          name: "t",
          from: agentSigner().address,
          provider,
          venue: makeVenue(),
          internalSlippageBps: 15_000,
        }),
    ).toThrow(SwapSolverError);
    expect(
      () =>
        new SwapSolver({
          id: "t",
          name: "t",
          from: agentSigner().address,
          provider,
          venue: makeVenue(),
          internalSlippageBps: -1,
        }),
    ).toThrow(SwapSolverError);
  });
});

// ─── StubSwapVenue unit ────────────────────────────

describe("StubSwapVenue", () => {
  it("quotes at the configured mid-price", async () => {
    const venue = makeVenue();
    const r = await venue.quote({
      chainId: CHAIN_ID,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: WETH,
    });
    expect(r).not.toBeNull();
    expect(r!.expectedBuyAmount).toBe(100_000_000_000_000n);
  });

  it("returns null on pair outside routablePairs", async () => {
    const venue = makeVenue({ routablePairs: [pairOf(USDC, WETH)] });
    expect(
      await venue.quote({
        chainId: CHAIN_ID,
        sellAsset: WETH, // flipped
        sellAmount: 1n,
        buyAsset: USDC,
      }),
    ).toBeNull();
  });

  it("returns null when forced no-liquidity", async () => {
    const venue = makeVenue({ forceNoLiquidity: true });
    expect(
      await venue.quote({
        chainId: CHAIN_ID,
        sellAsset: USDC,
        sellAmount: 1_000_000n,
        buyAsset: WETH,
      }),
    ).toBeNull();
  });

  it("decodes from scripted map when present", () => {
    const map = new Map<`0x${string}`, bigint>([[TX_HASH, 99_999n]]);
    const venue = makeVenue({ scriptedDecodes: map });
    expect(
      venue.decodeFillAmount({
        receipt: successReceipt(),
        recipient: RECIPIENT,
        buyAsset: WETH,
      }),
    ).toBe(99_999n);
  });

  it("decodes from venueData fallback when scripted absent", () => {
    const venue = makeVenue();
    expect(
      venue.decodeFillAmount({
        receipt: successReceipt(),
        recipient: RECIPIENT,
        buyAsset: WETH,
        venueData: { expectedBuyAmount: 123_456n },
      }),
    ).toBe(123_456n);
  });

  it("decodes 0n with no scripted entry + no venueData", () => {
    const venue = makeVenue();
    expect(
      venue.decodeFillAmount({
        receipt: successReceipt(),
        recipient: RECIPIENT,
        buyAsset: WETH,
      }),
    ).toBe(0n);
  });

  // ─── PR #120: exact-output methods ──────────────────────

  it("quoteExactOutput: inverse of forward formula (sellAmount = buyAmount * den / num, ceil)", async () => {
    const venue = makeVenue();
    const r = await venue.quoteExactOutput({
      chainId: CHAIN_ID,
      sellAsset: USDC,
      buyAsset: WETH,
      buyAmount: 100_000_000_000_000n, // 0.0001 WETH
    });
    // priceNumerator=1e14, priceDenominator=1e6
    // expectedSellAmount = ceil(1e14 * 1e6 / 1e14) = 1e6 = 1 USDC
    expect(r).not.toBeNull();
    expect(r!.expectedSellAmount).toBe(1_000_000n);
    expect(r!.venueData).toEqual({ expectedBuyAmount: 100_000_000_000_000n });
  });

  it("quoteExactOutput: rounds UP to avoid under-quoting", async () => {
    // buyAmount=1, priceNumerator=3, priceDenominator=2
    // exact result: 1 * 2 / 3 = 0.667 → CEIL → 1
    const venue = new StubSwapVenue({
      id: "ceil-test",
      chainId: CHAIN_ID,
      router: ROUTER,
      priceNumerator: 3n,
      priceDenominator: 2n,
    });
    const r = await venue.quoteExactOutput({
      chainId: CHAIN_ID,
      sellAsset: USDC,
      buyAsset: WETH,
      buyAmount: 1n,
    });
    expect(r!.expectedSellAmount).toBe(1n); // ceiling, not 0
  });

  it("quoteExactOutput: returns null when chain id mismatches", async () => {
    const venue = makeVenue();
    expect(
      await venue.quoteExactOutput({
        chainId: 1, // wrong chain
        sellAsset: USDC,
        buyAsset: WETH,
        buyAmount: 1n,
      }),
    ).toBeNull();
  });

  it("quoteExactOutput: returns null when forceNoLiquidity", async () => {
    const venue = makeVenue({ forceNoLiquidity: true });
    expect(
      await venue.quoteExactOutput({
        chainId: CHAIN_ID,
        sellAsset: USDC,
        buyAsset: WETH,
        buyAmount: 1n,
      }),
    ).toBeNull();
  });

  it("quoteExactOutput: respects routablePairs filter", async () => {
    const venue = makeVenue({
      routablePairs: [`${WETH.toLowerCase()}-${USDC.toLowerCase()}`],
    });
    // Pair USDC→WETH not in list — null.
    expect(
      await venue.quoteExactOutput({
        chainId: CHAIN_ID,
        sellAsset: USDC,
        buyAsset: WETH,
        buyAmount: 1n,
      }),
    ).toBeNull();
  });

  it("buildExactOutputSwapTxs: emits single tx with exact-output stub selector", async () => {
    const venue = makeVenue();
    const txs = await venue.buildExactOutputSwapTxs({
      chainId: CHAIN_ID,
      sellAsset: USDC,
      buyAsset: WETH,
      recipient: RECIPIENT,
      buyAmount: 100_000_000_000_000n,
      amountInMaximum: 1_500_000n,
      deadlineMs: Date.now() + 60_000,
    });
    expect(txs).toHaveLength(1);
    expect(txs[0].label).toBe("swap");
    expect(txs[0].to).toBe(ROUTER);
    // Stub uses selector 0x87654321 for exact-output (vs 0x12345678 for exact-input)
    expect(txs[0].data.startsWith("0x87654321")).toBe(true);
  });

  it("buildExactOutputSwapTxs: native sell uses amountInMaximum as value", async () => {
    const venue = makeVenue();
    const txs = await venue.buildExactOutputSwapTxs({
      chainId: CHAIN_ID,
      sellAsset: NATIVE,
      buyAsset: WETH,
      recipient: RECIPIENT,
      buyAmount: 100_000_000_000_000n,
      amountInMaximum: 1_500_000n,
      deadlineMs: Date.now() + 60_000,
    });
    // Native sell: value === amountInMaximum (the ceiling — chain refunds excess)
    expect(txs[0].value).toBe(1_500_000n);
  });

  it("buildExactOutputSwapTxs: forceBuildThrow propagates", async () => {
    const venue = makeVenue({
      forceBuildThrow: new Error("simulated build failure"),
    });
    await expect(
      venue.buildExactOutputSwapTxs({
        chainId: CHAIN_ID,
        sellAsset: USDC,
        buyAsset: WETH,
        recipient: RECIPIENT,
        buyAmount: 1n,
        amountInMaximum: 1n,
        deadlineMs: Date.now() + 60_000,
      }),
    ).rejects.toThrow("simulated build failure");
  });
});

// ─── quote() declines ──────────────────────────────

describe("SwapSolver.quote declines", () => {
  function makeSolver(overrides: Partial<ConstructorParameters<typeof SwapSolver>[0]> = {}) {
    const { provider } = makeProvider();
    return new SwapSolver({
      id: "t",
      name: "t",
      from: agentSigner().address,
      provider,
      venue: makeVenue(),
      ...overrides,
    });
  }

  it("declines non-swap intents", async () => {
    const signer = agentSigner();
    const solver = makeSolver();
    const intent = await makeTransferIntent(signer);
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines when creator ≠ configured from", async () => {
    const signerA = agentSigner();
    const signerB = new LocalKeyAdapter({
      privateKey: "0x" + "02".repeat(32),
    }).asTypedDataSigner();
    const solver = makeSolver({ from: signerA.address });
    const intent = await makeSwapIntent(signerB);
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines on chainId mismatch", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider({ chainId: 1 });
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: makeVenue({ chainId: 1 }),
    });
    const intent = await makeSwapIntent(signer, { chainId: 8453 });
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines on expired deadline", async () => {
    const signer = agentSigner();
    const fixedNow = 2_000_000_000_000;
    const solver = makeSolver({ from: signer.address, now: () => fixedNow });
    const intent = await makeSwapIntent(signer, { deadlineMs: fixedNow - 10 });
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines on same sellAsset and buyAsset", async () => {
    const signer = agentSigner();
    const solver = makeSolver({ from: signer.address });
    const intent = await makeSwapIntent(signer, {
      sellAsset: USDC,
      buyAsset: USDC,
    });
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines on pair outside allowedPairs", async () => {
    const signer = agentSigner();
    const solver = makeSolver({
      from: signer.address,
      allowedPairs: [pairOf(USDC, NATIVE)], // only USDC→native allowed
    });
    const intent = await makeSwapIntent(signer); // USDC→WETH
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines on zero sellAmount", async () => {
    const signer = agentSigner();
    const solver = makeSolver({ from: signer.address });
    const intent = await makeSwapIntent(signer, { sellAmount: "0" });
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines when venue returns null (no liquidity)", async () => {
    const signer = agentSigner();
    const solver = makeSolver({
      from: signer.address,
      venue: makeVenue({ forceNoLiquidity: true }),
    });
    const intent = await makeSwapIntent(signer);
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines when venue throws during quote (degrades to decline)", async () => {
    const signer = agentSigner();
    const throwingVenue: SwapVenue = {
      id: "broken",
      chainId: CHAIN_ID,
      quote: async () => {
        throw new Error("venue oops");
      },
      buildSwapTxs: async () => [],
      decodeFillAmount: () => 0n,
    };
    const { provider } = makeProvider();
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: throwingVenue,
    });
    const intent = await makeSwapIntent(signer);
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines when venue floor < intent.minBuyAmount", async () => {
    const signer = agentSigner();
    // Quote is 1 USDC = 0.0001 WETH = 100_000_000_000_000 wei.
    // With 50 bps slippage, floor = 99_500_000_000_000. Intent asks
    // for 200_000_000_000_000 minimum → unserveable.
    const solver = makeSolver({ from: signer.address });
    const intent = await makeSwapIntent(signer, {
      minBuyAmount: "200000000000000",
    });
    expect(await solver.quote(intent)).toBeNull();
  });
});

// ─── quote() happy path ────────────────────────────

describe("SwapSolver.quote happy path", () => {
  it("commits to expected * (1 - bps) with full metadata", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const fixedNow = 1_700_000_000_000;
    const solver = new SwapSolver({
      id: "swap:stub:base",
      name: "Stub",
      from: signer.address,
      provider,
      venue: makeVenue(),
      internalSlippageBps: 100, // 1%
      quoteValidityMs: 15_000,
      estimatedFillTimeMs: 9_000,
      now: () => fixedNow,
    });
    const intent = await makeSwapIntent(signer, {
      sellAmount: "1000000", // 1 USDC
      minBuyAmount: "99000000000000", // 0.000099 WETH — matches 1% floor
    });
    const quote = await solver.quote(intent);
    expect(quote).not.toBeNull();
    expect(quote!.solverId).toBe("swap:stub:base");
    expect(quote!.intentId).toBe(intent.envelope.id);
    // mid = 100_000_000_000_000, 1% off = 99_000_000_000_000
    expect(quote!.commitment).toBe("99000000000000");
    expect(quote!.estimatedFillTimeMs).toBe(9_000);
    expect(quote!.quotedAt).toBe(fixedNow);
    expect(quote!.expiresAt).toBe(fixedNow + 15_000);
    expect(quote!.metadata).toMatchObject({
      solverClass: "swap",
      chainId: CHAIN_ID,
      venueId: "stub-v1",
      sellAsset: USDC,
      buyAsset: WETH,
      sellAmount: "1000000",
      expectedBuyAmount: "100000000000000",
      internalSlippageBps: 100,
    });
  });
});

// ─── settle() declines ─────────────────────────────

describe("SwapSolver.settle declines", () => {
  function dummyQuote(intent: Intent, commitment = "99500000000000") {
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

  it("throws unsupported-intent-kind for non-swap", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: makeVenue(),
    });
    const intent = await makeTransferIntent(signer);
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
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signerA.address,
      provider,
      venue: makeVenue(),
    });
    const intent = await makeSwapIntent(signerB);
    await expect(solver.settle(intent, dummyQuote(intent))).rejects.toMatchObject({
      code: "signer-mismatch",
    });
  });

  it("throws chain-id-mismatch when provider chainId ≠ intent chainId", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider({ chainId: 1 });
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: makeVenue({ chainId: 1 }),
    });
    const intent = await makeSwapIntent(signer, { chainId: 8453 });
    await expect(solver.settle(intent, dummyQuote(intent))).rejects.toMatchObject({
      code: "chain-id-mismatch",
    });
  });

  it("throws same-sell-and-buy-asset when assets match", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: makeVenue(),
    });
    const intent = await makeSwapIntent(signer, {
      sellAsset: USDC,
      buyAsset: USDC,
    });
    await expect(solver.settle(intent, dummyQuote(intent))).rejects.toMatchObject({
      code: "same-sell-and-buy-asset",
    });
  });

  it("throws invalid-amount for zero sellAmount", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: makeVenue(),
    });
    const intent = await makeSwapIntent(signer, { sellAmount: "0" });
    await expect(solver.settle(intent, dummyQuote(intent, "1"))).rejects.toMatchObject({
      code: "invalid-amount",
    });
  });
});

// ─── settle() failure modes ────────────────────────

describe("SwapSolver.settle failure modes", () => {
  it("throws venue-no-liquidity if venue returns null at settle", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const venue = makeVenue();
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue,
      sleep: instantSleep,
    });
    const intent = await makeSwapIntent(signer);
    const quote = (await solver.quote(intent))!;
    // Now flip the venue into no-liquidity mode before settle.
    const flipped = makeVenue({ forceNoLiquidity: true });
    const solver2 = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: flipped,
      sleep: instantSleep,
    });
    await expect(solver2.settle(intent, quote)).rejects.toMatchObject({
      code: "venue-no-liquidity",
    });
  });

  it("throws venue-quote-failed if venue throws during settle-time quote", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const intent = await makeSwapIntent(signer);
    // Build a quote via a working venue, then hand a throwing venue
    // to the solver at settle time to exercise the catch.
    const working = makeVenue();
    const quoteOnly = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: working,
    });
    const quote = (await quoteOnly.quote(intent))!;

    const throwing: SwapVenue = {
      id: "throwing",
      chainId: CHAIN_ID,
      quote: async () => {
        throw new Error("rpc flake");
      },
      buildSwapTxs: async () => [],
      decodeFillAmount: () => 0n,
    };
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: throwing,
      sleep: instantSleep,
    });
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "venue-quote-failed",
    });
  });

  it("throws venue-quote-below-min-buy-amount if price moved down", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const intent = await makeSwapIntent(signer);

    // Build a quote with the initial mid-price.
    const hot = makeVenue();
    const solverA = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: hot,
    });
    const quote = (await solverA.quote(intent))!;

    // Now a cold venue quotes half as much → floor drops below commitment.
    const cold = makeVenue({
      priceNumerator: 50000000000000n,
      priceDenominator: 1000000n,
    });
    const solverB = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: cold,
      sleep: instantSleep,
    });
    await expect(solverB.settle(intent, quote)).rejects.toMatchObject({
      code: "venue-quote-below-min-buy-amount",
    });
  });

  it("throws venue-build-failed if buildSwapTxs throws", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const venue = makeVenue({ forceBuildThrow: new Error("no route bytes") });
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue,
      sleep: instantSleep,
    });
    const intent = await makeSwapIntent(signer);
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "venue-build-failed",
    });
  });

  it("throws venue-build-failed on empty tx sequence", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const emptyVenue: SwapVenue = {
      id: "empty",
      chainId: CHAIN_ID,
      quote: async (p) => ({ expectedBuyAmount: p.sellAmount, venueData: { expectedBuyAmount: p.sellAmount } }),
      buildSwapTxs: async () => [],
      decodeFillAmount: () => 0n,
    };
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: emptyVenue,
      internalSlippageBps: 0,
      sleep: instantSleep,
    });
    const intent = await makeSwapIntent(signer, {
      sellAmount: "1000",
      minBuyAmount: "1000",
    });
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "venue-build-failed",
    });
  });

  it("wraps sendTransaction throws as chain-submit-failed", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider({ submitThrowsOnCall: 1 });
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: makeVenue(),
      sleep: instantSleep,
    });
    const intent = await makeSwapIntent(signer);
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "chain-submit-failed",
    });
  });

  it("throws chain-tx-reverted when last tx reverts", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider({ receipts: [revertedReceipt()] });
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: makeVenue(),
      sleep: instantSleep,
    });
    const intent = await makeSwapIntent(signer);
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "chain-tx-reverted",
    });
  });

  it("throws chain-confirmation-timeout when receipt never appears", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider({ receipts: [] });
    let ticks = 0;
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: makeVenue(),
      pollIntervalMs: 1,
      pollTimeoutMs: 10_000,
      sleep: instantSleep,
      now: () => {
        ticks += 1;
        return ticks * 10_000;
      },
    });
    const intent = await makeSwapIntent(signer, {
      deadlineMs: 1_000_000_000_000,
    });
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "chain-confirmation-timeout",
    });
  });

  it("wraps getTransactionReceipt throws as chain-submit-failed", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider({
      receiptsThrow: new Error("rpc flake"),
    });
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: makeVenue(),
      sleep: instantSleep,
    });
    const intent = await makeSwapIntent(signer);
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "chain-submit-failed",
    });
  });

  it("throws venue-decode-failed if decodeFillAmount throws", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const venue = makeVenue({ forceDecodeThrow: new Error("bad log topic") });
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue,
      sleep: instantSleep,
    });
    const intent = await makeSwapIntent(signer);
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "venue-decode-failed",
    });
  });

  it("throws fill-below-commitment if decoder returns less than commitment", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    // Scripted map returns a hash-matched amount = 1 (far below commitment).
    const venue = makeVenue({
      scriptedDecodes: new Map<`0x${string}`, bigint>([[TX_HASH, 1n]]),
    });
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue,
      sleep: instantSleep,
    });
    const intent = await makeSwapIntent(signer);
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "fill-below-commitment",
    });
  });
});

// ─── settle() happy path ───────────────────────────

describe("SwapSolver.settle happy path", () => {
  it("single-tx venue: returns Fill with actualAmount >= commitment", async () => {
    const signer = agentSigner();
    const holder = makeProvider();
    const solver = new SwapSolver({
      id: "swap:stub:base",
      name: "Stub",
      from: signer.address,
      provider: holder.provider,
      venue: makeVenue(),
      sleep: instantSleep,
    });
    const intent = await makeSwapIntent(signer);
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);

    expect(holder.calls).toHaveLength(1);
    expect(holder.calls[0].to).toBe(ROUTER);
    expect(fill.solverId).toBe("swap:stub:base");
    expect(fill.intentId).toBe(intent.envelope.id);
    expect(fill.quoteCommitment).toBe(quote.commitment);
    expect(BigInt(fill.actualAmount)).toBeGreaterThanOrEqual(
      BigInt(quote.commitment),
    );
    expect(fill.settlementRef).toBe(TX_HASH);
    expect(fill.metadata).toMatchObject({
      solverClass: "swap",
      venueId: "stub-v1",
      chainId: CHAIN_ID,
      txLabels: ["swap"],
    });
    expect((fill.metadata as { receipts: TxReceipt[] }).receipts).toHaveLength(1);
  });

  it("multi-tx venue (approve → swap): executes both, returns last-tx hash as settlementRef", async () => {
    const signer = agentSigner();
    const hash1 = ("0x" + "11".repeat(32)) as `0x${string}`;
    const hash2 = ("0x" + "22".repeat(32)) as `0x${string}`;
    const holder = makeProvider({
      txHashes: [hash1, hash2],
      receipts: [
        successReceipt({ transactionHash: hash1 }),
        successReceipt({ transactionHash: hash2 }),
      ],
    });

    const multiTxVenue: SwapVenue = {
      id: "multi",
      chainId: CHAIN_ID,
      quote: async (p) => ({
        expectedBuyAmount: p.sellAmount,
        venueData: { expectedBuyAmount: p.sellAmount },
      }),
      buildSwapTxs: async (params: SwapBuildParams): Promise<ReadonlyArray<SwapTxRequest>> => [
        { to: params.sellAsset, data: "0x095ea7b3" as `0x${string}`, label: "approve" },
        { to: ROUTER, data: "0x12345678" as `0x${string}`, label: "swap" },
      ],
      decodeFillAmount: ({ venueData }) =>
        (venueData as { expectedBuyAmount: bigint }).expectedBuyAmount,
    };

    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      venue: multiTxVenue,
      internalSlippageBps: 0,
      sleep: instantSleep,
    });
    const intent = await makeSwapIntent(signer, {
      sellAmount: "1000",
      minBuyAmount: "1000",
    });
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);

    expect(holder.calls).toHaveLength(2);
    expect(holder.calls[0].data).toBe("0x095ea7b3"); // approve
    expect(holder.calls[1].to).toBe(ROUTER); // swap
    expect(fill.settlementRef).toBe(hash2); // last hash
    expect(
      (fill.metadata as { txLabels: string[] }).txLabels,
    ).toEqual(["approve", "swap"]);
    expect(
      (fill.metadata as { receipts: TxReceipt[] }).receipts,
    ).toHaveLength(2);
  });

  it("aggregates gas across a multi-tx sequence (approve + swap)", async () => {
    const signer = agentSigner();
    const hash1 = ("0x" + "11".repeat(32)) as `0x${string}`;
    const hash2 = ("0x" + "22".repeat(32)) as `0x${string}`;
    const holder = makeProvider({
      txHashes: [hash1, hash2],
      receipts: [
        {
          transactionHash: hash1,
          blockNumber: 1n,
          status: "success",
          logs: [],
          gasUsed: 45_000n,              // approve
          effectiveGasPrice: 1_000_000_000n,
        },
        {
          transactionHash: hash2,
          blockNumber: 2n,
          status: "success",
          logs: [],
          gasUsed: 140_000n,             // swap
          effectiveGasPrice: 1_000_000_000n,
        },
      ],
    });

    const venue: SwapVenue = {
      id: "multi",
      chainId: CHAIN_ID,
      quote: async (p) => ({
        expectedBuyAmount: p.sellAmount,
        venueData: { expectedBuyAmount: p.sellAmount },
      }),
      buildSwapTxs: async (params: SwapBuildParams): Promise<ReadonlyArray<SwapTxRequest>> => [
        { to: params.sellAsset, data: "0x095ea7b3" as `0x${string}`, label: "approve" },
        { to: ROUTER, data: "0x12345678" as `0x${string}`, label: "swap" },
      ],
      decodeFillAmount: ({ venueData }) =>
        (venueData as { expectedBuyAmount: bigint }).expectedBuyAmount,
    };

    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      venue,
      internalSlippageBps: 0,
      sleep: instantSleep,
    });
    const intent = await makeSwapIntent(signer, {
      sellAmount: "1000",
      minBuyAmount: "1000",
    });
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);

    const meta = fill.metadata as {
      gasUsed?: bigint;
      gasCostWei?: bigint;
      perTxGasUsed?: ReadonlyArray<bigint | null>;
    };
    expect(meta.gasUsed).toBe(185_000n); // 45k + 140k
    expect(meta.gasCostWei).toBe(185_000_000_000_000n); // 185k * 1 gwei
    expect(meta.perTxGasUsed).toEqual([45_000n, 140_000n]);
  });

  it("omits aggregated gas when ANY receipt in the sequence lacks gasUsed (no partial sums)", async () => {
    const signer = agentSigner();
    const hash1 = ("0x" + "33".repeat(32)) as `0x${string}`;
    const hash2 = ("0x" + "44".repeat(32)) as `0x${string}`;
    const holder = makeProvider({
      txHashes: [hash1, hash2],
      receipts: [
        // approve has no gas data
        {
          transactionHash: hash1,
          blockNumber: 1n,
          status: "success",
          logs: [],
        },
        // swap has gas data
        {
          transactionHash: hash2,
          blockNumber: 2n,
          status: "success",
          logs: [],
          gasUsed: 140_000n,
          effectiveGasPrice: 1_000_000_000n,
        },
      ],
    });

    const venue: SwapVenue = {
      id: "multi-partial-gas",
      chainId: CHAIN_ID,
      quote: async (p) => ({
        expectedBuyAmount: p.sellAmount,
        venueData: { expectedBuyAmount: p.sellAmount },
      }),
      buildSwapTxs: async (params: SwapBuildParams): Promise<ReadonlyArray<SwapTxRequest>> => [
        { to: params.sellAsset, data: "0x095ea7b3" as `0x${string}`, label: "approve" },
        { to: ROUTER, data: "0x12345678" as `0x${string}`, label: "swap" },
      ],
      decodeFillAmount: ({ venueData }) =>
        (venueData as { expectedBuyAmount: bigint }).expectedBuyAmount,
    };

    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      venue,
      internalSlippageBps: 0,
      sleep: instantSleep,
    });
    const intent = await makeSwapIntent(signer, {
      sellAmount: "1000",
      minBuyAmount: "1000",
    });
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);

    const meta = fill.metadata as {
      gasUsed?: bigint;
      gasCostWei?: bigint;
      perTxGasUsed?: ReadonlyArray<bigint | null>;
    };
    // Aggregates omitted because a partial sum would mislead
    // downstream aggregators.
    expect(meta.gasUsed).toBeUndefined();
    expect(meta.gasCostWei).toBeUndefined();
    // Per-tx breakdown preserved — dashboards can still chart the
    // receipts that DO have gas data.
    expect(meta.perTxGasUsed).toEqual([null, 140_000n]);
  });

  it("native sellAsset: value is carried on the swap tx", async () => {
    const signer = agentSigner();
    const holder = makeProvider();
    // Mid-price = 1 native = 1000 USDC, so 0.001 native → 1 USDC.
    const venue = makeVenue({
      priceNumerator: 1000n,
      priceDenominator: 1n,
      // Only NATIVE→USDC allowed.
      routablePairs: [pairOf(NATIVE, USDC)],
    });
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: holder.provider,
      venue,
      sleep: instantSleep,
    });
    const intent = await makeSwapIntent(signer, {
      sellAsset: NATIVE,
      sellAmount: "1000000000000000", // 0.001 native
      buyAsset: USDC,
      minBuyAmount: "900000000", // under the floor
    });
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);

    expect(holder.calls).toHaveLength(1);
    expect(holder.calls[0].to).toBe(ROUTER);
    expect(holder.calls[0].value).toBe(1000000000000000n);
    expect(fill.actualAmount).toBe("1000000000000000000"); // 0.001 * 1000 = 1 USDC scaled by ratio
  });
});

// ─── dispose ───────────────────────────────────────

describe("SwapSolver.dispose", () => {
  it("blocks subsequent quote + settle with solver-disposed", async () => {
    const signer = agentSigner();
    const { provider } = makeProvider();
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider,
      venue: makeVenue(),
    });
    solver.dispose();
    const intent = await makeSwapIntent(signer);
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

  it("SwapSolverError is exported + instanceof works", () => {
    const e = new SwapSolverError("solver-disposed", "test");
    expect(e).toBeInstanceOf(SwapSolverError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("solver-disposed");
  });
});

// Keep unused `SwapQuoteParams`/`SwapQuoteResult` imports honest so
// the type re-exports remain tested-by-use. The `_` prefix tells
// downstream linters we're intentional.
const _pq: SwapQuoteParams = {
  chainId: CHAIN_ID,
  sellAsset: USDC,
  sellAmount: 1n,
  buyAsset: WETH,
};
const _qr: SwapQuoteResult = { expectedBuyAmount: 1n };
void _pq;
void _qr;

// ─── PR #118: exact-output direction ──────────────────────

describe("SwapSolver exact-output direction (PR #118)", () => {
  /**
   * Build a swap intent in exact-output direction. Operators set
   * `direction: "exact-output"` and provide `buyAmount` (exact output)
   * + `maxSellAmount` (input ceiling).
   */
  async function makeExactOutputIntent(
    signer: TypedDataSigner,
    overrides: {
      readonly sellAsset?: `0x${string}`;
      readonly buyAsset?: `0x${string}`;
      readonly buyAmount?: string;
      readonly maxSellAmount?: string;
      readonly recipient?: `0x${string}`;
      readonly chainId?: number;
      readonly deadlineMs?: number;
    } = {},
  ): Promise<Intent> {
    return createSignedIntent({
      body: {
        kind: "swap",
        direction: "exact-output",
        sellAsset: overrides.sellAsset ?? USDC,
        buyAsset: overrides.buyAsset ?? WETH,
        buyAmount: overrides.buyAmount ?? "100000000000000", // 0.0001 WETH exact
        maxSellAmount: overrides.maxSellAmount ?? "1500000", // 1.5 USDC max
        recipient: overrides.recipient ?? RECIPIENT,
      },
      creator: signer.address,
      chainId: overrides.chainId ?? CHAIN_ID,
      deadlineMs: overrides.deadlineMs ?? Date.now() + 60_000,
      signer,
    });
  }

  /**
   * Mock SwapVenue that supports exact-output. Records calls so
   * tests can assert wiring. Returns null from `quote` (exact-input)
   * to ensure exact-output intents don't accidentally fall through.
   */
  function makeExactOutputVenue(opts: {
    readonly expectedSellAmount?: bigint;
    readonly buildShouldThrow?: boolean;
  } = {}): {
    readonly venue: SwapVenue;
    readonly quoteCalls: number;
    readonly buildCalls: ReadonlyArray<unknown>;
  } {
    let quoteCalls = 0;
    const buildCalls: unknown[] = [];
    const expectedSellAmount = opts.expectedSellAmount ?? 1_200_000n;
    const venue: SwapVenue = {
      id: "stub-exact-output",
      chainId: CHAIN_ID,
      async quote() {
        return null;
      },
      async buildSwapTxs() {
        return [];
      },
      decodeFillAmount({ venueData }) {
        // For exact-output: the buyAmount we set in venueData is the
        // exact delivered amount.
        return (venueData as { buyAmount: bigint }).buyAmount;
      },
      async quoteExactOutput(params) {
        quoteCalls += 1;
        return {
          expectedSellAmount,
          venueData: { buyAmount: params.buyAmount },
        };
      },
      async buildExactOutputSwapTxs(params) {
        if (opts.buildShouldThrow) throw new Error("simulated build failure");
        buildCalls.push(params);
        return [
          { to: params.sellAsset, data: "0xa9059cbb00" as `0x${string}`, label: "approve" },
          { to: ROUTER, data: "0x00010203" as `0x${string}`, label: "swap" },
        ];
      },
    };
    return {
      venue,
      get quoteCalls() {
        return quoteCalls;
      },
      buildCalls,
    };
  }

  // ── quote() tests ──

  it("quote: exact-output intent returns commitment === exact buyAmount", async () => {
    const signer = agentSigner();
    const { venue } = makeExactOutputVenue({
      expectedSellAmount: 1_000_000n,
    });
    const solver = new SwapSolver({
      id: "swap:exact-output",
      name: "exact-output test",
      from: signer.address,
      provider: makeProvider({ receipts: [successReceipt()] }).provider,
      venue,
    });
    const intent = await makeExactOutputIntent(signer, {
      buyAmount: "100000000000000",
      maxSellAmount: "1500000",
    });
    const quote = await solver.quote(intent);
    expect(quote).not.toBeNull();
    // commitment === exact buyAmount (NOT a floor)
    expect(quote!.commitment).toBe("100000000000000");
    // metadata reflects the direction
    const meta = quote!.metadata as { direction?: string; buyAmount?: string };
    expect(meta.direction).toBe("exact-output");
    expect(meta.buyAmount).toBe("100000000000000");
  });

  it("quote: returns null when expectedSellAmount * (1 + slippage) exceeds maxSellAmount", async () => {
    const signer = agentSigner();
    // Quoted sell ceiling at 50bps slippage: 1_500_000 * 1.005 = 1_507_500.
    // The intent's maxSellAmount is 1_500_000 → ceiling exceeds → decline.
    const { venue } = makeExactOutputVenue({ expectedSellAmount: 1_500_000n });
    const solver = new SwapSolver({
      id: "swap:exact-output",
      name: "test",
      from: signer.address,
      provider: makeProvider({ receipts: [successReceipt()] }).provider,
      venue,
    });
    const intent = await makeExactOutputIntent(signer, {
      buyAmount: "100000000000000",
      maxSellAmount: "1500000",
    });
    const quote = await solver.quote(intent);
    expect(quote).toBeNull();
  });

  it("quote: returns null when venue doesn't support exact-output methods", async () => {
    const signer = agentSigner();
    // Inline minimal venue that declares ONLY the required SwapVenue
    // methods (quote / buildSwapTxs / decodeFillAmount). The stub
    // (post-PR-#120) now includes exact-output methods, so we
    // construct a hand-rolled venue here.
    const exactInputOnlyVenue: SwapVenue = {
      id: "exact-input-only",
      chainId: CHAIN_ID,
      async quote() {
        return { expectedBuyAmount: 1n };
      },
      async buildSwapTxs() {
        return [];
      },
      decodeFillAmount() {
        return 0n;
      },
      // Intentionally omits quoteExactOutput + buildExactOutputSwapTxs
    };
    const solver = new SwapSolver({
      id: "swap:exact-output",
      name: "test",
      from: signer.address,
      provider: makeProvider({ receipts: [successReceipt()] }).provider,
      venue: exactInputOnlyVenue,
    });
    const intent = await makeExactOutputIntent(signer);
    const quote = await solver.quote(intent);
    expect(quote).toBeNull();
  });

  it("quote: returns null when exact-output intent has missing buyAmount/maxSellAmount", async () => {
    const signer = agentSigner();
    const { venue } = makeExactOutputVenue({});
    const solver = new SwapSolver({
      id: "swap:exact-output",
      name: "test",
      from: signer.address,
      provider: makeProvider({ receipts: [successReceipt()] }).provider,
      venue,
    });
    // Forge intent missing buyAmount.
    const intent = await createSignedIntent({
      body: {
        kind: "swap",
        direction: "exact-output",
        sellAsset: USDC,
        buyAsset: WETH,
        recipient: RECIPIENT,
        // buyAmount + maxSellAmount intentionally absent
      } as unknown as Parameters<typeof createSignedIntent>[0]["body"],
      creator: signer.address,
      chainId: CHAIN_ID,
      deadlineMs: Date.now() + 60_000,
      signer,
    });
    const quote = await solver.quote(intent);
    expect(quote).toBeNull();
  });

  // ── settle() tests ──

  it("settle: exact-output intent succeeds; Fill.actualAmount === buyAmount", async () => {
    const signer = agentSigner();
    const holder = makeProvider({ receipts: [successReceipt(), successReceipt()] });
    const { venue } = makeExactOutputVenue({
      expectedSellAmount: 1_000_000n,
    });
    const solver = new SwapSolver({
      id: "swap:exact-output",
      name: "test",
      from: signer.address,
      provider: holder.provider,
      venue,
      sleep: instantSleep,
    });
    const intent = await makeExactOutputIntent(signer, {
      buyAmount: "100000000000000",
      maxSellAmount: "1500000",
    });
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);
    expect(fill.actualAmount).toBe("100000000000000"); // exact requested
    expect(fill.quoteCommitment).toBe("100000000000000");
    expect(holder.calls).toHaveLength(2); // [approve, swap]
  });

  it("settle: throws venue-no-liquidity when venue's exact-output quote returns null", async () => {
    const signer = agentSigner();
    let firstCall = true;
    const venue: SwapVenue = {
      id: "flaky",
      chainId: CHAIN_ID,
      async quote() {
        return null;
      },
      async buildSwapTxs() {
        return [];
      },
      decodeFillAmount() {
        return 0n;
      },
      async quoteExactOutput() {
        if (firstCall) {
          firstCall = false;
          return { expectedSellAmount: 1_000_000n, venueData: { buyAmount: 1n } };
        }
        return null; // second call (during settle) declines
      },
      async buildExactOutputSwapTxs() {
        return [];
      },
    };
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: makeProvider({ receipts: [successReceipt()] }).provider,
      venue,
      sleep: instantSleep,
    });
    const intent = await makeExactOutputIntent(signer);
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "venue-no-liquidity",
    });
  });

  it("settle: throws venue-quote-failed when venue lacks exact-output methods at settle time", async () => {
    // Pathological scenario: somehow we got a quote but the venue
    // now reports no exact-output support. In practice this would
    // be an upgrade race. The solver detects + throws cleanly.
    const signer = agentSigner();
    const venueWithoutExactOutput: SwapVenue = {
      id: "regressed",
      chainId: CHAIN_ID,
      async quote() {
        return null;
      },
      async buildSwapTxs() {
        return [];
      },
      decodeFillAmount() {
        return 0n;
      },
      // No quoteExactOutput / buildExactOutputSwapTxs
    };
    const solver = new SwapSolver({
      id: "t",
      name: "t",
      from: signer.address,
      provider: makeProvider({ receipts: [successReceipt()] }).provider,
      venue: venueWithoutExactOutput,
      sleep: instantSleep,
    });
    const intent = await makeExactOutputIntent(signer);
    // Forge a synthetic quote (since venue.quote returns null,
    // we can't get a real one) — the test pins the settle-time
    // safety check.
    const synthQuote = {
      solverId: "t",
      intentId: intent.envelope.id,
      commitment: "100000000000000",
      estimatedFillTimeMs: 0,
      quotedAt: 0,
      expiresAt: Date.now() + 10_000,
      solverSignature: "0x" as `0x${string}`,
    };
    await expect(solver.settle(intent, synthQuote)).rejects.toMatchObject({
      code: "venue-quote-failed",
    });
  });

  // ── back-compat: exact-input intents unchanged ──

  it("exact-input intent (default) works unchanged via existing path", async () => {
    const signer = agentSigner();
    const holder = makeProvider({ receipts: [successReceipt()] });
    const solver = new SwapSolver({
      id: "swap:exact-input",
      name: "test",
      from: signer.address,
      provider: holder.provider,
      venue: makeVenue({}),
      sleep: instantSleep,
    });
    const intent = await makeSwapIntent(signer); // default exact-input
    const quote = await solver.quote(intent);
    expect(quote).not.toBeNull();
    // commitment is a FLOOR (≤ venue's expectedBuyAmount minus slippage).
    // Stub's expectedBuyAmount = 100e12; with 50bps slippage = 99.5e12.
    expect(BigInt(quote!.commitment)).toBeLessThanOrEqual(99_500_000_000_000n);
    const meta = quote!.metadata as { direction?: string };
    // PR #118: metadata explicitly tags direction. Pre-PR-118 code
    // didn't set direction; we now set it on every quote.
    expect(meta.direction).toBe("exact-input");
  });
});
