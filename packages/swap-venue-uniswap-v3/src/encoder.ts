/**
 * Hand-rolled ABI encoders for the three Uniswap v3 calls this
 * venue makes:
 *
 *   1. `QuoterV2.quoteExactInputSingle((tokenIn, tokenOut,
 *      amountIn, fee, sqrtPriceLimitX96))` — eth_call only
 *      (Quoter is view).
 *   2. `SwapRouter02.exactInputSingle((tokenIn, tokenOut, fee,
 *      recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96))`
 *      — submitted as a tx.
 *   3. `IERC20.approve(spender, amount)` — submitted as a tx
 *      before the swap.
 *
 * Selectors are pre-computed (avoiding a runtime keccak in the
 * hot path):
 *
 *   - `quoteExactInputSingle((address,address,uint256,uint24,uint160))` =
 *     `keccak256("quoteExactInputSingle((address,address,uint256,uint24,uint160))")[:4]`
 *     = `0xc6a5026a`
 *   - `exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))` =
 *     `keccak256("exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))")[:4]`
 *     = `0x04e45aaf`
 *   - `approve(address,uint256)` = `0x095ea7b3` (canonical ERC-20)
 *
 * Why hand-roll instead of viem? The wallet stack is zero-dep by
 * design (notarization, transfer-solver, smart-account all use
 * hand-rolled encoders for their narrow ABI needs). v3 calls are
 * more complex than ERC-20 transfer but still tractable — the
 * struct shape is fixed, every field is 32 bytes, and the layout
 * is documented in Uniswap's contract source. The benefit:
 * downstream consumers don't pay the ~200KB viem bundle cost for
 * a wallet-tier dependency. Same trade-off
 * `transfer-solver/calldata.ts` made for `transfer(address,uint256)`.
 *
 * **Verification path:** the selector constants below are
 * verified against `cast 4byte 0x04e45aaf` (returns
 * `exactInputSingle(...)`) and against the on-chain ABI of
 * SwapRouter02 / QuoterV2. Any future Uniswap version with
 * different signatures requires updating these selectors AND
 * the param order below.
 */

import type { UniswapV3FeeTier } from "./types";
import { UniswapV3VenueError } from "./types";

// ─── Selectors ─────────────────────────────────────────────

export const SELECTOR_QUOTE_EXACT_INPUT_SINGLE = "0xc6a5026a" as const;
export const SELECTOR_EXACT_INPUT_SINGLE = "0x04e45aaf" as const;
export const SELECTOR_ERC20_APPROVE = "0x095ea7b3" as const;

/**
 * Multi-hop quoter (PR #106). Same QuoterV2 contract as
 * `quoteExactInputSingle`, different selector + parameter shape:
 *
 * ```
 * function quoteExactInput(bytes path, uint256 amountIn)
 *   returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList,
 *            uint32[] initializedTicksCrossedList, uint256 gasEstimate)
 * ```
 *
 * Selector = `keccak256("quoteExactInput(bytes,uint256)")[:4]`
 * = `0xcdca1753`.
 */
export const SELECTOR_QUOTE_EXACT_INPUT = "0xcdca1753" as const;

/**
 * Multi-hop swap (PR #106). Same SwapRouter02 contract as
 * `exactInputSingle`, different selector + parameter shape:
 *
 * ```
 * struct ExactInputParams {
 *   bytes path;
 *   address recipient;
 *   uint256 amountIn;
 *   uint256 amountOutMinimum;
 * }
 * function exactInput(ExactInputParams params) returns (uint256 amountOut)
 * ```
 *
 * Selector = `keccak256("exactInput((bytes,address,uint256,uint256))")[:4]`
 * = `0xb858183f`.
 *
 * Note this is the SwapRouter02 variant — the older SwapRouter01
 * struct includes a `deadline` field and a different selector.
 * Operators on chains that only have SwapRouter01 cannot use
 * this venue's multi-hop path.
 */
export const SELECTOR_EXACT_INPUT = "0xb858183f" as const;

/**
 * `allowance(address owner, address spender) returns (uint256)` —
 * canonical ERC-20 view function. Selector is
 * `keccak256("allowance(address,address)")[:4]` = `0xdd62ed3e`.
 *
 * Used by the v3 venue's pre-flight optimization: before
 * emitting an `approve` tx, the venue calls `allowance(owner,
 * router)` and skips the approve when the existing allowance
 * is ≥ amountIn. Saves the approve tx on repeat swaps.
 */
