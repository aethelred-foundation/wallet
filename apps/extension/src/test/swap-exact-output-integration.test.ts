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
