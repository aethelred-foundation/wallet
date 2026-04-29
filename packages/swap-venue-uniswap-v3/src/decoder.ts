/**
 * Decode the Uniswap v3 `Swap` event from a transaction receipt
 * to extract the actual buy-amount delivered to the recipient.
 *
 * Event signature (verbatim from `IUniswapV3PoolEvents.sol`):
 *
 *   event Swap(
 *     address indexed sender,
 *     address indexed recipient,
 *     int256 amount0,
 *     int256 amount1,
 *     uint160 sqrtPriceX96,
 *     uint128 liquidity,
 *     int24 tick
 *   )
 *
 * Topic0 (event signature hash) is the keccak256 of:
 *   `Swap(address,address,int256,int256,uint160,uint128,int24)`
 *
 * Pre-computed value:
 *   `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`
 *
 * Verified against any pool's first Swap event on Etherscan.
 *
 * **Decoding the buyAmount:**
 *
 * v3 pools store amounts as `int256` deltas. `amount0` is the
 * delta for token0; `amount1` for token1. Negative values are
 * "leaving the pool" (delivered to the recipient). Positive
 * values are "entering the pool" (paid by the sender).
 *
 * Token order in a v3 pool is canonical: `token0 < token1` by
 * address (lexicographic, lowercased). So which side our
 * `buyAsset` is determines which delta we read.
 *
 * After determining direction:
 *   - If buyAsset is token0 → amount0 is negative (out-flow);
 *     buyAmount = -amount0
 *   - If buyAsset is token1 → amount1 is negative;
 *     buyAmount = -amount1
 *
 * Sign convention check: the receipt's logs include the Swap
 * event AND the ERC-20 Transfer event from the pool's
 * out-token. We could decode either; the Swap event is
 * canonical to v3 and lets us avoid scanning Transfer events
 * across multi-hop paths.
 */

import { UniswapV3VenueError } from "./types";

// ─── Topic constants ──────────────────────────────────────

/**
 * Pre-computed topic0 for `Swap(address,address,int256,int256,uint160,uint128,int24)`.
 *
 * Verified value: keccak256 of the canonical signature bytes.
 * Any future pool ABI change requires regenerating this.
 */
export const TOPIC_SWAP_V3 =
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67" as const;

// ─── int256 helpers ────────────────────────────────────────

const TWO_POW_256 = 1n << 256n;
const TWO_POW_255 = 1n << 255n;

/**
 * Convert a 32-byte (64-hex-char) two's-complement word to a
 * signed bigint. v3's amount0/amount1 are int256; their on-the-wire
 * representation is two's-complement.
 */
function decodeInt256(hex64: string): bigint {
  const u = BigInt("0x" + hex64);
  // If the high bit is set, this is a negative two's-complement number.
  return u >= TWO_POW_255 ? u - TWO_POW_256 : u;
}

// ─── Public decoder ───────────────────────────────────────

/**
 * Logs from `eth_getTransactionReceipt`'s `logs` array — same
 * shape exposed by `@aethelred/wallet-notarization`'s `RawLog`.
 */
export interface RawLogShape {
  readonly address: `0x${string}`;
  readonly topics: ReadonlyArray<`0x${string}`>;
  readonly data: `0x${string}`;
}

export interface SwapEventDecoded {
  readonly poolAddress: `0x${string}`;
  readonly sender: `0x${string}`;
  readonly recipient: `0x${string}`;
  readonly amount0: bigint;
  readonly amount1: bigint;
  readonly sqrtPriceX96: bigint;
  readonly liquidity: bigint;
  readonly tick: number;
}

/**
 * Decode every Swap event in a receipt's log array. Returns
 * empty if no Swap events are present (e.g. tx reverted).
 *
 * Multi-hop swaps emit one Swap event per pool traversed; the
 * caller decides which one to read for the buyAmount (typically
 * the LAST event, which delivered to the final recipient).
 */
export function decodeSwapEvents(
  logs: ReadonlyArray<RawLogShape>,
): ReadonlyArray<SwapEventDecoded> {
  const out: SwapEventDecoded[] = [];
  for (const log of logs) {
    if (log.topics.length < 3) continue;
    if (log.topics[0]!.toLowerCase() !== TOPIC_SWAP_V3) continue;
    out.push(decodeOneSwapEvent(log));
  }
  return out;
}

/**
 * Decode a single Swap event, given the log already known to
 * have topic0 = TOPIC_SWAP_V3. Throws `swap-decode-failed` on
 * malformed input.
 */
