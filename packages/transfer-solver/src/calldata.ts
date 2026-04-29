/**
 * ABI calldata for ERC-20 `transfer(address,uint256)`.
 *
 * Selector is pre-computed as `keccak256("transfer(address,uint256)")[:4]`
 * = `0xa9059cbb`. Same canonical value used in every ERC-20
 * implementation; hard-coded to avoid a runtime keccak for the hot
 * path.
 *
 * We deliberately inline this encoder rather than depending on an
 * ABI library (viem / ethers). The function is ~15 lines + tests,
 * and keeping it zero-dep lets this package ship without bundle
 * cost. Same pattern as `@aethelred/wallet-smart-account` and
 * `@aethelred/wallet-notarization`.
 */

import { TransferSolverError } from "./errors";

/** Pre-computed selector for `transfer(address,uint256)`. */
export const ERC20_TRANSFER_SELECTOR = "0xa9059cbb" as const;

/**
 * Build ERC-20 `transfer(to, amount)` calldata.
 *
 * Layout:
 *   selector (4 bytes)
 *   + to    (32-byte word, address right-aligned)
 *   + amount(32-byte word, big-endian)
 *
 * = 68 bytes of calldata (`0x` + 136 hex chars).
 */
export function encodeErc20Transfer(
  to: `0x${string}`,
  amount: bigint,
): `0x${string}` {
  if (!isValidAddress(to)) {
    throw new TransferSolverError(
      "invalid-recipient-address",
      `recipient must be 0x-prefixed 20-byte hex, got "${to}"`,
    );
  }
  if (amount < 0n) {
    throw new TransferSolverError(
      "invalid-amount",
      `amount must be non-negative, got ${amount}`,
    );
  }
  if (amount >> 256n !== 0n) {
    throw new TransferSolverError(
      "invalid-amount",
      `amount ${amount} does not fit in uint256`,
    );
  }

  const addrHex = to.slice(2).toLowerCase();
  const addrPadded = "0".repeat(24) + addrHex;
  const amountPadded = amount.toString(16).padStart(64, "0");

  return (ERC20_TRANSFER_SELECTOR + addrPadded + amountPadded) as `0x${string}`;
}

/** Address validator — 0x-prefixed 20-byte hex, case-insensitive. */
export function isValidAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** Native-asset sentinel (0x000…000 = native, non-ERC-20 transfer path). */
export const NATIVE_ASSET_SENTINEL =
  "0x0000000000000000000000000000000000000000" as const;

export function isNativeAsset(asset: string): boolean {
  return asset.toLowerCase() === NATIVE_ASSET_SENTINEL.toLowerCase();
}

// ─── balanceOf (ERC-20 read) ───────────────────────────────

/**
 * Pre-computed selector for `balanceOf(address)` — keccak256 of
 * the canonical signature, first 4 bytes. Same canonical value
 * used by every ERC-20 implementation; hard-coded so we don't
 * pay a runtime keccak on the (opt-in) balance pre-flight path.
 */
export const ERC20_BALANCE_OF_SELECTOR = "0x70a08231" as const;

/**
 * Build ERC-20 `balanceOf(owner)` calldata for an `eth_call`-style
 * read.
 *
 * Layout:
 *   selector (4 bytes)
 *   + owner  (32-byte word, address right-aligned)
 *
 * = 36 bytes of calldata (`0x` + 72 hex chars).
 *
 * Operators wire this into a `balancePreflight` callback over
 * their existing `eth_call` transport — see solver config docs.
 */
export function encodeErc20BalanceOf(owner: `0x${string}`): `0x${string}` {
  if (!isValidAddress(owner)) {
    throw new TransferSolverError(
      "invalid-recipient-address",
      `owner must be 0x-prefixed 20-byte hex, got "${owner}"`,
    );
  }
  const addrHex = owner.slice(2).toLowerCase();
  const addrPadded = "0".repeat(24) + addrHex;
  return (ERC20_BALANCE_OF_SELECTOR + addrPadded) as `0x${string}`;
}

/**
 * Decode the result of `eth_call` to an ERC-20 `balanceOf(...)`.
 * The return is a single uint256 (32 bytes / 64 hex chars,
 * 0x-prefixed). Tolerant of providers that strip leading zeros
 * (some return `"0x"` for a zero balance, or short hex like
 * `"0x1f4"`); always pads to 64 hex chars before parsing.
 */
export function decodeErc20BalanceOfResult(result: string): bigint {
  if (typeof result !== "string" || !result.startsWith("0x")) {
    throw new TransferSolverError(
      "invalid-amount",
      `balanceOf result must be a 0x-prefixed hex string, got "${result}"`,
    );
  }
  const hex = result.slice(2);
  if (hex.length === 0) return 0n;
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new TransferSolverError(
      "invalid-amount",
      `balanceOf result has non-hex characters: "${result}"`,
    );
  }
  return BigInt("0x" + hex);
}
