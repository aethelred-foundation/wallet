/**
 * Tests for `@aethelred/wallet-swap-venue-uniswap-v3`.
 *
 * Three layers:
 *
 *   1. **Encoder** — every selector + every padding rule
 *      verified against the wire format Uniswap's contracts
 *      expect. Roundtrip decoding for QuoterV2's response.
 *
 *   2. **Decoder** — Swap event topic + log layout, including
 *      two's-complement handling for negative `amount0` /
 *      `amount1` deltas, and the buyAsset → token0/token1
 *      ordering inference.
 *
 *   3. **Venue** — end-to-end with a stubbed transport (no real
 *      RPC). quote() returns null on revert + non-zero amount;
 *      buildSwapTxs() emits [approve, swap]; decodeFillAmount()
 *      reads buyAmount from a synthesised receipt.
 */

import { describe, expect, it } from "vitest";

import type { TxReceipt } from "@aethelred/wallet-notarization";
import {
  decodeQuoteExactInputSingleResult,
  decodeSwapEvents,
  encodeErc20Approve,
  encodeExactInputSingle,
  encodeQuoteExactInputSingle,
  extractBuyAmount,
  NOOP_ALLOWANCE_CACHE_METRICS_RECORDER,
  pairKey,
  SELECTOR_ERC20_APPROVE,
  SELECTOR_EXACT_INPUT_SINGLE,
  SELECTOR_QUOTE_EXACT_INPUT_SINGLE,
  TOPIC_SWAP_V3,
  UniswapV3SwapVenue,
  UniswapV3VenueError,
  UNISWAP_V3_FEE_TIERS,
  type AllowanceCacheMetricsRecorder,
  type Eth_RpcTransport,
  type UniswapV3VenueData,
} from "@aethelred/wallet-swap-venue-uniswap-v3";