function decodeOneSwapEvent(log: RawLogShape): SwapEventDecoded {
  // Topics: [topic0, sender (indexed), recipient (indexed)].
  // Both indexed addresses are 32-byte left-padded.
  if (log.topics.length < 3) {
    throw new UniswapV3VenueError(
      "swap-decode-failed",
      `Swap event has < 3 topics: ${log.topics.length}`,
    );
  }
  const sender = ("0x" + log.topics[1]!.slice(2 + 24).toLowerCase()) as `0x${string}`;
  const recipient = ("0x" +
    log.topics[2]!.slice(2 + 24).toLowerCase()) as `0x${string}`;

  // Data: 5 × 32 bytes for amount0, amount1, sqrtPriceX96,
  // liquidity, tick. tick is int24 but encoded as a full 32-byte
  // slot (right-padded? no — it's left-padded big-endian like
  // any int).
  if (!/^0x[0-9a-fA-F]+$/.test(log.data)) {
    throw new UniswapV3VenueError(
      "swap-decode-failed",
      `Swap event data is not hex: "${log.data}"`,
    );
  }
  const data = log.data.slice(2);
  if (data.length < 5 * 64) {
    throw new UniswapV3VenueError(
      "swap-decode-failed",
      `Swap event data too short: ${data.length / 2} bytes (expected ≥ 160)`,
    );
  }

  const amount0 = decodeInt256(data.slice(0, 64));
  const amount1 = decodeInt256(data.slice(64, 128));
  const sqrtPriceX96 = BigInt("0x" + data.slice(128, 192));
  const liquidity = BigInt("0x" + data.slice(192, 256));
  // tick is int24 — decode the full slot as int256, the sign
  // extension is correct for any int24 value.
  const tick = Number(decodeInt256(data.slice(256, 320)));

  return {
    poolAddress: log.address,
    sender,
    recipient,
    amount0,
    amount1,
    sqrtPriceX96,
    liquidity,
    tick,
  };
}

/**
 * Extract the `buyAmount` delivered to `recipient` from a
 * receipt's logs.
 *
 * Strategy:
 *
 *   1. Decode every Swap event.
 *   2. Filter to events whose `recipient` matches the input
 *      recipient (lowercased compare).
 *   3. Determine token order — `buyAsset.toLowerCase() <
 *      otherAsset.toLowerCase()` decides whether buyAsset is
 *      token0 or token1 in the pool.
 *   4. Sum the (negated) deltas for the matching side across
 *      all matching events. (Single-hop will have one event;
 *      this is forward-compatible with multi-hop.)
 *
 * Returns 0n if no matching event found — caller decides
 * whether that's an error (typically yes — the swap-solver
 * compares against `commitment` and throws
 * `fill-below-commitment` if zero).
 */
export function extractBuyAmount(params: {
  readonly logs: ReadonlyArray<RawLogShape>;
  readonly recipient: `0x${string}`;
  readonly buyAsset: `0x${string}`;
  readonly sellAsset: `0x${string}`;
}): bigint {
  const recipientLower = params.recipient.toLowerCase();
  const buyAssetLower = params.buyAsset.toLowerCase();
  const sellAssetLower = params.sellAsset.toLowerCase();

  const events = decodeSwapEvents(params.logs).filter(
    (e) => e.recipient.toLowerCase() === recipientLower,
  );

  // Token0 < Token1 by address (canonical v3 pool ordering).
  // We don't know which token of the PAIR is token0 without
  // checking the pool, but for ANY single pool, token0/token1
  // ordering is fixed. We infer from the buyAsset vs sellAsset
  // comparison: if buyAsset address is lexicographically less,
  // buyAsset is token0; the matching delta we want is amount0
  // (negative — the out-flow).
  const buyIsToken0 = buyAssetLower < sellAssetLower;

  let total = 0n;
  for (const e of events) {
    // The pool emits the swap with amount0/amount1 deltas signed
    // from the POOL's perspective: positive = received by pool,
    // negative = sent by pool. The recipient receives the
    // negative side.
    const delta = buyIsToken0 ? e.amount0 : e.amount1;
    if (delta < 0n) total += -delta;
    // If delta is positive, the recipient is on the wrong side
    // of the swap (or this is a different pool entirely).
    // Ignore — the caller will see total === 0n if all events
    // are mismatched.
  }
  return total;
}