export const SELECTOR_ERC20_ALLOWANCE = "0xdd62ed3e" as const;

// ─── Low-level encoding helpers ────────────────────────────

/**
 * Pad a `0x`-prefixed 20-byte address into a 32-byte ABI slot.
 * The address is right-aligned (left-padded with zeroes), as
 * required by Solidity's address-as-uint160 ABI representation.
 */
function padAddress(addr: `0x${string}`): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new UniswapV3VenueError(
      "invalid-asset-address",
      `expected 20-byte 0x-prefixed hex address, got "${addr}"`,
    );
  }
  return "0".repeat(24) + addr.slice(2).toLowerCase();
}

/** Pad an unsigned bigint into a 32-byte ABI slot (uint256, big-endian). */
function padUint256(n: bigint): string {
  if (n < 0n) {
    throw new UniswapV3VenueError(
      "invalid-asset-address", // borrow code; shouldn't happen
      `expected non-negative integer, got ${n}`,
    );
  }
  if (n >> 256n !== 0n) {
    throw new UniswapV3VenueError(
      "invalid-asset-address",
      `value ${n} does not fit in uint256`,
    );
  }
  return n.toString(16).padStart(64, "0");
}

/**
 * Pad a uint24 (fee tier) into a 32-byte ABI slot. Uniswap's fee
 * tier is 24 bits (max value 0xFFFFFF = 16,777,215); the four
 * canonical values fit easily.
 */
function padUint24(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 0xff_ff_ff) {
    throw new UniswapV3VenueError(
      "invalid-asset-address",
      `expected uint24 (0..16777215), got ${n}`,
    );
  }
  return n.toString(16).padStart(64, "0");
}

/**
 * Pad a uint160 (sqrtPriceLimitX96) into a 32-byte slot. Same
 * encoding as uint256 since the high 12 bytes are zero.
 */
function padUint160(n: bigint): string {
  if (n < 0n) {
    throw new UniswapV3VenueError(
      "invalid-asset-address",
      `sqrtPriceLimitX96 must be non-negative, got ${n}`,
    );
  }
  if (n >> 160n !== 0n) {
    throw new UniswapV3VenueError(
      "invalid-asset-address",
      `sqrtPriceLimitX96 ${n} does not fit in uint160`,
    );
  }
  return n.toString(16).padStart(64, "0");
}

// ─── QuoterV2.quoteExactInputSingle ────────────────────────

/**
 * Encode calldata for `quoteExactInputSingle((address tokenIn,
 * address tokenOut, uint256 amountIn, uint24 fee, uint160
 * sqrtPriceLimitX96))`.
 *
 * The struct is encoded as a "single dynamic tuple" — but
 * because every field is fixed-size (no dynamic types like
 * string/bytes), it's actually a static tuple inlined directly
 * after the selector. No offset / length prefix is needed.
 *
 * Layout (4 + 5*32 = 164 bytes calldata, "0x" + 328 hex chars):
 *
 *   selector (4 bytes)
 *   + tokenIn          (32-byte slot, address)
 *   + tokenOut         (32-byte slot, address)
 *   + amountIn         (32-byte slot, uint256)
 *   + fee              (32-byte slot, uint24 padded)
 *   + sqrtPriceLimitX96 (32-byte slot, uint160 padded)
 */
export function encodeQuoteExactInputSingle(params: {
  readonly tokenIn: `0x${string}`;
  readonly tokenOut: `0x${string}`;
  readonly amountIn: bigint;
  readonly fee: UniswapV3FeeTier;
  readonly sqrtPriceLimitX96?: bigint;
}): `0x${string}` {
  const tokenIn = padAddress(params.tokenIn);
  const tokenOut = padAddress(params.tokenOut);
  const amountIn = padUint256(params.amountIn);
  const fee = padUint24(params.fee);
  const sqrtPriceLimit = padUint160(params.sqrtPriceLimitX96 ?? 0n);

  return (SELECTOR_QUOTE_EXACT_INPUT_SINGLE +
    tokenIn +
    tokenOut +
    amountIn +
    fee +
    sqrtPriceLimit) as `0x${string}`;
}

// ─── QuoterV2 result decoder ───────────────────────────────

