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
  pairKey,
  SELECTOR_ERC20_APPROVE,
  SELECTOR_EXACT_INPUT_SINGLE,
  SELECTOR_QUOTE_EXACT_INPUT_SINGLE,
  TOPIC_SWAP_V3,
  UniswapV3SwapVenue,
  UniswapV3VenueError,
  UNISWAP_V3_FEE_TIERS,
  type Eth_RpcTransport,
} from "@aethelred/wallet-swap-venue-uniswap-v3";

// ─── Fixtures ───────────────────────────────────────

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`;
const WETH = "0x4200000000000000000000000000000000000006" as `0x${string}`;
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
