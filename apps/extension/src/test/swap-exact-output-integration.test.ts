/**
 * Integration test (PR #119): end-to-end exact-output through
 * `SwapSolver` + `UniswapV3SwapVenue`.
 *
 * Wires the real `UniswapV3SwapVenue` (PRs #113/#114) into a
 * real `SwapSolver` (PR #118) and exercises the
 * `direction: "exact-output"` path with a stubbed transport that
 * returns canonical `quoteExactOutputSingle` result bytes.
 *
 * Goal: verify that PR #118's interface wiring AND PR #113/#114's
 * venue methods compose correctly when invoked from the abstraction
 * layer — not just from the venue directly. The unit tests at each
 * layer pin the contracts; this integration pins the COMPOSITION.
 *
 * Settlement is NOT tested end-to-end here — that requires a
 * synthetic Swap event log decoded by the v3 venue's `extractBuyAmount`,
 * which is venue-specific and well-tested in
 * `swap-venue-uniswap-v3.test.ts`. Quote-time integration is the
 * value-add: it proves that an `exact-output` intent travels
 * through `SwapSolver.quote → venue.quoteExactOutput → result`
 * with the correct fields populated at each layer.
 */

import { describe, expect, it } from "vitest";

import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import {
  createSignedIntent,
  type Intent,
} from "@aethelred/wallet-intent-router";
import type { TypedDataSigner } from "@aethelred/wallet-x402";
import type { AnchorChainProvider, TxReceipt } from "@aethelred/wallet-notarization";
import { SwapSolver } from "@aethelred/wallet-swap-solver";
import {
  UniswapV3SwapVenue,
  type Eth_RpcTransport,
} from "@aethelred/wallet-swap-venue-uniswap-v3";