/**
 * QuoterV2 returns four values:
 *
 *   uint256 amountOut
 *   uint160 sqrtPriceX96After
 *   uint32 initializedTicksCrossed
 *   uint256 gasEstimate
 *
 * Wire format: 4 × 32-byte slots = 128 bytes (256 hex chars).
 * Some bridges / proxies may return shorter responses; we
 * defensively check the length.
 */
export function decodeQuoteExactInputSingleResult(
  resultHex: `0x${string}`,
): {
  readonly amountOut: bigint;
  readonly sqrtPriceX96After: bigint;
  readonly initializedTicksCrossed: number;
  readonly gasEstimate: bigint;
} {
  if (!/^0x[0-9a-fA-F]+$/.test(resultHex)) {
    throw new UniswapV3VenueError(
      "quoter-decode-failed",
      `expected hex result, got "${resultHex}"`,
    );
  }
  const stripped = resultHex.slice(2);
  // 4 × 32 = 128 bytes minimum. Accept extras (some Tenderly
  // forks pad with zeros) — read only the first 128 bytes.
  if (stripped.length < 256) {
    throw new UniswapV3VenueError(
      "quoter-decode-failed",
      `expected ≥ 128 bytes (256 hex chars), got ${stripped.length / 2} bytes`,
      { details: { resultHex } },
    );
  }
  return {
    amountOut: BigInt("0x" + stripped.slice(0, 64)),
    sqrtPriceX96After: BigInt("0x" + stripped.slice(64, 128)),
    initializedTicksCrossed: Number(BigInt("0x" + stripped.slice(128, 192))),
    gasEstimate: BigInt("0x" + stripped.slice(192, 256)),
  };
}

// ─── SwapRouter02.exactInputSingle ─────────────────────────

/**
 * Encode calldata for `exactInputSingle((address tokenIn,
 * address tokenOut, uint24 fee, address recipient, uint256
 * amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96))`.
 *
 * Note: the parameter ORDER differs from QuoterV2 — `fee` comes
 * before `recipient` here (in the SwapRouter02 ABI), whereas
 * `fee` is fourth in QuoterV2's tuple. Easy to get wrong;
 * verify against the on-chain ABI when bumping versions.
 *
 * Layout (4 + 7*32 = 228 bytes calldata, "0x" + 456 hex chars):
 *
 *   selector (4 bytes)
 *   + tokenIn            (32-byte slot)
 *   + tokenOut           (32-byte slot)
 *   + fee                (32-byte slot, uint24 padded)
 *   + recipient          (32-byte slot)
 *   + amountIn           (32-byte slot)
 *   + amountOutMinimum   (32-byte slot)
 *   + sqrtPriceLimitX96  (32-byte slot, uint160 padded)
 */
export function encodeExactInputSingle(params: {
  readonly tokenIn: `0x${string}`;
  readonly tokenOut: `0x${string}`;
  readonly fee: UniswapV3FeeTier;
  readonly recipient: `0x${string}`;
  readonly amountIn: bigint;
  readonly amountOutMinimum: bigint;
  readonly sqrtPriceLimitX96?: bigint;
}): `0x${string}` {
  const tokenIn = padAddress(params.tokenIn);
  const tokenOut = padAddress(params.tokenOut);
  const fee = padUint24(params.fee);
  const recipient = padAddress(params.recipient);
  const amountIn = padUint256(params.amountIn);
  const amountOutMin = padUint256(params.amountOutMinimum);
  const sqrtPriceLimit = padUint160(params.sqrtPriceLimitX96 ?? 0n);

  return (SELECTOR_EXACT_INPUT_SINGLE +
    tokenIn +
    tokenOut +
    fee +
    recipient +
    amountIn +
    amountOutMin +
    sqrtPriceLimit) as `0x${string}`;
}

// ─── ERC-20 approve ────────────────────────────────────────

/**
 * Encode `approve(address spender, uint256 amount)` calldata.
 * Same shape as transfer-solver's `transfer(address,uint256)`
 * encoder; selector differs (`0x095ea7b3` for approve vs
 * `0xa9059cbb` for transfer).
 *
 * Layout: selector + 32-byte spender + 32-byte amount = 68 bytes.
 */
export function encodeErc20Approve(
  spender: `0x${string}`,
  amount: bigint,
): `0x${string}` {
  return (SELECTOR_ERC20_APPROVE +
    padAddress(spender) +
    padUint256(amount)) as `0x${string}`;
}