// ─── Fixtures ───────────────────────────────────────

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`;
const WETH = "0x4200000000000000000000000000000000000006" as `0x${string}`;
const DAI = "0x50c5725949a6f0c72e6c4a641f24049a917db0cb" as `0x${string}`;
const RECIPIENT = ("0x" + "bb".repeat(20)) as `0x${string}`;
const POOL = ("0x" + "cc".repeat(20)) as `0x${string}`;
const QUOTER = ("0x" + "11".repeat(20)) as `0x${string}`;
const ROUTER = ("0x" + "22".repeat(20)) as `0x${string}`;

// ─── Encoder ────────────────────────────────────────

describe("UniswapV3 encoder", () => {
  it("encodeQuoteExactInputSingle: produces selector + 5 packed slots = 164 bytes", () => {
    const data = encodeQuoteExactInputSingle({
      tokenIn: USDC,
      tokenOut: WETH,
      amountIn: 1_000_000n,
      fee: UNISWAP_V3_FEE_TIERS.LOW,
    });
    expect(data.startsWith(SELECTOR_QUOTE_EXACT_INPUT_SINGLE)).toBe(true);
    // 0x + 4-byte selector + 5 × 32-byte slots = 2 + 8 + 320 = 330 chars
    expect(data).toHaveLength(2 + 8 + 5 * 64);
    // tokenIn slot — last 40 chars are the address.
    const inSlot = data.slice(10, 10 + 64);
    expect(inSlot.slice(24)).toBe(USDC.slice(2));
  });

  it("encodeQuoteExactInputSingle: throws on bad address", () => {
    expect(() =>
      encodeQuoteExactInputSingle({
        tokenIn: "0xBAD" as `0x${string}`,
        tokenOut: WETH,
        amountIn: 1n,
        fee: UNISWAP_V3_FEE_TIERS.LOW,
      }),
    ).toThrow(UniswapV3VenueError);
  });

  it("decodeQuoteExactInputSingleResult: decodes 4 packed values", () => {
    // 4 × 32-byte slots; values: amountOut=99000000000000, sqrtPriceX96After=
    // 1<<96, initializedTicksCrossed=2, gasEstimate=120000.
    const amountOutHex = (99_000_000_000_000n).toString(16).padStart(64, "0");
    const sqrtHex = (1n << 96n).toString(16).padStart(64, "0");
    const ticksHex = (2n).toString(16).padStart(64, "0");
    const gasHex = (120_000n).toString(16).padStart(64, "0");
    const result = `0x${amountOutHex}${sqrtHex}${ticksHex}${gasHex}` as `0x${string}`;

    const decoded = decodeQuoteExactInputSingleResult(result);
    expect(decoded.amountOut).toBe(99_000_000_000_000n);
    expect(decoded.sqrtPriceX96After).toBe(1n << 96n);
    expect(decoded.initializedTicksCrossed).toBe(2);
    expect(decoded.gasEstimate).toBe(120_000n);
  });

  it("decodeQuoteExactInputSingleResult: rejects too-short input", () => {
    expect(() => decodeQuoteExactInputSingleResult("0xabcd")).toThrow(
      UniswapV3VenueError,
    );
  });

  it("encodeExactInputSingle: produces selector + 7 packed slots = 228 bytes", () => {
    const data = encodeExactInputSingle({
      tokenIn: USDC,
      tokenOut: WETH,
      fee: UNISWAP_V3_FEE_TIERS.MEDIUM,
      recipient: RECIPIENT,
      amountIn: 1_000_000n,
      amountOutMinimum: 100_000_000_000n,
    });
    expect(data.startsWith(SELECTOR_EXACT_INPUT_SINGLE)).toBe(true);
    expect(data).toHaveLength(2 + 8 + 7 * 64);
    // Verify recipient is in the 4th slot (index 3 in 0-based,
    // after selector).
    const recipientSlot = data.slice(10 + 3 * 64, 10 + 4 * 64);
    expect(recipientSlot.slice(24)).toBe(RECIPIENT.slice(2));
  });

  it("encodeErc20Approve: matches canonical 0x095ea7b3 + spender + amount", () => {
    const data = encodeErc20Approve(ROUTER, 1_000_000n);
    expect(data.startsWith(SELECTOR_ERC20_APPROVE)).toBe(true);
    expect(data).toHaveLength(2 + 8 + 2 * 64);
    expect(data.slice(10 + 24, 10 + 64)).toBe(ROUTER.slice(2));
  });
});

// ─── Decoder ────────────────────────────────────────

describe("UniswapV3 decoder", () => {
  /** Build a synthetic Swap-event log. */
  function makeSwapLog(opts: {
    pool?: `0x${string}`;
    sender?: `0x${string}`;
    recipient?: `0x${string}`;
    amount0: bigint;
    amount1: bigint;
    sqrtPriceX96?: bigint;
    liquidity?: bigint;
    tick?: number;
  }): TxReceipt["logs"][number] {
    const padToSlot = (addr: string) =>
      ("0x" + "00".repeat(12) + addr.slice(2).toLowerCase()) as `0x${string}`;
    const intToHex = (n: bigint) => {
      // Encode as two's complement 32-byte big-endian.
      const u = n < 0n ? n + (1n << 256n) : n;
      return u.toString(16).padStart(64, "0");
    };
    const data = ("0x" +
      intToHex(opts.amount0) +
      intToHex(opts.amount1) +
      (opts.sqrtPriceX96 ?? 0n).toString(16).padStart(64, "0") +
      (opts.liquidity ?? 0n).toString(16).padStart(64, "0") +
      intToHex(BigInt(opts.tick ?? 0))) as `0x${string}`;
    return {
      address: opts.pool ?? POOL,
      topics: [
        TOPIC_SWAP_V3,
        padToSlot(opts.sender ?? ROUTER),
        padToSlot(opts.recipient ?? RECIPIENT),
      ],
      data,
      blockNumber: 1n,
      transactionHash: ("0x" + "ee".repeat(32)) as `0x${string}`,
      logIndex: 0,
    };
  }

  it("decodeSwapEvents: extracts sender/recipient + signed amounts", () => {
    // Pool sends out 1 ETH (-1e18), receives 3500 USDC (+3.5e9).
    const log = makeSwapLog({
      amount0: -(10n ** 18n), // outflow
      amount1: 3_500_000_000n, // inflow
    });
    const decoded = decodeSwapEvents([log]);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].sender.toLowerCase()).toBe(ROUTER.toLowerCase());
    expect(decoded[0].recipient.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(decoded[0].amount0).toBe(-(10n ** 18n));
    expect(decoded[0].amount1).toBe(3_500_000_000n);
  });

  it("decodeSwapEvents: ignores logs with non-Swap topic", () => {
    const otherLog = {
      address: POOL,
      topics: [
        ("0x" + "11".repeat(32)) as `0x${string}`, // not Swap topic
        ("0x" + "22".repeat(32)) as `0x${string}`,
        ("0x" + "33".repeat(32)) as `0x${string}`,
      ],
      data: "0x" as `0x${string}`,
      blockNumber: 1n,
      transactionHash: ("0x" + "ee".repeat(32)) as `0x${string}`,
      logIndex: 0,
    };
    expect(decodeSwapEvents([otherLog])).toHaveLength(0);
  });

  it("extractBuyAmount: token0 case (buyAsset address < sellAsset)", () => {
    // buyAsset is token0 (lower address). amount0 negative = out.
    const sellAsset = ("0x" + "ff".repeat(20)) as `0x${string}`;
    const buyAsset = ("0x" + "11".repeat(20)) as `0x${string}`;
    const log = makeSwapLog({
      amount0: -250_000_000n, // out — recipient gets 250e6 of token0
      amount1: 1_000_000_000n, // in — sender pays 1e9 of token1
      recipient: RECIPIENT,
    });
    const got = extractBuyAmount({
      logs: [log],
      recipient: RECIPIENT,
      buyAsset,
      sellAsset,
    });
    expect(got).toBe(250_000_000n);
  });

  it("extractBuyAmount: token1 case (buyAsset address > sellAsset)", () => {
    const sellAsset = ("0x" + "11".repeat(20)) as `0x${string}`;
    const buyAsset = ("0x" + "ff".repeat(20)) as `0x${string}`;
    const log = makeSwapLog({
      amount0: 1_000_000n, // in — sender pays 1e6 of token0
      amount1: -3_500_000n, // out — recipient gets 3.5e6 of token1
      recipient: RECIPIENT,
    });
    const got = extractBuyAmount({
      logs: [log],
      recipient: RECIPIENT,
      buyAsset,
      sellAsset,
    });
    expect(got).toBe(3_500_000n);
  });

  it("extractBuyAmount: returns 0n when recipient doesn't match", () => {
    const log = makeSwapLog({
      amount0: -100n,
      amount1: 200n,
      recipient: ("0x" + "99".repeat(20)) as `0x${string}`,
    });
    const got = extractBuyAmount({
      logs: [log],
      recipient: RECIPIENT, // different address
      buyAsset: ("0x" + "11".repeat(20)) as `0x${string}`,
      sellAsset: ("0x" + "ff".repeat(20)) as `0x${string}`,
    });
    expect(got).toBe(0n);
  });
});

// ─── Venue ──────────────────────────────────────────

describe("UniswapV3SwapVenue", () => {
  function makeTransport(
    behavior: "happy" | "revert" | "zero-amount" | "garbage",
  ): Eth_RpcTransport {
    return {
      async call<T>(_method: string, _params: ReadonlyArray<unknown>): Promise<T> {
        if (behavior === "revert") {
          throw new Error("execution reverted: invalid pool");
        }
        if (behavior === "garbage") {
          return "0x" + "00".repeat(50) as unknown as T;
        }
        const amountOut = behavior === "zero-amount" ? 0n : 99_000_000_000_000n;
        const result = ("0x" +
          amountOut.toString(16).padStart(64, "0") +
          (1n << 96n).toString(16).padStart(64, "0") +
          (2n).toString(16).padStart(64, "0") +
          (120_000n).toString(16).padStart(64, "0")) as `0x${string}`;
        return result as unknown as T;
      },
    };
  }

  function makeVenue(transport: Eth_RpcTransport, chainId = 8453) {
    return new UniswapV3SwapVenue({
      chainId,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
    });
  }

  it("constructor: rejects bad addresses", () => {
    const t = makeTransport("happy");
    expect(
      () =>
        new UniswapV3SwapVenue({
          chainId: 1,
          quoterAddress: "0xBAD" as `0x${string}`,
          swapRouterAddress: ROUTER,
          transport: t,
        }),
    ).toThrow(UniswapV3VenueError);
  });

  it("quote: returns expectedBuyAmount + venueData on happy path", async () => {
    const venue = makeVenue(makeTransport("happy"));
    const r = await venue.quote({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: WETH,
    });
    expect(r).not.toBeNull();
    expect(r!.expectedBuyAmount).toBe(99_000_000_000_000n);
    expect(r!.venueData).toMatchObject({
      feeTier: UNISWAP_V3_FEE_TIERS.MEDIUM,
      expectedBuyAmount: 99_000_000_000_000n,
    });
  });

  it("quote: returns null on chainId mismatch", async () => {
    const venue = makeVenue(makeTransport("happy"));
    const r = await venue.quote({
      chainId: 1, // venue is on 8453
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: WETH,
    });
    expect(r).toBeNull();
  });

  it("quote: returns null when QuoterV2 reverts (no-liquidity)", async () => {
    const venue = makeVenue(makeTransport("revert"));
    const r = await venue.quote({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: WETH,
    });
    expect(r).toBeNull();
  });

  it("quote: returns null on zero amountOut", async () => {
    const venue = makeVenue(makeTransport("zero-amount"));
    const r = await venue.quote({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: WETH,
    });
    expect(r).toBeNull();
  });

  it("quote: returns null on same sellAsset and buyAsset", async () => {
    const venue = makeVenue(makeTransport("happy"));
    const r = await venue.quote({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: USDC,
    });
    expect(r).toBeNull();
  });

  it("buildSwapTxs: emits [approve, swap] in that order", async () => {
    const venue = makeVenue(makeTransport("happy"));
    const txs = await venue.buildSwapTxs({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: WETH,
      recipient: RECIPIENT,
      amountOutMinimum: 99_000_000_000_000n,
      venueData: {
        feeTier: UNISWAP_V3_FEE_TIERS.MEDIUM,
        expectedBuyAmount: 99_000_000_000_000n,
        sqrtPriceX96After: 0n,
      },
      deadlineMs: Date.now() + 60_000,
    });
    expect(txs).toHaveLength(2);
    expect(txs[0].label).toBe("approve");
    expect(txs[0].to).toBe(USDC);
    expect(txs[0].data.startsWith(SELECTOR_ERC20_APPROVE)).toBe(true);

    expect(txs[1].label).toBe("swap");
    expect(txs[1].to).toBe(ROUTER);
    expect(txs[1].data.startsWith(SELECTOR_EXACT_INPUT_SINGLE)).toBe(true);
  });

  it("decodeFillAmount: extracts buyAmount from receipt logs", () => {
    const venue = makeVenue(makeTransport("happy"));
    // USDC sells, WETH buys → WETH (lower? higher?). USDC =
    // 0x833... , WETH = 0x420... — WETH is lower lexicographically,
    // so WETH is token0 and amount0 is negative.
    const padToSlot = (addr: string) =>
      ("0x" + "00".repeat(12) + addr.slice(2).toLowerCase()) as `0x${string}`;
    const intToHex = (n: bigint) => {
      const u = n < 0n ? n + (1n << 256n) : n;
      return u.toString(16).padStart(64, "0");
    };
    const data =
      "0x" +
      intToHex(-99_000_000_000_000n) + // amount0 — out (WETH leaves pool)
      intToHex(1_000_000n) + // amount1 — in (USDC enters)
      "00".repeat(96); // sqrtPriceX96 + liquidity + tick

    const receipt: TxReceipt = {
      transactionHash: ("0x" + "ee".repeat(32)) as `0x${string}`,
      blockNumber: 1n,
      status: "success",
      logs: [
        {
          address: POOL,
          topics: [TOPIC_SWAP_V3, padToSlot(ROUTER), padToSlot(RECIPIENT)],
          data: data as `0x${string}`,
          blockNumber: 1n,
          transactionHash: ("0x" + "ee".repeat(32)) as `0x${string}`,
          logIndex: 0,
        },
      ],
    };
    const got = venue.decodeFillAmount({
      receipt,
      recipient: RECIPIENT,
      buyAsset: WETH,
      venueData: {
        feeTier: UNISWAP_V3_FEE_TIERS.MEDIUM,
        expectedBuyAmount: 99_000_000_000_000n,
        sqrtPriceX96After: 0n,
        sellAsset: USDC,
      },
    });
    expect(got).toBe(99_000_000_000_000n);
  });

  it("feeTiers: per-pair override beats default", async () => {
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport: makeTransport("happy"),
      defaultFeeTier: UNISWAP_V3_FEE_TIERS.MEDIUM,
      feeTiers: new Map([
        [pairKey(USDC, WETH), UNISWAP_V3_FEE_TIERS.LOW],
      ]),
    });
    const r = await venue.quote({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: WETH,
    });
    expect(
      (r!.venueData as { feeTier: number }).feeTier,
    ).toBe(UNISWAP_V3_FEE_TIERS.LOW);
  });

  // ─── Allowance pre-flight ────────────────────────

  /**
   * Build a transport that branches on the call's `data` selector:
   *
   *   - QuoterV2 selector → canned amountOut (happy quote)
   *   - allowance selector (0xdd62ed3e) → caller-controlled amount
   *
   * Lets pre-flight tests assert the venue routed the right
   * eth_call without conflating with quote behavior.
   */
  function makeAllowanceAwareTransport(opts: {
    readonly existingAllowance: bigint;
    readonly throwOnAllowance?: Error;
  }): Eth_RpcTransport {
    return {
      async call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T> {
        if (method !== "eth_call") return "0x" as unknown as T;
        const callObj = params[0] as { data: string };
        const data = callObj.data.toLowerCase();
        if (data.startsWith("0xdd62ed3e")) {
          // allowance(owner, spender) — caller-controlled value.
          if (opts.throwOnAllowance) throw opts.throwOnAllowance;
          const padded = opts.existingAllowance.toString(16).padStart(64, "0");
          return ("0x" + padded) as unknown as T;
        }
        // Default to a happy QuoterV2 result for everything else.
        const amountOut = 99_000_000_000_000n;
        const result = ("0x" +
          amountOut.toString(16).padStart(64, "0") +
          (1n << 96n).toString(16).padStart(64, "0") +
          (2n).toString(16).padStart(64, "0") +
          (120_000n).toString(16).padStart(64, "0")) as `0x${string}`;
        return result as unknown as T;
      },
    };
  }

  const AGENT_OWNER = ("0x" + "ee".repeat(20)) as `0x${string}`;

  it("buildSwapTxs: returns [swap] only when existing allowance ≥ amountIn", async () => {
    const transport = makeAllowanceAwareTransport({
      existingAllowance: 5_000_000n, // > amountIn = 1_000_000
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
    });
    const txs = await venue.buildSwapTxs({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: WETH,
      recipient: RECIPIENT,
      amountOutMinimum: 1n,
      venueData: {
        feeTier: UNISWAP_V3_FEE_TIERS.MEDIUM,
        expectedBuyAmount: 99_000_000_000_000n,
        sqrtPriceX96After: 0n,
      },
      deadlineMs: Date.now() + 60_000,
    });
    // Single tx — approve was elided.
    expect(txs).toHaveLength(1);
    expect(txs[0].label).toBe("swap");
  });

  it("buildSwapTxs: emits [approve, swap] when existing allowance < amountIn", async () => {
    const transport = makeAllowanceAwareTransport({
      existingAllowance: 100n, // < amountIn
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
    });
    const txs = await venue.buildSwapTxs({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: WETH,
      recipient: RECIPIENT,
      amountOutMinimum: 1n,
      venueData: {
        feeTier: UNISWAP_V3_FEE_TIERS.MEDIUM,
        expectedBuyAmount: 99_000_000_000_000n,
        sqrtPriceX96After: 0n,
      },
      deadlineMs: Date.now() + 60_000,
    });
    expect(txs).toHaveLength(2);
    expect(txs[0].label).toBe("approve");
    expect(txs[1].label).toBe("swap");
  });

  it("buildSwapTxs: pre-flight disabled by default — always emits [approve, swap]", async () => {
    // Even though the existing allowance is huge, the default
    // (skipApproveWhenSufficient: false) preserves PR #94's
    // unconditional behavior.
    const transport = makeAllowanceAwareTransport({
      existingAllowance: 1n << 200n,
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      // skipApproveWhenSufficient omitted (defaults to false).
    });
    const txs = await venue.buildSwapTxs({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: WETH,
      recipient: RECIPIENT,
      amountOutMinimum: 1n,
      venueData: {
        feeTier: UNISWAP_V3_FEE_TIERS.MEDIUM,
        expectedBuyAmount: 99_000_000_000_000n,
        sqrtPriceX96After: 0n,
      },
      deadlineMs: Date.now() + 60_000,
    });
    expect(txs).toHaveLength(2);
    expect(txs[0].label).toBe("approve");
  });

  it("buildSwapTxs: pre-flight without agentAddress fails-closed (still emits approve)", async () => {
    const transport = makeAllowanceAwareTransport({
      existingAllowance: 1n << 200n,
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      // agentAddress NOT set — flag is on but config is incomplete.
      skipApproveWhenSufficient: true,
    });
    const txs = await venue.buildSwapTxs({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: WETH,
      recipient: RECIPIENT,
      amountOutMinimum: 1n,
      venueData: {
        feeTier: UNISWAP_V3_FEE_TIERS.MEDIUM,
        expectedBuyAmount: 99_000_000_000_000n,
        sqrtPriceX96After: 0n,
      },
      deadlineMs: Date.now() + 60_000,
    });
    // Fail-closed: emit approve. Operators see wasted tx, not
    // a broken swap.
    expect(txs).toHaveLength(2);
  });

  it("buildSwapTxs: allowance call throwing fails-closed (emits approve)", async () => {
    const transport = makeAllowanceAwareTransport({
      existingAllowance: 0n, // unused — throws first
      throwOnAllowance: new Error("rpc unavailable"),
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
    });
    const txs = await venue.buildSwapTxs({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: WETH,
      recipient: RECIPIENT,
      amountOutMinimum: 1n,
      venueData: {
        feeTier: UNISWAP_V3_FEE_TIERS.MEDIUM,
        expectedBuyAmount: 99_000_000_000_000n,
        sqrtPriceX96After: 0n,
      },
      deadlineMs: Date.now() + 60_000,
    });
    // Network error is fail-closed: emit approve.
    expect(txs).toHaveLength(2);
  });

  it("buildSwapTxs: allowance equal to amountIn skips approve (≥ comparison)", async () => {
    const transport = makeAllowanceAwareTransport({
      existingAllowance: 1_000_000n, // exactly equal
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
    });
    const txs = await venue.buildSwapTxs({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: WETH,
      recipient: RECIPIENT,
      amountOutMinimum: 1n,
      venueData: {
        feeTier: UNISWAP_V3_FEE_TIERS.MEDIUM,
        expectedBuyAmount: 99_000_000_000_000n,
        sqrtPriceX96After: 0n,
      },
      deadlineMs: Date.now() + 60_000,
    });
    expect(txs).toHaveLength(1);
    expect(txs[0].label).toBe("swap");
  });

  // ─── Allowance cache (PR #98) ─────────────────────

  /**
   * Allowance-aware transport that ALSO counts the number of
   * `allowance()` eth_calls — lets the cache tests assert
   * "second swap skipped the RPC."
   */
  function makeCountingAllowanceTransport(opts: {
    readonly existingAllowance: bigint;
  }): {
    readonly transport: Eth_RpcTransport;
    readonly stats: { allowanceCalls: number; quoteCalls: number };
  } {
    const stats = { allowanceCalls: 0, quoteCalls: 0 };
    const transport: Eth_RpcTransport = {
      async call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T> {
        if (method !== "eth_call") return "0x" as unknown as T;
        const callObj = params[0] as { data: string };
        const data = callObj.data.toLowerCase();
        if (data.startsWith("0xdd62ed3e")) {
          stats.allowanceCalls += 1;
          const padded = opts.existingAllowance
            .toString(16)
            .padStart(64, "0");
          return ("0x" + padded) as unknown as T;
        }
        stats.quoteCalls += 1;
        const amountOut = 99_000_000_000_000n;
        const result = ("0x" +
          amountOut.toString(16).padStart(64, "0") +
          (1n << 96n).toString(16).padStart(64, "0") +
          (2n).toString(16).padStart(64, "0") +
          (120_000n).toString(16).padStart(64, "0")) as `0x${string}`;
        return result as unknown as T;
      },
    };
    return { transport, stats };
  }

  function makeBuildParams(amountIn: bigint) {
    return {
      chainId: 8453 as const,
      sellAsset: USDC,
      sellAmount: amountIn,
      buyAsset: WETH,
      recipient: RECIPIENT,
      amountOutMinimum: 1n,
      venueData: {
        feeTier: UNISWAP_V3_FEE_TIERS.MEDIUM as number,
        expectedBuyAmount: 99_000_000_000_000n,
        sqrtPriceX96After: 0n,
      },
      deadlineMs: Date.now() + 60_000,
    };
  }

  it("cache: second buildSwapTxs hits cache, skips eth_call (MAX_UINT256 case)", async () => {
    const { transport, stats } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n, // unlimited
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
    });

    const a = await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(a).toHaveLength(1);
    expect(stats.allowanceCalls).toBe(1);

    const b = await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(b).toHaveLength(1);
    // Cache hit — second call did NOT add an allowance() RPC.
    expect(stats.allowanceCalls).toBe(1);
  });

  it("cache: decrements upper bound after each use (finite allowance)", async () => {
    // Existing allowance is 5_000_000 — well above the 200-bit
    // threshold's `1 << 200n` ≈ 1.6e60, so this counts as a
    // FINITE allowance for decrement purposes. Each 1M swap
    // consumes 1M from the cache.
    const { transport, stats } = makeCountingAllowanceTransport({
      existingAllowance: 5_000_000n,
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
    });

    // Five 1M swaps — first triggers RPC, the rest hit cache
    // and decrement to 4M, 3M, 2M, 1M.
    for (let i = 0; i < 5; i++) {
      const txs = await venue.buildSwapTxs(makeBuildParams(1_000_000n));
      expect(txs).toHaveLength(1);
    }
    expect(stats.allowanceCalls).toBe(1);

    // Sixth swap: cache decremented to 0 by the prior five
    // uses; next pre-flight finds 0 < 1M → emits approve.
    // (Note: the "0" is in the cache; we do NOT re-fetch
    // from the chain — the cache says "0" so we fall back
    // to emitting approve. This is safe; the chain MIGHT
    // actually have allowance, but emitting an unnecessary
    // approve is the conservative direction.)
    const sixth = await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(sixth).toHaveLength(2);
    expect(sixth[0].label).toBe("approve");
  });

  it("cache: TTL expiry forces a fresh eth_call", async () => {
    const { transport, stats } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n,
    });
    let clock = 1_000_000;
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 5_000,
      now: () => clock,
    });

    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(stats.allowanceCalls).toBe(1);

    // 4 seconds later — within TTL, cache hit.
    clock += 4_000;
    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(stats.allowanceCalls).toBe(1);

    // 6 more seconds later (10s elapsed total, TTL = 5s) — stale.
    clock += 6_000;
    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(stats.allowanceCalls).toBe(2);
  });

  it("cache: invalidateAllowanceCache() forces a re-fetch", async () => {
    const { transport, stats } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n,
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
    });

    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(stats.allowanceCalls).toBe(1);

    venue.invalidateAllowanceCache();
    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(stats.allowanceCalls).toBe(2);
  });

  it("cache: TTL=0 (default) means no caching — every swap pre-flights", async () => {
    const { transport, stats } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n,
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      // allowanceCacheTtlMs NOT set → no caching.
    });

    for (let i = 0; i < 3; i++) {
      await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    }
    expect(stats.allowanceCalls).toBe(3);
  });

  // ─── Pluggable cache (PR #99) ─────────────────────

  it("cache: pluggable AllowanceCache replaces the default in-memory impl", async () => {
    const { InMemoryAllowanceCache } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const customCache = new InMemoryAllowanceCache();
    const { transport, stats } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n,
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
      allowanceCache: customCache,
    });

    expect(customCache.size()).toBe(0);
    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(stats.allowanceCalls).toBe(1);
    // The custom cache instance now holds the entry.
    expect(customCache.size()).toBe(1);

    // Second swap hits the same cache instance.
    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(stats.allowanceCalls).toBe(1);
  });

  it("cache: get() throwing is treated as cache miss (fail-closed)", async () => {
    const { transport, stats } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n,
    });
    // Custom cache where get() throws every call.
    const failingCache = {
      async get(): Promise<null> {
        throw new Error("redis disconnected");
      },
      async set(): Promise<void> {
        // succeeds — we want to confirm the venue still tries
        // to write through after a get-miss.
      },
      async clear(): Promise<void> {},
    };

    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
      allowanceCache: failingCache,
    });

    // Both swaps should fall through to fresh eth_call —
    // get() throws each time, so neither hits the cache.
    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(stats.allowanceCalls).toBe(2);
  });

  it("cache: set() throwing is silently swallowed (swap still succeeds)", async () => {
    const { transport } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n,
    });
    let setAttempts = 0;
    const flakyCache = {
      async get(): Promise<null> {
        return null; // always miss
      },
      async set(): Promise<void> {
        setAttempts += 1;
        throw new Error("redis WRITE-only failure");
      },
      async clear(): Promise<void> {},
    };

    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
      allowanceCache: flakyCache,
    });

    // Despite set() throwing, buildSwapTxs returns successfully.
    const txs = await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(txs).toHaveLength(1); // single-tx swap (allowance ≥ amountIn)
    // set() was attempted twice — once after the eth_call result,
    // once after the decrement.
    expect(setAttempts).toBeGreaterThanOrEqual(1);
  });

  it("cache: clear() throwing is silently swallowed by invalidateAllowanceCache", async () => {
    const flakyCache = {
      async get(): Promise<null> {
        return null;
      },
      async set(): Promise<void> {},
      async clear(): Promise<void> {
        throw new Error("redis is on fire");
      },
    };

    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport: makeAllowanceAwareTransport({
        existingAllowance: (1n << 256n) - 1n,
      }),
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
      allowanceCache: flakyCache,
    });

    // Should NOT throw — operator-facing API is graceful.
    await expect(venue.invalidateAllowanceCache()).resolves.toBeUndefined();
  });

  it("cache: not used when skipApproveWhenSufficient is false", async () => {
    const { transport, stats } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n,
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      // skipApproveWhenSufficient OFF — caching has nothing to do.
      allowanceCacheTtlMs: 60_000,
    });

    const txs = await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(txs).toHaveLength(2); // unconditional [approve, swap]
    expect(stats.allowanceCalls).toBe(0); // no allowance call ever
  });

  // ─── PR #102: cache metrics recorder ──────────────────

  function makeRecordingMetrics(): {
    readonly recorder: AllowanceCacheMetricsRecorder;
    readonly counts: { hits: number; misses: number; stales: number };
  } {
    const counts = { hits: 0, misses: 0, stales: 0 };
    const recorder: AllowanceCacheMetricsRecorder = {
      recordHit() {
        counts.hits += 1;
      },
      recordMiss() {
        counts.misses += 1;
      },
      recordStale() {
        counts.stales += 1;
      },
    };
    return { recorder, counts };
  }

  it("metrics: first lookup records 1 miss; second lookup records 1 hit", async () => {
    const { transport } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n,
    });
    const { recorder, counts } = makeRecordingMetrics();
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
      allowanceCacheMetrics: recorder,
    });

    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(counts).toEqual({ hits: 0, misses: 1, stales: 0 });

    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(counts).toEqual({ hits: 1, misses: 1, stales: 0 });
  });

  it("metrics: stale entry recorded as 'stale', not 'miss'", async () => {
    let nowMs = 1_700_000_000_000;
    const { transport } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n,
    });
    const { recorder, counts } = makeRecordingMetrics();
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
      allowanceCacheMetrics: recorder,
      now: () => nowMs,
    });

    // Swap 1 — populates the cache with `recordedAt = 1_700_000_000_000`.
    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(counts).toEqual({ hits: 0, misses: 1, stales: 0 });

    // Advance the clock past the TTL — entry exists but is stale.
    nowMs += 60_001;

    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    // The stale lookup is counted as 'stale', NOT 'miss'. The
    // subsequent fresh fetch overwrites the cache with a new
    // recordedAt; the lookup itself recorded once for this swap.
    expect(counts).toEqual({ hits: 0, misses: 1, stales: 1 });
  });

  it("metrics: backend `get()` throwing is counted as miss (fail-closed)", async () => {
    const { transport } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n,
    });
    const { recorder, counts } = makeRecordingMetrics();

    // Backend that always throws on get() — venue treats as miss.
    const flakyCache = {
      async get(): Promise<null> {
        throw new Error("simulated cache backend failure");
      },
      async set(): Promise<void> {},
      async clear(): Promise<void> {},
    };

    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
      allowanceCache: flakyCache,
      allowanceCacheMetrics: recorder,
    });

    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    // Two lookups, both treated as miss (no hits, no stales).
    // The throw is counted as miss because elevating it to a
    // separate "error" event would require a 4th method;
    // operators wanting that distinction wrap their backend impl.
    expect(counts).toEqual({ hits: 0, misses: 2, stales: 0 });
  });

  it("metrics: NO events when caching is disabled (allowanceCacheTtlMs unset)", async () => {
    const { transport } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n,
    });
    const { recorder, counts } = makeRecordingMetrics();
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      // allowanceCacheTtlMs OMITTED — caching disabled.
      allowanceCacheMetrics: recorder,
    });

    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(counts).toEqual({ hits: 0, misses: 0, stales: 0 });
  });

  it("metrics: recorder undefined → defaults to no-op (zero behavior change)", async () => {
    // Sanity test: omitting allowanceCacheMetrics doesn't break
    // the venue. The default no-op is wired internally.
    const { transport, stats } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n,
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
      // allowanceCacheMetrics OMITTED — should default to noop
    });

    const a = await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    const b = await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(stats.allowanceCalls).toBe(1); // cache still works
  });

  it("metrics: 5-swap sequence records 1 miss + 4 hits (steady state)", async () => {
    // Operational acceptance test — what an ops team observes
    // with a healthy cache + steady agent traffic.
    const { transport } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n,
    });
    const { recorder, counts } = makeRecordingMetrics();
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
      allowanceCacheMetrics: recorder,
    });

    for (let i = 0; i < 5; i++) {
      await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    }

    expect(counts).toEqual({ hits: 4, misses: 1, stales: 0 });
    // Hit rate (operational SLI): 4/5 = 80%
    const total = counts.hits + counts.misses + counts.stales;
    expect(counts.hits / total).toBe(0.8);
  });

  it("metrics: NOOP_ALLOWANCE_CACHE_METRICS_RECORDER is a callable no-op", () => {
    // Belt-and-braces: confirm the exported no-op default is
    // safe to call directly. Useful for operators who want to
    // explicitly disable metrics on a per-venue basis.
    expect(() => {
      NOOP_ALLOWANCE_CACHE_METRICS_RECORDER.recordHit();
      NOOP_ALLOWANCE_CACHE_METRICS_RECORDER.recordMiss();
      NOOP_ALLOWANCE_CACHE_METRICS_RECORDER.recordStale();
    }).not.toThrow();
  });
});

// ─── allowance encoder + decoder ───────────────────────

describe("encodeErc20Allowance / decodeErc20AllowanceResult", () => {
  it("encodes allowance(owner, spender) to selector + 2 padded slots = 68 bytes", async () => {
    const { encodeErc20Allowance, SELECTOR_ERC20_ALLOWANCE } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const data = encodeErc20Allowance(RECIPIENT, ROUTER);
    expect(data.startsWith(SELECTOR_ERC20_ALLOWANCE)).toBe(true);
    // 0x + 4-byte selector + 2 × 32-byte slots = 2 + 8 + 128 = 138 chars.
    expect(data).toHaveLength(2 + 8 + 2 * 64);
    expect(data.slice(10 + 24, 10 + 64)).toBe(RECIPIENT.slice(2));
    expect(data.slice(10 + 64 + 24, 10 + 128)).toBe(ROUTER.slice(2));
  });

  it("decodes a 32-byte uint256 from the eth_call result", async () => {
    const { decodeErc20AllowanceResult } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const value = 12_345_678_901_234_567_890n;
    const hex = ("0x" + value.toString(16).padStart(64, "0")) as `0x${string}`;
    expect(decodeErc20AllowanceResult(hex)).toBe(value);
  });

  it("returns 0n for empty / short results (vacuous eth_call)", async () => {
    const { decodeErc20AllowanceResult } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    expect(decodeErc20AllowanceResult("0x")).toBe(0n);
    expect(decodeErc20AllowanceResult("0xabcd" as `0x${string}`)).toBe(0n);
  });
});

// ─── PR #104: InMemoryAllowanceCache LRU cap ──────────────

describe("InMemoryAllowanceCache: LRU cap (PR #104)", () => {
  it("default (no maxEntries) preserves pre-PR-#104 unbounded behavior", async () => {
    const { InMemoryAllowanceCache } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const cache = new InMemoryAllowanceCache();
    for (let i = 0; i < 1_000; i++) {
      await cache.set(`k${i}`, { allowance: BigInt(i), recordedAt: 0 });
    }
    expect(cache.size()).toBe(1_000); // unbounded growth
  });

  it("with maxEntries=N, size never exceeds N (FIFO eviction by insertion order)", async () => {
    const { InMemoryAllowanceCache } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const cache = new InMemoryAllowanceCache({ maxEntries: 3 });

    await cache.set("a", { allowance: 1n, recordedAt: 0 });
    await cache.set("b", { allowance: 2n, recordedAt: 0 });
    await cache.set("c", { allowance: 3n, recordedAt: 0 });
    expect(cache.size()).toBe(3);

    // Insertion 4 evicts 'a' (oldest by insertion order, no reads yet).
    await cache.set("d", { allowance: 4n, recordedAt: 0 });
    expect(cache.size()).toBe(3);
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).toEqual({ allowance: 2n, recordedAt: 0 });
    expect(await cache.get("c")).toEqual({ allowance: 3n, recordedAt: 0 });
    expect(await cache.get("d")).toEqual({ allowance: 4n, recordedAt: 0 });
  });

  it("get() refreshes recency (LRU semantics — accessing an entry protects it from eviction)", async () => {
    const { InMemoryAllowanceCache } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const cache = new InMemoryAllowanceCache({ maxEntries: 3 });

    await cache.set("a", { allowance: 1n, recordedAt: 0 });
    await cache.set("b", { allowance: 2n, recordedAt: 0 });
    await cache.set("c", { allowance: 3n, recordedAt: 0 });

    // Access 'a' — moves it to MRU position. Now order is [b, c, a].
    expect(await cache.get("a")).toEqual({ allowance: 1n, recordedAt: 0 });

    // Insertion 4 should evict 'b' (now LRU), NOT 'a'.
    await cache.set("d", { allowance: 4n, recordedAt: 0 });
    expect(await cache.get("a")).not.toBeNull(); // 'a' was protected
    expect(await cache.get("b")).toBeNull(); // 'b' was evicted
    expect(await cache.get("c")).not.toBeNull();
    expect(await cache.get("d")).not.toBeNull();
  });

  it("set() on existing key moves it to MRU (treats fresh write as most recent)", async () => {
    const { InMemoryAllowanceCache } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const cache = new InMemoryAllowanceCache({ maxEntries: 3 });

    await cache.set("a", { allowance: 1n, recordedAt: 0 });
    await cache.set("b", { allowance: 2n, recordedAt: 0 });
    await cache.set("c", { allowance: 3n, recordedAt: 0 });

    // Re-set 'a' with a fresh value — moves to MRU. Order: [b, c, a].
    await cache.set("a", { allowance: 999n, recordedAt: 100 });

    // Insertion 4 should evict 'b' (LRU), not 'a' (which is now MRU).
    await cache.set("d", { allowance: 4n, recordedAt: 0 });
    expect(await cache.get("a")).toEqual({ allowance: 999n, recordedAt: 100 });
    expect(await cache.get("b")).toBeNull();
  });

  it("set() on existing key does NOT grow size", async () => {
    const { InMemoryAllowanceCache } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const cache = new InMemoryAllowanceCache({ maxEntries: 3 });

    await cache.set("a", { allowance: 1n, recordedAt: 0 });
    await cache.set("a", { allowance: 2n, recordedAt: 0 });
    await cache.set("a", { allowance: 3n, recordedAt: 0 });
    expect(cache.size()).toBe(1);
  });

  it("hot key surviving cold churn — production access pattern simulation", async () => {
    // Simulates the v3 venue's hot-key access pattern: one
    // (agent, router, USDC) entry hit on every swap, with
    // occasional cold-key swaps for other tokens.
    const { InMemoryAllowanceCache } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const cache = new InMemoryAllowanceCache({ maxEntries: 3 });
    const hot = "hot:USDC";
    await cache.set(hot, { allowance: 1n, recordedAt: 0 });

    // 10 cold swaps (each touches a unique cold key), interspersed
    // with hot-key reads. The hot key should NEVER be evicted.
    for (let i = 0; i < 10; i++) {
      await cache.set(`cold${i}`, { allowance: BigInt(i), recordedAt: 0 });
      // Read the hot key — refreshes recency and protects it.
      expect(await cache.get(hot)).not.toBeNull();
    }

    // Hot key still present despite 10 cold churn cycles on a 3-entry cache.
    expect(await cache.get(hot)).toEqual({ allowance: 1n, recordedAt: 0 });
  });

  it("clear() empties the cache regardless of maxEntries", async () => {
    const { InMemoryAllowanceCache } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const cache = new InMemoryAllowanceCache({ maxEntries: 3 });
    await cache.set("a", { allowance: 1n, recordedAt: 0 });
    await cache.set("b", { allowance: 2n, recordedAt: 0 });

    await cache.clear();
    expect(cache.size()).toBe(0);
    expect(await cache.get("a")).toBeNull();

    // Cache is reusable post-clear; eviction policy still active.
    await cache.set("x", { allowance: 1n, recordedAt: 0 });
    await cache.set("y", { allowance: 2n, recordedAt: 0 });
    await cache.set("z", { allowance: 3n, recordedAt: 0 });
    await cache.set("w", { allowance: 4n, recordedAt: 0 });
    expect(cache.size()).toBe(3);
    expect(await cache.get("x")).toBeNull(); // 'x' evicted
  });

  it("constructor rejects maxEntries <= 0", async () => {
    const { InMemoryAllowanceCache } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    expect(() => new InMemoryAllowanceCache({ maxEntries: 0 })).toThrow(
      /positive integer/i,
    );
    expect(() => new InMemoryAllowanceCache({ maxEntries: -1 })).toThrow(
      /positive integer/i,
    );
  });

  it("constructor rejects non-integer maxEntries", async () => {
    const { InMemoryAllowanceCache } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    expect(() => new InMemoryAllowanceCache({ maxEntries: 1.5 })).toThrow(
      /positive integer/i,
    );
    expect(() => new InMemoryAllowanceCache({ maxEntries: NaN })).toThrow(
      /positive integer/i,
    );
    expect(
      () => new InMemoryAllowanceCache({ maxEntries: Infinity }),
    ).toThrow(/positive integer/i);
  });

  it("get() on absent key in bounded cache returns null without LRU bookkeeping", async () => {
    // Sanity test: missing keys don't cause spurious Map mutations
    // (which could affect eviction order if mishandled).
    const { InMemoryAllowanceCache } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const cache = new InMemoryAllowanceCache({ maxEntries: 3 });
    await cache.set("a", { allowance: 1n, recordedAt: 0 });
    await cache.set("b", { allowance: 2n, recordedAt: 0 });
    await cache.set("c", { allowance: 3n, recordedAt: 0 });

    // Missing key — should not perturb eviction state.
    expect(await cache.get("nonexistent")).toBeNull();

    // Eviction still works correctly: 'a' goes (it was inserted first
    // and never read).
    await cache.set("d", { allowance: 4n, recordedAt: 0 });
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).not.toBeNull();
  });

  it("integrated with UniswapV3SwapVenue: bounded cache evicts cold keys but keeps hot key warm", async () => {
    // End-to-end smoke: wire a bounded InMemoryAllowanceCache into
    // a real venue and verify hit-on-second-swap of the hot key
    // even after enough cold-key churn to fill the cap.
    const { InMemoryAllowanceCache } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );

    const stats = { allowanceCalls: 0 };
    const transport: Eth_RpcTransport = {
      async call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T> {
        if (method !== "eth_call") return "0x" as unknown as T;
        const data = (params[0] as { data: string }).data.toLowerCase();
        if (data.startsWith("0xdd62ed3e")) {
          stats.allowanceCalls += 1;
          const padded = ((1n << 256n) - 1n)
            .toString(16)
            .padStart(64, "0");
          return ("0x" + padded) as unknown as T;
        }
        // QuoterV2 stub — we don't exercise it here.
        return "0x" as unknown as T;
      },
    };

    const cache = new InMemoryAllowanceCache({ maxEntries: 2 });
    const AGENT = ("0x" + "ee".repeat(20)) as `0x${string}`;
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: ("0x" + "11".repeat(20)) as `0x${string}`,
      swapRouterAddress: ("0x" + "22".repeat(20)) as `0x${string}`,
      transport,
      agentAddress: AGENT,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
      allowanceCache: cache,
    });

    function buildParams(asset: `0x${string}`) {
      return {
        chainId: 8453 as const,
        sellAsset: asset,
        sellAmount: 1_000_000n,
        buyAsset: WETH,
        recipient: ("0x" + "bb".repeat(20)) as `0x${string}`,
        amountOutMinimum: 1n,
        venueData: {
          feeTier: UNISWAP_V3_FEE_TIERS.MEDIUM as number,
          expectedBuyAmount: 99_000_000_000_000n,
          sqrtPriceX96After: 0n,
        },
        deadlineMs: Date.now() + 60_000,
      };
    }

    const COLD1 = ("0x" + "01".repeat(20)) as `0x${string}`;
    const COLD2 = ("0x" + "02".repeat(20)) as `0x${string}`;

    // Swap 1: USDC (hot) — RPC call, cache populated. Cache size: 1.
    await venue.buildSwapTxs(buildParams(USDC));
    expect(stats.allowanceCalls).toBe(1);

    // Swap 2: USDC again — cache hit. Cache: 1 entry.
    await venue.buildSwapTxs(buildParams(USDC));
    expect(stats.allowanceCalls).toBe(1);

    // Swap 3: COLD1 — RPC call, cache populated. Cache: 2 entries.
    await venue.buildSwapTxs(buildParams(COLD1));
    expect(stats.allowanceCalls).toBe(2);

    // Swap 4: USDC — cache hit (refreshes recency).
    await venue.buildSwapTxs(buildParams(USDC));
    expect(stats.allowanceCalls).toBe(2);

    // Swap 5: COLD2 — RPC call, evicts COLD1 (LRU), keeps USDC.
    // Cache: 2 entries [USDC, COLD2].
    await venue.buildSwapTxs(buildParams(COLD2));
    expect(stats.allowanceCalls).toBe(3);

    // Swap 6: USDC — should still hit (hot key survived cold churn).
    await venue.buildSwapTxs(buildParams(USDC));
    expect(stats.allowanceCalls).toBe(3);

    // Swap 7: COLD1 — evicted earlier, RPC call again.
    await venue.buildSwapTxs(buildParams(COLD1));
    expect(stats.allowanceCalls).toBe(4);
  });
});

// ─── PR #106: Multi-hop routing ──────────────────────────

describe("encodePath (PR #106)", () => {
  it("encodes 2-hop path: token + fee + token (43 bytes total)", async () => {
    const { encodePath, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const hex = encodePath({
      tokens: [USDC, WETH],
      fees: [UNISWAP_V3_FEE_TIERS.LOW], // 500
    });
    // 0x + 20-byte addr + 3-byte fee + 20-byte addr = 0x + (20+3+20)*2 hex = 0x + 86 chars
    expect(hex).toHaveLength(2 + 86);
    expect(hex.startsWith("0x")).toBe(true);
    expect(hex.toLowerCase()).toContain(USDC.slice(2).toLowerCase());
    expect(hex.toLowerCase()).toContain(WETH.slice(2).toLowerCase());
    // Fee 500 = 0x0001f4 — should appear between USDC and WETH.
    expect(hex.toLowerCase()).toContain("0001f4");
  });

  it("encodes 3-hop path with two distinct fees", async () => {
    const { encodePath, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const hex = encodePath({
      tokens: [USDC, WETH, DAI],
      fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM], // 500, 3000
    });
    // 3 tokens (60 bytes) + 2 fees (6 bytes) = 66 bytes = 132 hex chars + "0x"
    expect(hex).toHaveLength(2 + 132);
    expect(hex.toLowerCase()).toContain("0001f4"); // 500
    expect(hex.toLowerCase()).toContain("000bb8"); // 3000
  });

  it("rejects path with < 2 tokens", async () => {
    const { encodePath } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    expect(() => encodePath({ tokens: [USDC], fees: [] })).toThrow(
      /at least 2 tokens/i,
    );
  });

  it("rejects path with mismatched tokens/fees lengths", async () => {
    const { encodePath, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    expect(() =>
      encodePath({
        tokens: [USDC, WETH, DAI],
        fees: [UNISWAP_V3_FEE_TIERS.LOW],
      }),
    ).toThrow(/3 tokens but 1 fees/i);
  });

  it("rejects malformed token address", async () => {
    const { encodePath, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    expect(() =>
      encodePath({
        tokens: [USDC, "0xnothex" as `0x${string}`],
        fees: [UNISWAP_V3_FEE_TIERS.LOW],
      }),
    ).toThrow(/not a 20-byte hex address/i);
  });

  it("rejects out-of-range fee", async () => {
    const { encodePath } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    expect(() =>
      encodePath({
        tokens: [USDC, WETH],
        fees: [0xff_ff_ff + 1], // exceeds uint24
      }),
    ).toThrow(/uint24/i);
  });

  it("lowercases mixed-case addresses in encoded output", async () => {
    const { encodePath, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const mixedCase = "0xAbCdEf0123456789012345678901234567890123" as `0x${string}`;
    const hex = encodePath({
      tokens: [mixedCase, USDC],
      fees: [UNISWAP_V3_FEE_TIERS.LOW],
    });
    expect(hex).toContain("abcdef0123456789012345678901234567890123");
  });
});

describe("reversePath (PR #109)", () => {
  it("reverses both tokens AND fees", async () => {
    const { reversePath, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const reversed = reversePath({
      tokens: [USDC, WETH, DAI],
      fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM],
    });
    expect(reversed.tokens).toEqual([DAI, WETH, USDC]);
    expect(reversed.fees).toEqual([
      UNISWAP_V3_FEE_TIERS.MEDIUM,
      UNISWAP_V3_FEE_TIERS.LOW,
    ]);
  });

  it("does not mutate the input", async () => {
    const { reversePath, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const original = {
      tokens: [USDC, WETH, DAI] as readonly `0x${string}`[],
      fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM] as readonly number[],
    };
    const before = { tokens: [...original.tokens], fees: [...original.fees] };
    reversePath(original);
    expect(original.tokens).toEqual(before.tokens);
    expect(original.fees).toEqual(before.fees);
  });

  it("handles 2-hop path (single fee, two tokens)", async () => {
    const { reversePath, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const reversed = reversePath({
      tokens: [USDC, WETH],
      fees: [UNISWAP_V3_FEE_TIERS.LOW],
    });
    expect(reversed.tokens).toEqual([WETH, USDC]);
    expect(reversed.fees).toEqual([UNISWAP_V3_FEE_TIERS.LOW]);
  });

  it("double-reverse returns equivalent path", async () => {
    const { reversePath, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const original = {
      tokens: [USDC, WETH, DAI] as readonly `0x${string}`[],
      fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM] as readonly number[],
    };
    const twice = reversePath(reversePath(original));
    expect(twice.tokens).toEqual(original.tokens);
    expect(twice.fees).toEqual(original.fees);
  });
});

describe("encodeQuoteExactInput (PR #106)", () => {
  it("encodes selector + offset + amountIn + length + padded path", async () => {
    const {
      encodeQuoteExactInput,
      encodePath,
      SELECTOR_QUOTE_EXACT_INPUT,
      UNISWAP_V3_FEE_TIERS,
    } = await import("@aethelred/wallet-swap-venue-uniswap-v3");

    const path = encodePath({
      tokens: [USDC, WETH],
      fees: [UNISWAP_V3_FEE_TIERS.LOW],
    });
    const calldata = encodeQuoteExactInput({ path, amountIn: 1_000n });

    expect(calldata.startsWith(SELECTOR_QUOTE_EXACT_INPUT)).toBe(true);
    // After selector: 32-byte offset (0x40 = 64), 32-byte amountIn, 32-byte length, padded path
    // 4 + 3*32 = 100 bytes minimum + padded path
    const stripped = calldata.slice(2 + SELECTOR_QUOTE_EXACT_INPUT.length - 2);
    // offset slot starts at byte 0 of stripped
    const offsetHex = stripped.slice(0, 64);
    expect(BigInt("0x" + offsetHex)).toBe(64n); // 0x40
    const amountInHex = stripped.slice(64, 128);
    expect(BigInt("0x" + amountInHex)).toBe(1_000n);
    const pathLengthHex = stripped.slice(128, 192);
    // Path is 43 bytes for 2-hop
    expect(BigInt("0x" + pathLengthHex)).toBe(43n);
  });
});

describe("decodeQuoteExactInputResult (PR #106)", () => {
  it("extracts amountOut + gasEstimate from a 4-slot head", async () => {
    const { decodeQuoteExactInputResult } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    // Head: amountOut, offset_to_arr1, offset_to_arr2, gasEstimate
    const amountOut = 99_000_000_000_000n;
    const offset1 = 128n;
    const offset2 = 192n;
    const gasEstimate = 200_000n;
    const hex = ("0x" +
      amountOut.toString(16).padStart(64, "0") +
      offset1.toString(16).padStart(64, "0") +
      offset2.toString(16).padStart(64, "0") +
      gasEstimate.toString(16).padStart(64, "0") +
      // Two empty arrays (length 0 each)
      "0".repeat(64) +
      "0".repeat(64)) as `0x${string}`;
    const decoded = decodeQuoteExactInputResult(hex);
    expect(decoded.amountOut).toBe(amountOut);
    expect(decoded.gasEstimate).toBe(gasEstimate);
  });

  it("rejects too-short result", async () => {
    const { decodeQuoteExactInputResult } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    expect(() => decodeQuoteExactInputResult("0xdeadbeef")).toThrow(
      /≥ 128 bytes/i,
    );
  });
});

describe("encodeExactInput (PR #106)", () => {
  it("emits selector + outer offset + inner head + path", async () => {
    const {
      encodeExactInput,
      encodePath,
      SELECTOR_EXACT_INPUT,
      UNISWAP_V3_FEE_TIERS,
    } = await import("@aethelred/wallet-swap-venue-uniswap-v3");

    const path = encodePath({
      tokens: [USDC, WETH, DAI],
      fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM],
    });
    const calldata = encodeExactInput({
      path,
      recipient: RECIPIENT,
      amountIn: 1_000_000n,
      amountOutMinimum: 99_000n,
    });

    expect(calldata.startsWith(SELECTOR_EXACT_INPUT)).toBe(true);
    const stripped = calldata.slice(SELECTOR_EXACT_INPUT.length);

    // Slot 0: outer offset = 0x20
    expect(BigInt("0x" + stripped.slice(0, 64))).toBe(32n);
    // Slot 1: inner offset_to_path = 0x80
    expect(BigInt("0x" + stripped.slice(64, 128))).toBe(128n);
    // Slot 2: recipient (right-aligned)
    expect(stripped.slice(128, 192).toLowerCase()).toContain(
      RECIPIENT.slice(2).toLowerCase(),
    );
    // Slot 3: amountIn
    expect(BigInt("0x" + stripped.slice(192, 256))).toBe(1_000_000n);
    // Slot 4: amountOutMinimum
    expect(BigInt("0x" + stripped.slice(256, 320))).toBe(99_000n);
    // Slot 5: path length = 66 bytes for 3-hop
    expect(BigInt("0x" + stripped.slice(320, 384))).toBe(66n);
    // Path bytes follow at offset 384 hex chars
    const pathFromCalldata = "0x" + stripped.slice(384, 384 + 66 * 2);
    expect(pathFromCalldata).toBe(path.toLowerCase());
  });
});

// ─── Multi-hop venue integration ─────────────────────────

describe("UniswapV3SwapVenue multi-hop (PR #106)", () => {
  /** Multi-hop transport: returns a 6-slot result encoding amountOut + arrays. */
  function makeMultiHopTransport(opts: {
    readonly amountOut: bigint;
    readonly onQuote?: (data: string) => void;
  }): Eth_RpcTransport {
    return {
      async call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T> {
        if (method !== "eth_call") return "0x" as unknown as T;
        const callObj = params[0] as { data: string };
        const data = callObj.data.toLowerCase();
        opts.onQuote?.(data);

        // Multi-hop quote (selector 0xcdca1753)
        if (data.startsWith("0xcdca1753")) {
          const result = ("0x" +
            opts.amountOut.toString(16).padStart(64, "0") + // amountOut
            (128n).toString(16).padStart(64, "0") + // offset arr1
            (192n).toString(16).padStart(64, "0") + // offset arr2
            (200_000n).toString(16).padStart(64, "0") + // gasEstimate
            "0".repeat(64) + // arr1 length 0
            "0".repeat(64)) as `0x${string}`; // arr2 length 0
          return result as unknown as T;
        }
        // Single-hop quote (selector 0xc6a5026a) — fall through
        if (data.startsWith("0xc6a5026a")) {
          const result = ("0x" +
            opts.amountOut.toString(16).padStart(64, "0") +
            (1n << 96n).toString(16).padStart(64, "0") +
            (2n).toString(16).padStart(64, "0") +
            (120_000n).toString(16).padStart(64, "0")) as `0x${string}`;
          return result as unknown as T;
        }
        return "0x" as unknown as T;
      },
    };
  }

  it("quote: returns venueData.path when multiHopPaths configured for the pair", async () => {
    const { pairKey, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    let observedSelector = "";
    const transport = makeMultiHopTransport({
      amountOut: 99_000_000_000_000n,
      onQuote: (data) => {
        observedSelector = data.slice(0, 10);
      },
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      multiHopPaths: new Map([
        [
          pairKey(USDC, DAI),
          {
            tokens: [USDC, WETH, DAI],
            fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM],
          },
        ],
      ]),
    });

    const r = await venue.quote({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: DAI,
    });

    expect(r).not.toBeNull();
    expect(r!.expectedBuyAmount).toBe(99_000_000_000_000n);
    expect((r!.venueData as UniswapV3VenueData).path).toBeDefined();
    expect((r!.venueData as UniswapV3VenueData).path!.tokens).toEqual([
      USDC,
      WETH,
      DAI,
    ]);
    // Multi-hop selector was used.
    expect(observedSelector).toBe("0xcdca1753");
  });

  it("quote: falls through to single-hop when pair has no multi-hop config", async () => {
    let observedSelector = "";
    const transport = makeMultiHopTransport({
      amountOut: 99_000_000_000_000n,
      onQuote: (data) => {
        observedSelector = data.slice(0, 10);
      },
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      // No multiHopPaths
    });

    const r = await venue.quote({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: WETH,
    });

    expect(r).not.toBeNull();
    expect((r!.venueData as UniswapV3VenueData).path).toBeUndefined();
    // Single-hop selector was used.
    expect(observedSelector).toBe("0xc6a5026a");
  });

  it("quote: reverse-direction lookup auto-reverses the path (PR #109)", async () => {
    // Operator registered the path under DAI→USDC, but the swap
    // is USDC→DAI. Pre-PR-#109 this rejected with
    // invalid-asset-address; PR #109 auto-reverses the path so
    // both directions work from a single registration.
    const { pairKey, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const transport = makeMultiHopTransport({ amountOut: 99_000_000_000_000n });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      multiHopPaths: new Map([
        [
          pairKey(DAI, USDC),
          {
            tokens: [DAI, WETH, USDC],
            fees: [UNISWAP_V3_FEE_TIERS.MEDIUM, UNISWAP_V3_FEE_TIERS.LOW],
          },
        ],
      ]),
    });

    const r = await venue.quote({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000n,
      buyAsset: DAI,
    });
    expect(r).not.toBeNull();
    // The auto-reversed path's tokens match the USDC→DAI direction.
    const path = (r!.venueData as UniswapV3VenueData).path!;
    expect(path.tokens).toEqual([USDC, WETH, DAI]); // reversed from registration
    expect(path.fees).toEqual([
      UNISWAP_V3_FEE_TIERS.LOW, // also reversed
      UNISWAP_V3_FEE_TIERS.MEDIUM,
    ]);
  });

  it("quote: forward direct match wins over auto-reverse (PR #109 precedence)", async () => {
    // Operator registers BOTH directions with different
    // intermediate tokens (asymmetric routing — e.g., USDC→DAI
    // best via WETH, DAI→USDC best via USDT). Forward direct
    // match should win — auto-reverse should NOT be triggered
    // when an explicit forward path exists.
    const { pairKey, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const USDT = ("0x" + "55".repeat(20)) as `0x${string}`;
    const transport = makeMultiHopTransport({ amountOut: 99_000_000_000_000n });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      multiHopPaths: new Map([
        // Forward: USDC→DAI via WETH
        [
          pairKey(USDC, DAI),
          {
            tokens: [USDC, WETH, DAI],
            fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM],
          },
        ],
        // Reverse: DAI→USDC via USDT (different intermediate)
        [
          pairKey(DAI, USDC),
          {
            tokens: [DAI, USDT, USDC],
            fees: [UNISWAP_V3_FEE_TIERS.ULTRA_LOW, UNISWAP_V3_FEE_TIERS.ULTRA_LOW],
          },
        ],
      ]),
    });

    // USDC→DAI: forward direct match → use [USDC, WETH, DAI]
    const r1 = await venue.quote({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000n,
      buyAsset: DAI,
    });
    expect((r1!.venueData as UniswapV3VenueData).path!.tokens).toEqual([
      USDC,
      WETH,
      DAI,
    ]);

    // DAI→USDC: forward direct match (different intermediate!)
    // → use [DAI, USDT, USDC], NOT auto-reversed [DAI, WETH, USDC]
    const r2 = await venue.quote({
      chainId: 8453,
      sellAsset: DAI,
      sellAmount: 1_000n,
      buyAsset: USDC,
    });
    expect((r2!.venueData as UniswapV3VenueData).path!.tokens).toEqual([
      DAI,
      USDT,
      USDC,
    ]);
  });

  it("buildSwapTxs: auto-reversed path produces correct calldata for reverse swap", async () => {
    // End-to-end: quote auto-reverses, build emits the correctly-
    // ordered path bytes, validateMultiHopPath passes.
    const {
      pairKey,
      UNISWAP_V3_FEE_TIERS,
      SELECTOR_EXACT_INPUT,
    } = await import("@aethelred/wallet-swap-venue-uniswap-v3");

    const transport = makeMultiHopTransport({ amountOut: 99_000_000_000_000n });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      multiHopPaths: new Map([
        [
          pairKey(DAI, USDC),
          {
            tokens: [DAI, WETH, USDC],
            fees: [UNISWAP_V3_FEE_TIERS.MEDIUM, UNISWAP_V3_FEE_TIERS.LOW],
          },
        ],
      ]),
    });

    // Reverse-direction swap.
    const quote = await venue.quote({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: DAI,
    });
    expect(quote).not.toBeNull();

    const txs = await venue.buildSwapTxs({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: DAI,
      recipient: RECIPIENT,
      amountOutMinimum: 99_000n,
      venueData: quote!.venueData,
      deadlineMs: Date.now() + 60_000,
    });

    // Build succeeds (no validation throw); calldata is multi-hop.
    expect(txs).toHaveLength(2); // [approve, swap]
    expect(txs[1].data.startsWith(SELECTOR_EXACT_INPUT)).toBe(true);
  });

  it("buildSwapTxs: emits multi-hop calldata with exactInput selector when venueData.path is set", async () => {
    const { pairKey, UNISWAP_V3_FEE_TIERS, SELECTOR_EXACT_INPUT } =
      await import("@aethelred/wallet-swap-venue-uniswap-v3");

    const transport = makeMultiHopTransport({
      amountOut: 99_000_000_000_000n,
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      multiHopPaths: new Map([
        [
          pairKey(USDC, DAI),
          {
            tokens: [USDC, WETH, DAI],
            fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM],
          },
        ],
      ]),
    });

    const quote = await venue.quote({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: DAI,
    });
    expect(quote).not.toBeNull();

    const txs = await venue.buildSwapTxs({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: DAI,
      recipient: RECIPIENT,
      amountOutMinimum: 99_000n,
      venueData: quote!.venueData,
      deadlineMs: Date.now() + 60_000,
    });

    expect(txs).toHaveLength(2); // [approve, swap]
    expect(txs[1].label).toBe("swap");
    expect(txs[1].to).toBe(ROUTER);
    expect(txs[1].data.startsWith(SELECTOR_EXACT_INPUT)).toBe(true);
    // Path contains all three tokens
    expect(txs[1].data.toLowerCase()).toContain(USDC.slice(2).toLowerCase());
    expect(txs[1].data.toLowerCase()).toContain(WETH.slice(2).toLowerCase());
    expect(txs[1].data.toLowerCase()).toContain(DAI.slice(2).toLowerCase());
  });

  it("buildSwapTxs: validates path matches sell/buy assets at build time", async () => {
    const { UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const transport = makeMultiHopTransport({ amountOut: 1n });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
    });

    // Manually-forged venueData with mismatched path — should reject at build time.
    await expect(
      venue.buildSwapTxs({
        chainId: 8453,
        sellAsset: USDC,
        sellAmount: 1_000n,
        buyAsset: DAI,
        recipient: RECIPIENT,
        amountOutMinimum: 1n,
        venueData: {
          feeTier: UNISWAP_V3_FEE_TIERS.LOW,
          expectedBuyAmount: 1n,
          sqrtPriceX96After: 0n,
          path: {
            // Wrong sellAsset — path starts with DAI but params says USDC
            tokens: [DAI, WETH, USDC],
            fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM],
          },
        },
        deadlineMs: Date.now() + 60_000,
      }),
    ).rejects.toMatchObject({
      code: "invalid-asset-address",
    });
  });

  it("multi-hop quote returns null on revert (no liquidity along path)", async () => {
    const { pairKey, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const revertingTransport: Eth_RpcTransport = {
      async call() {
        throw new Error("execution reverted: no liquidity");
      },
    };
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport: revertingTransport,
      multiHopPaths: new Map([
        [
          pairKey(USDC, DAI),
          {
            tokens: [USDC, WETH, DAI],
            fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM],
          },
        ],
      ]),
    });

    const r = await venue.quote({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000n,
      buyAsset: DAI,
    });
    expect(r).toBeNull();
  });

  it("multi-hop integrates with allowance pre-flight (skipApproveWhenSufficient)", async () => {
    // Multi-hop swaps still need ONE approve (for the input asset
    // = sellAsset). Confirm pre-flight applies the same way.
    const { pairKey, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );

    const stats = { allowanceCalls: 0 };
    const transport: Eth_RpcTransport = {
      async call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T> {
        if (method !== "eth_call") return "0x" as unknown as T;
        const data = (params[0] as { data: string }).data.toLowerCase();
        if (data.startsWith("0xdd62ed3e")) {
          stats.allowanceCalls += 1;
          // Big allowance — should skip approve.
          return ("0x" +
            ((1n << 256n) - 1n).toString(16).padStart(64, "0")) as unknown as T;
        }
        if (data.startsWith("0xcdca1753")) {
          // Multi-hop quote — return a successful amountOut.
          return ("0x" +
            (99_000_000_000_000n).toString(16).padStart(64, "0") +
            (128n).toString(16).padStart(64, "0") +
            (192n).toString(16).padStart(64, "0") +
            (200_000n).toString(16).padStart(64, "0") +
            "0".repeat(64) +
            "0".repeat(64)) as unknown as T;
        }
        return "0x" as unknown as T;
      },
    };
    const AGENT_OWNER = ("0x" + "ee".repeat(20)) as `0x${string}`;
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      multiHopPaths: new Map([
        [
          pairKey(USDC, DAI),
          {
            tokens: [USDC, WETH, DAI],
            fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM],
          },
        ],
      ]),
    });

    const q = await venue.quote({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: DAI,
    });
    expect(q).not.toBeNull();

    const txs = await venue.buildSwapTxs({
      chainId: 8453,
      sellAsset: USDC,
      sellAmount: 1_000_000n,
      buyAsset: DAI,
      recipient: RECIPIENT,
      amountOutMinimum: 1n,
      venueData: q!.venueData,
      deadlineMs: Date.now() + 60_000,
    });
    // [swap] only — approve skipped because allowance is huge.
    expect(txs).toHaveLength(1);
    expect(txs[0].label).toBe("swap");
    expect(stats.allowanceCalls).toBe(1);
  });
});

// ─── PR #113: exactOutputSingle ──────────────────────────

describe("encodeQuoteExactOutputSingle (PR #113)", () => {
  it("emits selector + 5 inline slots (164 bytes total)", async () => {
    const {
      encodeQuoteExactOutputSingle,
      SELECTOR_QUOTE_EXACT_OUTPUT_SINGLE,
      UNISWAP_V3_FEE_TIERS,
    } = await import("@aethelred/wallet-swap-venue-uniswap-v3");
    const calldata = encodeQuoteExactOutputSingle({
      tokenIn: USDC,
      tokenOut: WETH,
      amount: 99_000_000_000_000n, // exact buy amount
      fee: UNISWAP_V3_FEE_TIERS.LOW,
      sqrtPriceLimitX96: 0n,
    });
    // 4-byte selector + 5 × 32 bytes = 164 bytes = 0x + 328 hex chars
    expect(calldata).toHaveLength(2 + 8 + 320);
    expect(calldata.startsWith(SELECTOR_QUOTE_EXACT_OUTPUT_SINGLE)).toBe(true);
    // tokenIn slot is byte 4..36
    const tokenInHex = calldata.slice(2 + 8, 2 + 8 + 64);
    expect(tokenInHex.toLowerCase()).toContain(USDC.slice(2).toLowerCase());
  });

  it("differs from exactInputSingle ONLY by selector (same wire format otherwise)", async () => {
    const {
      encodeQuoteExactInputSingle,
      encodeQuoteExactOutputSingle,
      SELECTOR_QUOTE_EXACT_INPUT_SINGLE,
      SELECTOR_QUOTE_EXACT_OUTPUT_SINGLE,
      UNISWAP_V3_FEE_TIERS,
    } = await import("@aethelred/wallet-swap-venue-uniswap-v3");

    const inputCall = encodeQuoteExactInputSingle({
      tokenIn: USDC,
      tokenOut: WETH,
      amountIn: 1_000_000n,
      fee: UNISWAP_V3_FEE_TIERS.LOW,
      sqrtPriceLimitX96: 0n,
    });
    const outputCall = encodeQuoteExactOutputSingle({
      tokenIn: USDC,
      tokenOut: WETH,
      amount: 1_000_000n,
      fee: UNISWAP_V3_FEE_TIERS.LOW,
      sqrtPriceLimitX96: 0n,
    });

    // Same length (both are 164-byte calldata).
    expect(inputCall).toHaveLength(outputCall.length);
    // Selector differs.
    expect(inputCall.slice(0, 10)).toBe(SELECTOR_QUOTE_EXACT_INPUT_SINGLE);
    expect(outputCall.slice(0, 10)).toBe(SELECTOR_QUOTE_EXACT_OUTPUT_SINGLE);
    // Body (post-selector) is identical.
    expect(inputCall.slice(10)).toBe(outputCall.slice(10));
  });

  it("rejects malformed token addresses", async () => {
    const { encodeQuoteExactOutputSingle, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    expect(() =>
      encodeQuoteExactOutputSingle({
        tokenIn: "0xnothex" as `0x${string}`,
        tokenOut: WETH,
        amount: 1n,
        fee: UNISWAP_V3_FEE_TIERS.LOW,
      }),
    ).toThrow();
  });
});

describe("decodeQuoteExactOutputSingleResult (PR #113)", () => {
  it("extracts amountIn from slot 0 (4-slot quoter result)", async () => {
    const { decodeQuoteExactOutputSingleResult } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const amountIn = 1_500_000n;
    const sqrtPrice = 1n << 96n;
    const ticks = 3n;
    const gas = 250_000n;
    const hex = ("0x" +
      amountIn.toString(16).padStart(64, "0") +
      sqrtPrice.toString(16).padStart(64, "0") +
      ticks.toString(16).padStart(64, "0") +
      gas.toString(16).padStart(64, "0")) as `0x${string}`;

    const decoded = decodeQuoteExactOutputSingleResult(hex);
    expect(decoded.amountIn).toBe(amountIn);
    expect(decoded.sqrtPriceX96After).toBe(sqrtPrice);
    expect(decoded.initializedTicksCrossed).toBe(3);
    expect(decoded.gasEstimate).toBe(gas);
  });

  it("rejects too-short result", async () => {
    const { decodeQuoteExactOutputSingleResult } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    expect(() => decodeQuoteExactOutputSingleResult("0xdead")).toThrow(
      /≥ 128 bytes/i,
    );
  });
});

describe("encodeExactOutputSingle (PR #113)", () => {
  it("emits selector + 7 inline slots in correct order", async () => {
    const {
      encodeExactOutputSingle,
      SELECTOR_EXACT_OUTPUT_SINGLE,
      UNISWAP_V3_FEE_TIERS,
    } = await import("@aethelred/wallet-swap-venue-uniswap-v3");

    const calldata = encodeExactOutputSingle({
      tokenIn: USDC,
      tokenOut: WETH,
      fee: UNISWAP_V3_FEE_TIERS.LOW,
      recipient: RECIPIENT,
      amountOut: 99_000_000_000_000n,
      amountInMaximum: 1_000_000n,
      sqrtPriceLimitX96: 0n,
    });

    // 4 + 7*32 = 228 bytes = 0x + 456 hex chars
    expect(calldata).toHaveLength(2 + 8 + 7 * 64);
    expect(calldata.startsWith(SELECTOR_EXACT_OUTPUT_SINGLE)).toBe(true);

    const stripped = calldata.slice(2 + 8);
    // Slot 0: tokenIn
    expect(stripped.slice(0, 64).toLowerCase()).toContain(
      USDC.slice(2).toLowerCase(),
    );
    // Slot 1: tokenOut
    expect(stripped.slice(64, 128).toLowerCase()).toContain(
      WETH.slice(2).toLowerCase(),
    );
    // Slot 2: fee = 500 (0x1f4)
    expect(BigInt("0x" + stripped.slice(128, 192))).toBe(
      BigInt(UNISWAP_V3_FEE_TIERS.LOW),
    );
    // Slot 3: recipient
    expect(stripped.slice(192, 256).toLowerCase()).toContain(
      RECIPIENT.slice(2).toLowerCase(),
    );
    // Slot 4: amountOut = exact buy amount
    expect(BigInt("0x" + stripped.slice(256, 320))).toBe(99_000_000_000_000n);
    // Slot 5: amountInMaximum = sell ceiling
    expect(BigInt("0x" + stripped.slice(320, 384))).toBe(1_000_000n);
    // Slot 6: sqrtPriceLimitX96 = 0
    expect(BigInt("0x" + stripped.slice(384, 448))).toBe(0n);
  });

  it("layout has SAME body shape as exactInputSingle (selector-only difference)", async () => {
    // Strict invariant: Uniswap's ABI design is intentional — the
    // wire format is identical between exactInputSingle and
    // exactOutputSingle except for the selector and the SEMANTIC
    // of two slots (amountIn/amountOut, amountOutMinimum/amountInMaximum).
    const {
      encodeExactInputSingle,
      encodeExactOutputSingle,
      SELECTOR_EXACT_INPUT_SINGLE,
      SELECTOR_EXACT_OUTPUT_SINGLE,
      UNISWAP_V3_FEE_TIERS,
    } = await import("@aethelred/wallet-swap-venue-uniswap-v3");

    const inputCall = encodeExactInputSingle({
      tokenIn: USDC,
      tokenOut: WETH,
      fee: UNISWAP_V3_FEE_TIERS.LOW,
      recipient: RECIPIENT,
      amountIn: 1_000_000n,
      amountOutMinimum: 99_000_000_000_000n,
      sqrtPriceLimitX96: 0n,
    });
    const outputCall = encodeExactOutputSingle({
      tokenIn: USDC,
      tokenOut: WETH,
      fee: UNISWAP_V3_FEE_TIERS.LOW,
      recipient: RECIPIENT,
      amountOut: 1_000_000n, // intentional: same numeric values, different semantic
      amountInMaximum: 99_000_000_000_000n,
      sqrtPriceLimitX96: 0n,
    });

    expect(inputCall).toHaveLength(outputCall.length);
    expect(inputCall.slice(0, 10)).toBe(SELECTOR_EXACT_INPUT_SINGLE);
    expect(outputCall.slice(0, 10)).toBe(SELECTOR_EXACT_OUTPUT_SINGLE);
    // Bodies are identical — same params produce same wire format.
    expect(inputCall.slice(10)).toBe(outputCall.slice(10));
  });
});

describe("UniswapV3SwapVenue exactOutput (PR #113)", () => {
  function makeOutputTransport(opts: {
    readonly amountIn: bigint;
    readonly onQuote?: (data: string) => void;
  }): Eth_RpcTransport {
    return {
      async call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T> {
        if (method !== "eth_call") return "0x" as unknown as T;
        const callObj = params[0] as { data: string };
        const data = callObj.data.toLowerCase();
        opts.onQuote?.(data);

        // exactOutputSingle quoter (selector 0xbd21704a)
        if (data.startsWith("0xbd21704a")) {
          const result = ("0x" +
            opts.amountIn.toString(16).padStart(64, "0") +
            (1n << 96n).toString(16).padStart(64, "0") +
            (2n).toString(16).padStart(64, "0") +
            (180_000n).toString(16).padStart(64, "0")) as `0x${string}`;
          return result as unknown as T;
        }
        return "0x" as unknown as T;
      },
    };
  }

  it("quoteExactOutput: returns expectedSellAmount + venueData with exact buyAmount", async () => {
    let observedSelector = "";
    const transport = makeOutputTransport({
      amountIn: 1_500_000n,
      onQuote: (data) => {
        observedSelector = data.slice(0, 10);
      },
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      defaultFeeTier: 500,
    });

    const r = await venue.quoteExactOutput({
      chainId: 8453,
      sellAsset: USDC,
      buyAsset: WETH,
      buyAmount: 99_000_000_000_000n,
    });
    expect(r).not.toBeNull();
    expect(r!.expectedSellAmount).toBe(1_500_000n);
    expect(r!.venueData.expectedBuyAmount).toBe(99_000_000_000_000n); // exact requested
    expect(r!.venueData.expectedSellAmount).toBe(1_500_000n); // quoted
    expect(observedSelector).toBe("0xbd21704a"); // exactOutputSingle quoter
  });

  it("quoteExactOutput: returns null on chainId mismatch / zero buyAmount / same asset", async () => {
    const transport = makeOutputTransport({ amountIn: 1n });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
    });

    expect(
      await venue.quoteExactOutput({
        chainId: 1, // wrong chain
        sellAsset: USDC,
        buyAsset: WETH,
        buyAmount: 1n,
      }),
    ).toBeNull();
    expect(
      await venue.quoteExactOutput({
        chainId: 8453,
        sellAsset: USDC,
        buyAsset: WETH,
        buyAmount: 0n,
      }),
    ).toBeNull();
    expect(
      await venue.quoteExactOutput({
        chainId: 8453,
        sellAsset: USDC,
        buyAsset: USDC, // same asset
        buyAmount: 1n,
      }),
    ).toBeNull();
  });

  it("quoteExactOutput: returns null on quoter revert (no liquidity)", async () => {
    const revertingTransport: Eth_RpcTransport = {
      async call() {
        throw new Error("execution reverted");
      },
    };
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport: revertingTransport,
    });
    const r = await venue.quoteExactOutput({
      chainId: 8453,
      sellAsset: USDC,
      buyAsset: WETH,
      buyAmount: 1n,
    });
    expect(r).toBeNull();
  });

  it("buildExactOutputSwapTxs: emits [approve, swap] with exactOutputSingle calldata", async () => {
    const { SELECTOR_EXACT_OUTPUT_SINGLE } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const transport = makeOutputTransport({ amountIn: 1_500_000n });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      defaultFeeTier: 500,
    });

    const quote = await venue.quoteExactOutput({
      chainId: 8453,
      sellAsset: USDC,
      buyAsset: WETH,
      buyAmount: 99_000_000_000_000n,
    });
    expect(quote).not.toBeNull();

    const txs = await venue.buildExactOutputSwapTxs({
      chainId: 8453,
      sellAsset: USDC,
      buyAsset: WETH,
      recipient: RECIPIENT,
      buyAmount: 99_000_000_000_000n,
      amountInMaximum: 1_500_000n,
      venueData: quote!.venueData,
      deadlineMs: Date.now() + 60_000,
    });

    expect(txs).toHaveLength(2);
    expect(txs[0].label).toBe("approve");
    // Approve is for amountInMaximum (the ceiling), not buyAmount.
    expect(txs[0].to).toBe(USDC);
    expect(txs[1].label).toBe("swap");
    expect(txs[1].to).toBe(ROUTER);
    expect(txs[1].data.startsWith(SELECTOR_EXACT_OUTPUT_SINGLE)).toBe(true);
  });

  it("buildExactOutputSwapTxs: integrates with allowance pre-flight (skipApproveWhenSufficient)", async () => {
    const stats = { allowanceCalls: 0 };
    const transport: Eth_RpcTransport = {
      async call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T> {
        if (method !== "eth_call") return "0x" as unknown as T;
        const data = (params[0] as { data: string }).data.toLowerCase();
        if (data.startsWith("0xdd62ed3e")) {
          stats.allowanceCalls += 1;
          // Big allowance — skip approve.
          return ("0x" +
            ((1n << 256n) - 1n).toString(16).padStart(64, "0")) as unknown as T;
        }
        if (data.startsWith("0xbd21704a")) {
          return ("0x" +
            (1_500_000n).toString(16).padStart(64, "0") +
            (1n << 96n).toString(16).padStart(64, "0") +
            (2n).toString(16).padStart(64, "0") +
            (180_000n).toString(16).padStart(64, "0")) as unknown as T;
        }
        return "0x" as unknown as T;
      },
    };
    const AGENT_OWNER = ("0x" + "ee".repeat(20)) as `0x${string}`;
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      defaultFeeTier: 500,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
    });

    const q = await venue.quoteExactOutput({
      chainId: 8453,
      sellAsset: USDC,
      buyAsset: WETH,
      buyAmount: 99_000_000_000_000n,
    });
    expect(q).not.toBeNull();

    const txs = await venue.buildExactOutputSwapTxs({
      chainId: 8453,
      sellAsset: USDC,
      buyAsset: WETH,
      recipient: RECIPIENT,
      buyAmount: 99_000_000_000_000n,
      amountInMaximum: 1_500_000n,
      venueData: q!.venueData,
      deadlineMs: Date.now() + 60_000,
    });
    // [swap] only — approve skipped.
    expect(txs).toHaveLength(1);
    expect(txs[0].label).toBe("swap");
    expect(stats.allowanceCalls).toBe(1);
  });

  it("buildExactOutputSwapTxs: approve is for amountInMaximum (ceiling), NOT buyAmount", async () => {
    const { SELECTOR_ERC20_APPROVE } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const transport = makeOutputTransport({ amountIn: 1_500_000n });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      defaultFeeTier: 500,
    });

    const txs = await venue.buildExactOutputSwapTxs({
      chainId: 8453,
      sellAsset: USDC,
      buyAsset: WETH,
      recipient: RECIPIENT,
      buyAmount: 99_000_000_000_000n,
      amountInMaximum: 1_500_000n,
      deadlineMs: Date.now() + 60_000,
    });

    expect(txs[0].data.startsWith(SELECTOR_ERC20_APPROVE)).toBe(true);
    // Last 32 bytes of approve calldata = amount; should equal amountInMaximum.
    const approveAmountHex = txs[0].data.slice(-64);
    expect(BigInt("0x" + approveAmountHex)).toBe(1_500_000n);
  });
});

// ─── PR #114: Multi-hop exact-output ─────────────────────

describe("encodeQuoteExactOutput / encodeExactOutput (PR #114)", () => {
  it("encodeQuoteExactOutput: layout matches encodeQuoteExactInput body byte-for-byte", async () => {
    const {
      encodeQuoteExactOutput,
      encodeQuoteExactInput,
      encodePath,
      SELECTOR_QUOTE_EXACT_OUTPUT,
      SELECTOR_QUOTE_EXACT_INPUT,
      UNISWAP_V3_FEE_TIERS,
    } = await import("@aethelred/wallet-swap-venue-uniswap-v3");

    const path = encodePath({
      tokens: [USDC, WETH, DAI],
      fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM],
    });
    const inputCall = encodeQuoteExactInput({ path, amountIn: 1_000_000n });
    const outputCall = encodeQuoteExactOutput({ path, amountOut: 1_000_000n });

    expect(inputCall).toHaveLength(outputCall.length);
    expect(inputCall.slice(0, 10)).toBe(SELECTOR_QUOTE_EXACT_INPUT);
    expect(outputCall.slice(0, 10)).toBe(SELECTOR_QUOTE_EXACT_OUTPUT);
    // Bodies are identical post-selector — Uniswap's intentional ABI symmetry.
    expect(inputCall.slice(10)).toBe(outputCall.slice(10));
  });

  it("encodeExactOutput: layout matches encodeExactInput body byte-for-byte", async () => {
    const {
      encodeExactOutput,
      encodeExactInput,
      encodePath,
      SELECTOR_EXACT_OUTPUT,
      SELECTOR_EXACT_INPUT,
      UNISWAP_V3_FEE_TIERS,
    } = await import("@aethelred/wallet-swap-venue-uniswap-v3");

    const path = encodePath({
      tokens: [USDC, WETH, DAI],
      fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM],
    });
    const inputCall = encodeExactInput({
      path,
      recipient: RECIPIENT,
      amountIn: 1_000_000n,
      amountOutMinimum: 99_000n,
    });
    const outputCall = encodeExactOutput({
      path,
      recipient: RECIPIENT,
      amountOut: 1_000_000n,
      amountInMaximum: 99_000n,
    });

    expect(inputCall).toHaveLength(outputCall.length);
    expect(inputCall.slice(0, 10)).toBe(SELECTOR_EXACT_INPUT);
    expect(outputCall.slice(0, 10)).toBe(SELECTOR_EXACT_OUTPUT);
    expect(inputCall.slice(10)).toBe(outputCall.slice(10));
  });

  it("decodeQuoteExactOutputResult: extracts amountIn from slot 0", async () => {
    const { decodeQuoteExactOutputResult } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const amountIn = 99_000_000_000_000n;
    const offset1 = 128n;
    const offset2 = 192n;
    const gasEstimate = 250_000n;
    const hex = ("0x" +
      amountIn.toString(16).padStart(64, "0") +
      offset1.toString(16).padStart(64, "0") +
      offset2.toString(16).padStart(64, "0") +
      gasEstimate.toString(16).padStart(64, "0") +
      "0".repeat(64) +
      "0".repeat(64)) as `0x${string}`;
    const decoded = decodeQuoteExactOutputResult(hex);
    expect(decoded.amountIn).toBe(amountIn);
    expect(decoded.gasEstimate).toBe(gasEstimate);
  });

  it("encoder rejects empty / malformed path", async () => {
    const { encodeQuoteExactOutput } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    expect(() =>
      encodeQuoteExactOutput({
        path: "0x" as `0x${string}`,
        amountOut: 1n,
      }),
    ).toThrow(/even-length hex/i);
  });
});

describe("UniswapV3SwapVenue multi-hop exact-output (PR #114)", () => {
  /**
   * Multi-hop exact-output transport: handles the multi-hop quoter
   * selector (0x2f80bb1d). Records the SCALED path bytes sent by
   * the venue so tests can verify path-reversal happened.
   */
  function makeMultiHopOutputTransport(opts: {
    readonly amountIn: bigint;
    readonly onQuote?: (data: string) => void;
  }): Eth_RpcTransport {
    return {
      async call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T> {
        if (method !== "eth_call") return "0x" as unknown as T;
        const data = (params[0] as { data: string }).data.toLowerCase();
        opts.onQuote?.(data);

        // Multi-hop exactOutput quoter (selector 0x2f80bb1d)
        if (data.startsWith("0x2f80bb1d")) {
          const result = ("0x" +
            opts.amountIn.toString(16).padStart(64, "0") +
            (128n).toString(16).padStart(64, "0") + // offset arr1
            (192n).toString(16).padStart(64, "0") + // offset arr2
            (220_000n).toString(16).padStart(64, "0") +
            "0".repeat(64) +
            "0".repeat(64)) as `0x${string}`;
          return result as unknown as T;
        }
        return "0x" as unknown as T;
      },
    };
  }

  it("quoteExactOutput: multi-hop path uses quoteExactOutput selector + reversed wire path", async () => {
    const { pairKey, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    let observedCalldata = "";
    const transport = makeMultiHopOutputTransport({
      amountIn: 1_500_000n,
      onQuote: (data) => {
        if (data.startsWith("0x2f80bb1d")) observedCalldata = data;
      },
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      multiHopPaths: new Map([
        // Operator's logical path: USDC → WETH → DAI (input → output)
        [
          pairKey(USDC, DAI),
          {
            tokens: [USDC, WETH, DAI],
            fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM],
          },
        ],
      ]),
    });

    const r = await venue.quoteExactOutput({
      chainId: 8453,
      sellAsset: USDC,
      buyAsset: DAI,
      buyAmount: 99_000_000_000_000n,
    });

    expect(r).not.toBeNull();
    expect(r!.expectedSellAmount).toBe(1_500_000n);
    expect(r!.venueData.expectedBuyAmount).toBe(99_000_000_000_000n);
    expect(r!.venueData.expectedSellAmount).toBe(1_500_000n);
    // venueData.path is the LOGICAL path (input → output direction)
    expect(r!.venueData.path!.tokens).toEqual([USDC, WETH, DAI]);

    // The wire path sent in calldata is REVERSED (DAI first, USDC last).
    // Wire path for [DAI || fee || WETH || fee || USDC] = 66 bytes.
    // Pull length slot at byte 100 (post-selector + offset + amount).
    expect(observedCalldata).not.toBe("");
    expect(observedCalldata.startsWith("0x2f80bb1d")).toBe(true);
    // Path data starts at byte 132 of stripped (= offset 0x84 in calldata after 0x).
    // The first 20 bytes of the wire path are tokenOut (DAI), NOT tokenIn (USDC).
    const stripped = observedCalldata.slice(2 + 8); // strip 0x + selector
    // Path data starts after offset (32) + amount (32) + length (32) = byte 96 in stripped
    const pathStart = 96 * 2; // hex offset
    const firstTokenHex = stripped.slice(pathStart, pathStart + 40);
    expect(firstTokenHex).toBe(DAI.slice(2).toLowerCase()); // REVERSED — DAI first
    // Wire path layout (66 bytes total): DAI(20) + fee(3) + WETH(20) + fee(3) + USDC(20)
    // Last token (USDC) starts at byte 46 of path = hex offset 92.
    const lastTokenHex = stripped.slice(pathStart + 92, pathStart + 92 + 40);
    expect(lastTokenHex).toBe(USDC.slice(2).toLowerCase());
  });

  it("buildExactOutputSwapTxs: multi-hop emits exactOutput calldata with reversed wire path", async () => {
    const {
      pairKey,
      UNISWAP_V3_FEE_TIERS,
      SELECTOR_EXACT_OUTPUT,
    } = await import("@aethelred/wallet-swap-venue-uniswap-v3");

    const transport = makeMultiHopOutputTransport({ amountIn: 1_500_000n });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      multiHopPaths: new Map([
        [
          pairKey(USDC, DAI),
          {
            tokens: [USDC, WETH, DAI],
            fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM],
          },
        ],
      ]),
    });

    const quote = await venue.quoteExactOutput({
      chainId: 8453,
      sellAsset: USDC,
      buyAsset: DAI,
      buyAmount: 99_000_000_000_000n,
    });
    expect(quote).not.toBeNull();

    const txs = await venue.buildExactOutputSwapTxs({
      chainId: 8453,
      sellAsset: USDC,
      buyAsset: DAI,
      recipient: RECIPIENT,
      buyAmount: 99_000_000_000_000n,
      amountInMaximum: 1_500_000n,
      venueData: quote!.venueData,
      deadlineMs: Date.now() + 60_000,
    });

    expect(txs).toHaveLength(2);
    expect(txs[1].label).toBe("swap");
    expect(txs[1].to).toBe(ROUTER);
    expect(txs[1].data.startsWith(SELECTOR_EXACT_OUTPUT)).toBe(true);
    // Wire path is reversed — DAI appears in the byte position
    // where USDC would have been for exactInput.
    const stripped = txs[1].data.slice(2 + 8);
    // exactOutput layout: 0x20 (32) + 0x80 (32) + recipient (32) + amountOut (32) + amountInMaximum (32) + length (32) + path
    // Path starts at byte 192 in stripped.
    const pathStart = 192 * 2;
    const firstTokenHex = stripped.slice(pathStart, pathStart + 40);
    expect(firstTokenHex).toBe(DAI.slice(2).toLowerCase());
  });

  it("quoteExactOutput multi-hop: auto-reverse pair lookup works for symmetric configs (PR #109 + #114)", async () => {
    // Operator registered the path under DAI→USDC, but swap is USDC→DAI.
    // multiHopPathFor (PR #109) auto-reverses to match the swap direction;
    // then quoteExactOutputMultiHop reverses AGAIN for the wire encoding.
    // Net effect: the wire path is the OPERATOR's original path.
    const { pairKey, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );

    let observedCalldata = "";
    const transport = makeMultiHopOutputTransport({
      amountIn: 1_500_000n,
      onQuote: (data) => {
        if (data.startsWith("0x2f80bb1d")) observedCalldata = data;
      },
    });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      multiHopPaths: new Map([
        // Registered under DAI → USDC; swap is USDC → DAI (reverse)
        [
          pairKey(DAI, USDC),
          {
            tokens: [DAI, WETH, USDC],
            fees: [UNISWAP_V3_FEE_TIERS.MEDIUM, UNISWAP_V3_FEE_TIERS.LOW],
          },
        ],
      ]),
    });

    const r = await venue.quoteExactOutput({
      chainId: 8453,
      sellAsset: USDC,
      buyAsset: DAI,
      buyAmount: 99_000_000_000_000n,
    });

    expect(r).not.toBeNull();
    // venueData.path is auto-reversed to LOGICAL direction USDC → DAI
    expect(r!.venueData.path!.tokens).toEqual([USDC, WETH, DAI]);

    // The wire path sent in calldata is the OPERATOR's ORIGINAL
    // registered path (DAI first), because:
    //   1. multiHopPathFor auto-reversed [DAI,WETH,USDC] → [USDC,WETH,DAI] for swap direction
    //   2. quoteExactOutputMultiHop reversed [USDC,WETH,DAI] → [DAI,WETH,USDC] for wire encoding
    // Net: the wire path matches the operator's original registration, by happy coincidence.
    expect(observedCalldata).not.toBe("");
    const stripped = observedCalldata.slice(2 + 8);
    const pathStart = 96 * 2;
    const firstTokenHex = stripped.slice(pathStart, pathStart + 40);
    expect(firstTokenHex).toBe(DAI.slice(2).toLowerCase());
  });

  it("buildExactOutputSwapTxs: validates path matches sell/buy assets at build time", async () => {
    const { UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );
    const transport = makeMultiHopOutputTransport({ amountIn: 1n });
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
    });

    // Forged venueData with mismatched path direction.
    await expect(
      venue.buildExactOutputSwapTxs({
        chainId: 8453,
        sellAsset: USDC,
        buyAsset: DAI,
        recipient: RECIPIENT,
        buyAmount: 1_000n,
        amountInMaximum: 1n,
        venueData: {
          feeTier: UNISWAP_V3_FEE_TIERS.LOW,
          expectedBuyAmount: 1_000n,
          expectedSellAmount: 1n,
          sqrtPriceX96After: 0n,
          path: {
            // path starts with DAI (wrong — params says sellAsset=USDC)
            tokens: [DAI, WETH, USDC],
            fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.LOW],
          },
        },
        deadlineMs: Date.now() + 60_000,
      }),
    ).rejects.toMatchObject({
      code: "invalid-asset-address",
    });
  });

  it("multi-hop exact-output integrates with allowance pre-flight + cache", async () => {
    const { pairKey, UNISWAP_V3_FEE_TIERS } = await import(
      "@aethelred/wallet-swap-venue-uniswap-v3"
    );

    const stats = { allowanceCalls: 0 };
    const transport: Eth_RpcTransport = {
      async call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T> {
        if (method !== "eth_call") return "0x" as unknown as T;
        const data = (params[0] as { data: string }).data.toLowerCase();
        if (data.startsWith("0xdd62ed3e")) {
          stats.allowanceCalls += 1;
          return ("0x" +
            ((1n << 256n) - 1n).toString(16).padStart(64, "0")) as unknown as T;
        }
        if (data.startsWith("0x2f80bb1d")) {
          return ("0x" +
            (1_500_000n).toString(16).padStart(64, "0") +
            (128n).toString(16).padStart(64, "0") +
            (192n).toString(16).padStart(64, "0") +
            (220_000n).toString(16).padStart(64, "0") +
            "0".repeat(64) +
            "0".repeat(64)) as unknown as T;
        }
        return "0x" as unknown as T;
      },
    };
    const AGENT = ("0x" + "ee".repeat(20)) as `0x${string}`;
    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT,
      skipApproveWhenSufficient: true,
      multiHopPaths: new Map([
        [
          pairKey(USDC, DAI),
          {
            tokens: [USDC, WETH, DAI],
            fees: [UNISWAP_V3_FEE_TIERS.LOW, UNISWAP_V3_FEE_TIERS.MEDIUM],
          },
        ],
      ]),
    });

    const q = await venue.quoteExactOutput({
      chainId: 8453,
      sellAsset: USDC,
      buyAsset: DAI,
      buyAmount: 99_000_000_000_000n,
    });
    expect(q).not.toBeNull();

    const txs = await venue.buildExactOutputSwapTxs({
      chainId: 8453,
      sellAsset: USDC,
      buyAsset: DAI,
      recipient: RECIPIENT,
      buyAmount: 99_000_000_000_000n,
      amountInMaximum: 1_500_000n,
      venueData: q!.venueData,
      deadlineMs: Date.now() + 60_000,
    });
    // [swap] only — approve skipped, agent has unlimited allowance.
    expect(txs).toHaveLength(1);
    expect(txs[0].label).toBe("swap");
    expect(stats.allowanceCalls).toBe(1);
  });
});