const PK_AGENT = "0x" + "01".repeat(32);
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`;
const WETH = "0x4200000000000000000000000000000000000006" as `0x${string}`;
const RECIPIENT = ("0x" + "bb".repeat(20)) as `0x${string}`;
const QUOTER = ("0x" + "11".repeat(20)) as `0x${string}`;
const ROUTER = ("0x" + "22".repeat(20)) as `0x${string}`;
const CHAIN_ID = 8453;
const TX_HASH = ("0x" + "ee".repeat(32)) as `0x${string}`;

function agentSigner(): TypedDataSigner {
  return new LocalKeyAdapter({ privateKey: PK_AGENT }).asTypedDataSigner();
}

/**
 * Stubbed transport that returns canonical `quoteExactOutputSingle`
 * result bytes for any 0xbd21704a-prefixed eth_call.
 */
function makeQuoterTransport(opts: {
  readonly amountIn: bigint;
}): Eth_RpcTransport {
  return {
    async call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T> {
      if (method !== "eth_call") return "0x" as unknown as T;
      const data = (params[0] as { data: string }).data.toLowerCase();
      // exactOutputSingle quoter (selector 0xbd21704a) → 4-slot result
      if (data.startsWith("0xbd21704a")) {
        return ("0x" +
          opts.amountIn.toString(16).padStart(64, "0") +
          (1n << 96n).toString(16).padStart(64, "0") +
          (2n).toString(16).padStart(64, "0") +
          (180_000n).toString(16).padStart(64, "0")) as unknown as T;
      }
      return "0x" as unknown as T;
    },
  };
}

/** Minimal AnchorChainProvider — settle isn't exercised in this integration. */
function makeProvider(): AnchorChainProvider {
  return {
    chainId: CHAIN_ID,
    async sendTransaction() {
      return TX_HASH;
    },
    async getTransactionReceipt(): Promise<TxReceipt | null> {
      return {
        transactionHash: TX_HASH,
        blockNumber: 12345n,
        status: "success",
        logs: [],
      };
    },
  };
}

describe("end-to-end exact-output through UniswapV3SwapVenue (PR #119)", () => {
  async function makeExactOutputIntent(
    signer: TypedDataSigner,
    overrides: { buyAmount?: string; maxSellAmount?: string } = {},
  ): Promise<Intent> {
    return createSignedIntent({
      body: {
        kind: "swap",
        direction: "exact-output",
        sellAsset: USDC,
        buyAsset: WETH,
        buyAmount: overrides.buyAmount ?? "1000000000000000000", // exact 1 WETH
        maxSellAmount: overrides.maxSellAmount ?? "5000000000", // 5000 USDC ceiling
        recipient: RECIPIENT,
      },
      creator: signer.address,
      chainId: CHAIN_ID,
      deadlineMs: Date.now() + 60_000,
      signer,
    });
  }

  it("solver.quote routes through venue.quoteExactOutput; commitment === buyAmount", async () => {
    const signer = agentSigner();
    const transport = makeQuoterTransport({ amountIn: 1_500_000_000n });
    const venue = new UniswapV3SwapVenue({
      chainId: CHAIN_ID,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      defaultFeeTier: 500,
    });
    const solver = new SwapSolver({
      id: "swap:uniswap-v3:integration",
      name: "test",
      from: signer.address,
      provider: makeProvider(),
      venue,
    });

    const intent = await makeExactOutputIntent(signer);
    const quote = await solver.quote(intent);

    expect(quote).not.toBeNull();
    // Commitment === exact requested buyAmount (NOT a floor).
    expect(quote!.commitment).toBe("1000000000000000000");

    // Metadata reflects the direction + venue's quoted sell amount.
    const meta = quote!.metadata as {
      direction?: string;
      buyAmount?: string;
      expectedSellAmount?: string;
      venueId?: string;
    };
    expect(meta.direction).toBe("exact-output");
    expect(meta.buyAmount).toBe("1000000000000000000");
    expect(meta.expectedSellAmount).toBe("1500000000");
    expect(meta.venueId).toBe("uniswap-v3");
  });

  it("solver.quote returns null when venue's quoted sell ceiling exceeds maxSellAmount", async () => {
    const signer = agentSigner();
    // Quoted amountIn = 5_000_000_000 (= maxSellAmount).
    // With 50bps slippage: ceiling = 5_000_000_000 * 1.005 = 5_025_000_000 > maxSellAmount.
    const transport = makeQuoterTransport({ amountIn: 5_000_000_000n });
    const venue = new UniswapV3SwapVenue({
      chainId: CHAIN_ID,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      defaultFeeTier: 500,
    });
    const solver = new SwapSolver({
      id: "swap:uniswap-v3:integration",
      name: "test",
      from: signer.address,
      provider: makeProvider(),
      venue,
    });

    const intent = await makeExactOutputIntent(signer, {
      buyAmount: "1000000000000000000",
      maxSellAmount: "5000000000",
    });
    const quote = await solver.quote(intent);
    expect(quote).toBeNull();
  });

  it("solver.quote on exact-input intent uses venue.quote (not quoteExactOutput) — back-compat", async () => {
    const signer = agentSigner();
    // Stubbed transport for SINGLE-HOP exactInput quoter (selector 0xc6a5026a).
    const transport: Eth_RpcTransport = {
      async call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T> {
        if (method !== "eth_call") return "0x" as unknown as T;
        const data = (params[0] as { data: string }).data.toLowerCase();
        if (data.startsWith("0xc6a5026a")) {
          // exactInputSingle result: amountOut, sqrtPrice, ticks, gas
          return ("0x" +
            (99_000_000_000_000n).toString(16).padStart(64, "0") +
            (1n << 96n).toString(16).padStart(64, "0") +
            (2n).toString(16).padStart(64, "0") +
            (120_000n).toString(16).padStart(64, "0")) as unknown as T;
        }
        return "0x" as unknown as T;
      },
    };
    const venue = new UniswapV3SwapVenue({
      chainId: CHAIN_ID,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      defaultFeeTier: 500,
    });
    const solver = new SwapSolver({
      id: "swap:uniswap-v3:integration",
      name: "test",
      from: signer.address,
      provider: makeProvider(),
      venue,
    });

    // Exact-input intent (no `direction` field — defaults).
    const intent = await createSignedIntent({
      body: {
        kind: "swap",
        sellAsset: USDC,
        sellAmount: "1000000",
        buyAsset: WETH,
        minBuyAmount: "98000000000000",
        recipient: RECIPIENT,
      },
      creator: signer.address,
      chainId: CHAIN_ID,
      deadlineMs: Date.now() + 60_000,
      signer,
    });

    const quote = await solver.quote(intent);
    expect(quote).not.toBeNull();
    const meta = quote!.metadata as { direction?: string };
    expect(meta.direction).toBe("exact-input");
    // Commitment is a FLOOR (less than venue's expectedBuyAmount).
    expect(BigInt(quote!.commitment)).toBeLessThanOrEqual(99_000_000_000_000n * 9950n / 10000n);
  });
});

// ─── Settle-side integration via StubSwapVenue (PR #121) ────

import { StubSwapVenue } from "@aethelred/wallet-swap-solver";

describe("end-to-end exact-output SETTLE through StubSwapVenue (PR #121)", () => {
  /**
   * StubSwapVenue (PR #120) provides a simple in-memory venue that
   * supports both directions. Pairing it with a real SwapSolver +
   * mock chain provider lets us test the full settle path end-to-end
   * (quote → build → submit → decode → Fill) for exact-output
   * intents WITHOUT needing the v3 venue's receipt-decoding
   * complexity.
   */
  function makeStubProvider(): {
    readonly provider: AnchorChainProvider;
    readonly calls: Array<{ to: `0x${string}`; data: `0x${string}`; value?: bigint }>;
  } {
    const calls: Array<{ to: `0x${string}`; data: `0x${string}`; value?: bigint }> = [];
    const provider: AnchorChainProvider = {
      chainId: CHAIN_ID,
      async sendTransaction(req) {
        calls.push(req);
        return TX_HASH;
      },
      async getTransactionReceipt() {
        return {
          transactionHash: TX_HASH,
          blockNumber: 12345n,
          status: "success",
          logs: [],
        };
      },
    };
    return { provider, calls };
  }

  async function makeExactOutputIntent(
    signer: TypedDataSigner,
    overrides: { buyAmount?: string; maxSellAmount?: string } = {},
  ): Promise<Intent> {
    return createSignedIntent({
      body: {
        kind: "swap",
        direction: "exact-output",
        sellAsset: USDC,
        buyAsset: WETH,
        buyAmount: overrides.buyAmount ?? "100000000000000",
        maxSellAmount: overrides.maxSellAmount ?? "1500000",
        recipient: RECIPIENT,
      },
      creator: signer.address,
      chainId: CHAIN_ID,
      deadlineMs: Date.now() + 60_000,
      signer,
    });
  }

  it("settle: exact-output intent succeeds end-to-end via StubSwapVenue", async () => {
    const signer = agentSigner();
    const { provider, calls } = makeStubProvider();
    const venue = new StubSwapVenue({
      id: "stub-eo",
      chainId: CHAIN_ID,
      router: ROUTER,
      // 1 USDC → 0.0001 WETH (mid)
      priceNumerator: 100_000_000_000_000n,
      priceDenominator: 1_000_000n,
    });
    const solver = new SwapSolver({
      id: "swap:stub:exact-output",
      name: "test",
      from: signer.address,
      provider,
      venue,
      sleep: async () => {},
    });

    const intent = await makeExactOutputIntent(signer, {
      buyAmount: "100000000000000", // exact 0.0001 WETH
      maxSellAmount: "1500000", // 1.5 USDC ceiling (well above quoted 1 USDC)
    });
    const quote = (await solver.quote(intent))!;

    // Quote has commitment === buyAmount.
    expect(quote.commitment).toBe("100000000000000");
    const quoteMeta = quote.metadata as {
      direction?: string;
      buyAmount?: string;
      expectedSellAmount?: string;
    };
    expect(quoteMeta.direction).toBe("exact-output");
    expect(quoteMeta.expectedSellAmount).toBe("1000000"); // exactly 1 USDC at the ratio

    const fill = await solver.settle(intent, quote);

    // Fill.actualAmount === buyAmount (exact-output guarantee).
    expect(fill.actualAmount).toBe("100000000000000");
    expect(fill.quoteCommitment).toBe("100000000000000");
    // Single tx submitted (StubSwapVenue.buildExactOutputSwapTxs emits
    // one — no separate approve in the stub).
    expect(calls).toHaveLength(1);
    // Calldata uses the stub exact-output selector (0x87654321).
    expect(calls[0].data.startsWith("0x87654321")).toBe(true);
  });

  it("settle: exact-output throws venue-quote-below-min-buy-amount when stub price moves UP between quote and settle", async () => {
    // Construct the venue WITHOUT routablePairs first, get a quote,
    // then swap the venue's internal config to make settle re-quote
    // at a higher price ratio. Easier: configure two venues — the
    // first for quote, the second (replaced via re-build) for settle.
    // Cleaner: use the same venue but introduce time-dependent
    // pricing via a wrapper.
    const signer = agentSigner();
    const { provider } = makeStubProvider();

    let quoteCount = 0;
    // Wrap the stub to bump the price ratio after the first quote,
    // simulating a price spike between quote and settle.
    const baseVenue = new StubSwapVenue({
      id: "stub-eo-volatile",
      chainId: CHAIN_ID,
      router: ROUTER,
      priceNumerator: 100_000_000_000_000n,
      priceDenominator: 1_000_000n,
    });
    const expensiveVenue = new StubSwapVenue({
      id: "stub-eo-volatile",
      chainId: CHAIN_ID,
      router: ROUTER,
      // Inflate sell-side cost: priceNumerator goes DOWN
      // (less buy per sell) → exact-output requires MORE sell.
      priceNumerator: 50_000_000_000_000n,
      priceDenominator: 1_000_000n,
    });

    const venue: SwapVenue = {
      id: baseVenue.id,
      chainId: baseVenue.chainId,
      async quote(p) {
        return baseVenue.quote(p);
      },
      async buildSwapTxs(p) {
        return baseVenue.buildSwapTxs(p);
      },
      decodeFillAmount(p) {
        return baseVenue.decodeFillAmount(p);
      },
      async quoteExactOutput(p) {
        quoteCount += 1;
        return quoteCount === 1
          ? baseVenue.quoteExactOutput(p)
          : expensiveVenue.quoteExactOutput(p);
      },
      async buildExactOutputSwapTxs(p) {
        return baseVenue.buildExactOutputSwapTxs(p);
      },
    };

    const solver = new SwapSolver({
      id: "swap:stub:eo:volatile",
      name: "test",
      from: signer.address,
      provider,
      venue,
      sleep: async () => {},
    });
    const intent = await makeExactOutputIntent(signer, {
      buyAmount: "100000000000000",
      maxSellAmount: "1500000", // tight ceiling
    });
    const quote = (await solver.quote(intent))!;
    expect(quote).not.toBeNull();

    // Settle re-quotes; this time the venue says we'd need 2 USDC
    // (priceNumerator halved) — exceeds maxSellAmount of 1.5 USDC.
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "venue-quote-below-min-buy-amount",
    });
  });
});