// ─── ERC-20 allowance (view) ───────────────────────────────

/**
 * Encode `allowance(address owner, address spender)` calldata.
 *
 * Layout: selector + 32-byte owner + 32-byte spender = 68 bytes.
 *
 * Sent via `eth_call` (view, no gas) to check the existing
 * allowance before deciding whether to emit a new approve tx.
 */
export function encodeErc20Allowance(
  owner: `0x${string}`,
  spender: `0x${string}`,
): `0x${string}` {
  return (SELECTOR_ERC20_ALLOWANCE +
    padAddress(owner) +
    padAddress(spender)) as `0x${string}`;
}

/**
 * Decode the result of `allowance()` — a single uint256 in a
 * 32-byte ABI slot.
 *
 * `eth_call` returns "0x" when the call to a non-contract
 * address succeeds vacuously; we treat that (and any < 64-char
 * payload) as "no allowance" (0n) rather than throwing.
 */
export function decodeErc20AllowanceResult(
  resultHex: `0x${string}`,
): bigint {
  if (!/^0x[0-9a-fA-F]*$/.test(resultHex)) {
    throw new UniswapV3VenueError(
      "quoter-decode-failed",
      `expected hex result, got "${resultHex}"`,
    );
  }
  const stripped = resultHex.slice(2);
  if (stripped.length === 0) return 0n;
  if (stripped.length < 64) {
    // Some test transports / older contracts return shorter
    // payloads. Pad-zero is the safe assumption.
    return 0n;
  }
  return BigInt("0x" + stripped.slice(0, 64));
}

// ─── Multi-hop path encoding (PR #106) ─────────────────────

/**
 * Encode a Uniswap v3 multi-hop path into the contract's compact
 * bytes representation:
 *
 *   `tokens[0] (20 bytes) || fees[0] (3 bytes) ||
 *    tokens[1] (20 bytes) || fees[1] (3 bytes) || ...
 *    || tokens[N] (20 bytes)`
 *
 * For N hops: `(N+1) * 20 + N * 3 = 23N + 20` bytes total.
 * Examples:
 *   - 2-hop USDC → WETH → DAI: `20 + 3 + 20 + 3 + 20` = 66 bytes
 *   - 3-hop A → B → C → D:     `20 + 3 + 20 + 3 + 20 + 3 + 20` = 89 bytes
 *
 * The compact (no padding) format is intentional — Uniswap's
 * pool contracts use inline assembly with fixed byte offsets
 * (20-byte address + 3-byte fee). A naive 32-byte-padded
 * encoding would waste ~40% of calldata.
 *
 * Validation:
 *   - `tokens.length >= 2` (otherwise it's not a path, it's a token)
 *   - `fees.length === tokens.length - 1` (one fee tier per hop)
 *   - every token is a valid 20-byte address
 *   - every fee is a valid uint24
 */
export function encodePath(path: {
  readonly tokens: ReadonlyArray<`0x${string}`>;
  readonly fees: ReadonlyArray<UniswapV3FeeTier | number>;
}): `0x${string}` {
  const { tokens, fees } = path;
  if (tokens.length < 2) {
    throw new UniswapV3VenueError(
      "invalid-asset-address",
      `multi-hop path requires at least 2 tokens, got ${tokens.length}`,
    );
  }
  if (fees.length !== tokens.length - 1) {
    throw new UniswapV3VenueError(
      "invalid-asset-address",
      `multi-hop path has ${tokens.length} tokens but ${fees.length} fees; need ${tokens.length - 1}`,
    );
  }

  let hex = "";
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) {
      throw new UniswapV3VenueError(
        "invalid-asset-address",
        `multi-hop path tokens[${i}] is not a 20-byte hex address: "${token}"`,
      );
    }
    hex += token.slice(2).toLowerCase();
    if (i < fees.length) {
      const fee = fees[i];
      if (!Number.isInteger(fee) || fee < 0 || fee > 0xff_ff_ff) {
        throw new UniswapV3VenueError(
          "invalid-asset-address",
          `multi-hop path fees[${i}] is not a valid uint24, got ${String(fee)}`,
        );
      }
      // 3 bytes = 6 hex chars, big-endian.
      hex += fee.toString(16).padStart(6, "0");
    }
  }
  return ("0x" + hex) as `0x${string}`;
}

// ─── QuoterV2.quoteExactInput (multi-hop) ──────────────────

/**
 * Encode calldata for `quoteExactInput(bytes path, uint256 amountIn)`.
 *
 * The function takes a dynamic `bytes` and a static `uint256`.
 * Standard ABI dynamic-tuple encoding rules: head section has
 * `offset_to_path || amountIn`; tail section has
 * `length(path) || path padded to 32-byte boundary`.
 *
 * Layout (4 + 2*32 + 32 + ceil(pathLen/32)*32 bytes):
 *
 *   selector (4 bytes)
 *   + offset_to_path = 0x40 (32-byte slot, points to byte 64)
 *   + amountIn (32-byte slot)
 *   + length(path) (32-byte slot)
 *   + path bytes, right-padded with zeros to next 32-byte boundary
 */
export function encodeQuoteExactInput(params: {
  readonly path: `0x${string}`;
  readonly amountIn: bigint;
}): `0x${string}` {
  const pathHex = params.path.startsWith("0x")
    ? params.path.slice(2)
    : params.path;
  if (pathHex.length === 0 || pathHex.length % 2 !== 0) {
    throw new UniswapV3VenueError(
      "invalid-asset-address",
      `path must be even-length hex, got ${pathHex.length} hex chars`,
    );
  }
  const pathBytes = pathHex.length / 2;
  const offsetToPath = padUint256(64n); // 64 = 0x40 bytes
  const amountIn = padUint256(params.amountIn);
  const pathLength = padUint256(BigInt(pathBytes));
  const pathPadded = padBytesToWords(pathHex);

  return (SELECTOR_QUOTE_EXACT_INPUT +
    offsetToPath +
    amountIn +
    pathLength +
    pathPadded) as `0x${string}`;
}

/**
 * Decode the result of `quoteExactInput(...)`.
 *
 * The return shape is:
 *   `(uint256 amountOut, uint160[] sqrtPriceX96AfterList,
 *     uint32[] initializedTicksCrossedList, uint256 gasEstimate)`
 *
 * Head section (4 slots = 128 bytes):
 *   - amountOut (32 bytes)
 *   - offset to sqrtPriceX96AfterList (32 bytes)
 *   - offset to initializedTicksCrossedList (32 bytes)
 *   - gasEstimate (32 bytes)
 *
 * The two arrays sit in the tail section. For our purposes, we
 * only need `amountOut` and `gasEstimate`. The arrays are
 * skipped — multi-hop's "sqrtPriceX96After" is per-pool and
 * doesn't compose into a single venue-data scalar; consumers
 * wanting per-pool prices fetch them separately via QuoterV2.
 */
export function decodeQuoteExactInputResult(
  resultHex: `0x${string}`,
): {
  readonly amountOut: bigint;
  readonly gasEstimate: bigint;
} {
  if (!/^0x[0-9a-fA-F]+$/.test(resultHex)) {
    throw new UniswapV3VenueError(
      "quoter-decode-failed",
      `expected hex result, got "${resultHex}"`,
    );
  }
  const stripped = resultHex.slice(2);
  // Need at least 4 head slots = 128 bytes = 256 hex chars.
  if (stripped.length < 256) {
    throw new UniswapV3VenueError(
      "quoter-decode-failed",
      `expected ≥ 128 bytes (256 hex chars) for multi-hop quote head, got ${stripped.length / 2} bytes`,
      { details: { resultHex } },
    );
  }
  return {
    amountOut: BigInt("0x" + stripped.slice(0, 64)),
    gasEstimate: BigInt("0x" + stripped.slice(192, 256)),
  };
}

// ─── SwapRouter02.exactInput (multi-hop) ───────────────────

/**
 * Encode calldata for
 * `exactInput((bytes path, address recipient, uint256 amountIn,
 *              uint256 amountOutMinimum))`.
 *
 * The single argument is a struct with one dynamic field
 * (`bytes path`); per ABI rules for dynamic tuples passed to
 * functions, the calldata layout is:
 *
 *   selector (4 bytes)
 *   + outer_offset = 0x20 (32-byte slot — top-level args are
 *     themselves a tuple, and the inner tuple is dynamic)
 *   + inner_head[0] = offset_to_path = 0x80 from start of inner
 *     tuple (32-byte slot, = 4 inner-head slots)
 *   + inner_head[1] = recipient (32-byte slot)
 *   + inner_head[2] = amountIn (32-byte slot)
 *   + inner_head[3] = amountOutMinimum (32-byte slot)
 *   + path_length (32-byte slot)
 *   + path bytes padded to 32-byte boundary
 *
 * Total fixed prefix: 4 + 6*32 = 196 bytes; then the path data.
 *
 * **Don't confuse with `exactInputSingle` calldata layout** —
 * single-hop has no outer offset (struct is fully static).
 * Multi-hop ALWAYS has the 0x20 outer offset because `bytes`
 * makes the inner tuple dynamic.
 */
export function encodeExactInput(params: {
  readonly path: `0x${string}`;
  readonly recipient: `0x${string}`;
  readonly amountIn: bigint;
  readonly amountOutMinimum: bigint;
}): `0x${string}` {
  const pathHex = params.path.startsWith("0x")
    ? params.path.slice(2)
    : params.path;
  if (pathHex.length === 0 || pathHex.length % 2 !== 0) {
    throw new UniswapV3VenueError(
      "invalid-asset-address",
      `path must be even-length hex, got ${pathHex.length} hex chars`,
    );
  }
  const pathBytes = pathHex.length / 2;
  const outerOffset = padUint256(32n); // 0x20 — past this slot
  const innerOffsetToPath = padUint256(128n); // 0x80 from start of inner tuple
  const recipient = padAddress(params.recipient);
  const amountIn = padUint256(params.amountIn);
  const amountOutMin = padUint256(params.amountOutMinimum);
  const pathLength = padUint256(BigInt(pathBytes));
  const pathPadded = padBytesToWords(pathHex);

  return (SELECTOR_EXACT_INPUT +
    outerOffset +
    innerOffsetToPath +
    recipient +
    amountIn +
    amountOutMin +
    pathLength +
    pathPadded) as `0x${string}`;
}

// ─── Internal: pad a hex string to a multiple of 32 bytes ──

/**
 * Right-pad a raw hex string (no `0x` prefix) with zeros until
 * its length is a multiple of 64 hex chars (= 32 bytes).
 *
 * Used for ABI-encoded `bytes` data, which must occupy whole
 * 32-byte words. Unlike numeric padding (left-pad with zeros),
 * `bytes` is right-padded.
 */
function padBytesToWords(hex: string): string {
  const remainder = hex.length % 64;
  if (remainder === 0) return hex;
  return hex + "0".repeat(64 - remainder);
}

// ─── Multi-hop path reversal (PR #109) ─────────────────────

/**
 * Reverse a `MultiHopPath` for use in the opposite direction
 * (PR #109). Returns a new path with both `tokens` and `fees`
 * reversed; the original is not mutated.
 *
 * Use this when the same liquidity path applies symmetrically:
 * Uniswap v3 pools serve both directions of a pair at the same
 * fee tier (a USDC/WETH 0.05% pool handles both USDC→WETH and
 * WETH→USDC swaps). For the path `USDC → WETH(500) → DAI(3000)`
 * the reverse `DAI → WETH(3000) → USDC(500)` traverses the same
 * two pools in opposite order.
 *
 * The venue's `multiHopPathFor` calls this automatically when
 * a path is found in the reverse direction of the lookup.
 * Operators wanting asymmetric paths (different intermediate
 * tokens for forward vs reverse routing) register direction-
 * specific entries in `multiHopPaths`; the explicit registration
 * takes precedence over auto-reverse.
 *
 * @example
 * ```ts
 * const usdcDai: MultiHopPath = {
 *   tokens: [USDC, WETH, DAI],
 *   fees: [500, 3000],
 * };
 * const daiUsdc = reversePath(usdcDai);
 * // daiUsdc.tokens === [DAI, WETH, USDC]
 * // daiUsdc.fees   === [3000, 500]
 * ```
 */
export function reversePath(path: {
  readonly tokens: ReadonlyArray<`0x${string}`>;
  readonly fees: ReadonlyArray<UniswapV3FeeTier | number>;
}): {
  readonly tokens: ReadonlyArray<`0x${string}`>;
  readonly fees: ReadonlyArray<UniswapV3FeeTier | number>;
} {
  return {
    tokens: [...path.tokens].reverse(),
    fees: [...path.fees].reverse(),
  };
}
