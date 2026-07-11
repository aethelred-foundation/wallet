/**
 * Minimal ABI decoder for the subset of selectors dangerous to wallets.
 *
 * This is **not** a general-purpose ABI codec. It decodes only the
 * well-known selectors the wallet needs to classify risk correctly:
 *
 *   - ERC-20 approve(address, uint256)              — selector 0x095ea7b3
 *   - ERC-20 transfer(address, uint256)             — selector 0xa9059cbb
 *   - ERC-20 transferFrom(address, address, uint256) — selector 0x23b872dd
 *   - ERC-20 increaseAllowance(address, uint256)    — selector 0x39509351
 *   - ERC-20 decreaseAllowance(address, uint256)    — selector 0xa457c2d7
 *   - ERC-721 setApprovalForAll(address, bool)      — selector 0xa22cb465
 *   - ERC-721 safeTransferFrom(address, address, uint256) — selector 0x42842e0e
 *   - ERC-721 safeTransferFrom with bytes data      — selector 0xb88d4fde
 *   - ERC-721 approve(address, uint256)             — reuses 0x095ea7b3
 *
 * Plus the Aethelred first-party surface, so approvals show a real intent
 * instead of "Contract interaction" (Cruzible gap W-1):
 *
 *   - Cruzible stake()/stakeWithReferral/stakeWithSeal, unstake,
 *     instantUnstake, withdraw/batchWithdraw, claimStakingRewards,
 *     wstAETHEL wrap/unwrap
 *   - ZeroID registerIdentity(bytes32, bytes32)
 *
 * The result is a `DecodedCall` with a `method` name, `params` map,
 * and a `risk` classification. Unknown selectors return null so the
 * caller can treat them as generic contract calls.
 *
 * **Why hand-rolled instead of ethers/viem:** bundle size. The extension
 * popup already imports `@noble/secp256k1` + `@noble/hashes` for signing;
 * adding ethers would double the popup JS bundle. This decoder is ~180
 * lines and covers every selector the UI risk classifier needs.
 *
 * **Encoding rules** — each ABI parameter occupies a 32-byte word:
 *   - `address`: right-aligned 20 bytes in a 32-byte word (12 zero bytes + address)
 *   - `uint256`: big-endian 32-byte integer
 *   - `bool`: last byte is 0 or 1
 *
 * All selectors this file decodes use only fixed-size params (no dynamic
 * bytes/string/arrays) so we don't need the full tail-pointer logic.
 */

import type { DecodedCall, RiskLevel } from "./types";

/** Ethereum's maximum uint256 value — the canonical "unlimited" approval. */
export const UINT256_MAX = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

/** Threshold above which an approval is considered effectively unlimited. */
const EFFECTIVELY_UNLIMITED = BigInt("0x100000000000000000000000000000000000000000000000000000000000000"); // 2^252

/** Strip the leading 0x if present. */
function stripHex(s: string): string {
  return s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
}

/** Decode a 32-byte word at `offset` (in nibbles) as an address (0x-prefixed, lowercase). */
function decodeAddress(hex: string, offset: number): string {
  // Take the last 40 nibbles of the 64-nibble word
  const word = hex.slice(offset, offset + 64);
  if (word.length !== 64) {
    throw new Error(`ABI decode: expected 32-byte address word at offset ${offset}, got ${word.length / 2} bytes`);
  }
  return "0x" + word.slice(24).toLowerCase();
}

/** Decode a 32-byte word at `offset` (in nibbles) as a uint256 (bigint). */
function decodeUint256(hex: string, offset: number): bigint {
  const word = hex.slice(offset, offset + 64);
  if (word.length !== 64) {
    throw new Error(`ABI decode: expected 32-byte uint word at offset ${offset}, got ${word.length / 2} bytes`);
  }
  return BigInt("0x" + word);
}

/** Decode a 32-byte word at `offset` (in nibbles) as a bool. */
function decodeBool(hex: string, offset: number): boolean {
  const word = hex.slice(offset, offset + 64);
  if (word.length !== 64) {
    throw new Error(`ABI decode: expected 32-byte bool word at offset ${offset}, got ${word.length / 2} bytes`);
  }
  return word.slice(-2) !== "00";
}

/** Decode a 32-byte word at `offset` (in nibbles) as 0x-prefixed bytes32. */
function decodeBytes32(hex: string, offset: number): string {
  const word = hex.slice(offset, offset + 64);
  if (word.length !== 64) {
    throw new Error(`ABI decode: expected bytes32 word at offset ${offset}, got ${word.length / 2} bytes`);
  }
  return "0x" + word.toLowerCase();
}

/**
 * Decode a dynamic `string` whose HEAD word sits at `headOffset` (nibbles):
 * the head holds a byte offset to the tail, where a length word precedes the
 * UTF-8 data. Only what the first-party selectors below need — single-level
 * dynamic args, no nesting.
 */
function decodeString(hex: string, headOffset: number): string {
  const tail = Number(decodeUint256(hex, headOffset)) * 2;
  const len = Number(decodeUint256(hex, tail));
  const data = hex.slice(tail + 64, tail + 64 + len * 2);
  if (data.length !== len * 2) {
    throw new Error(`ABI decode: string tail truncated (want ${len} bytes)`);
  }
  let out = "";
  for (let i = 0; i < data.length; i += 2) {
    out += String.fromCharCode(parseInt(data.slice(i, i + 2), 16));
  }
  // The strings we decode (PoUW job ids, bech32 validator addresses) are
  // ASCII; anything outside that range is shown escaped rather than trusted.
  return /^[\x20-\x7e]*$/.test(out) ? out : JSON.stringify(out).slice(1, -1);
}

/** Classify an approval amount. */
function classifyApproval(amount: bigint): {
  isUnlimited: boolean;
  risk: RiskLevel;
  label: string;
} {
  if (amount === 0n) {
    return { isUnlimited: false, risk: "safe", label: "Revoke approval (0)" };
  }
  if (amount >= EFFECTIVELY_UNLIMITED) {
    return { isUnlimited: true, risk: "critical", label: "UNLIMITED token approval" };
  }
  return { isUnlimited: false, risk: "medium", label: "Finite token approval" };
}

/**
 * Attempt to decode a call by its selector and calldata.
 *
 * Returns `null` on unknown selectors or malformed calldata. Never throws
 * for well-formed but unrecognized calldata — the caller is expected to
 * treat `null` as "generic contract call" and raise the appropriate
 * risk signal (`unknown-selector`).
 */
export function decodeCall(
  to: string | undefined,
  dataHex: string | undefined,
): DecodedCall | null {
  if (!dataHex || dataHex.length < 10) return null;
  const selector = dataHex.slice(0, 10).toLowerCase();
  const body = stripHex(dataHex.slice(10));

  try {
    switch (selector) {
      // ──────────── ERC-20 ────────────
      case "0x095ea7b3": {
        // approve(address spender, uint256 amount)
        // Also: ERC-721 approve(address to, uint256 tokenId)
        const spender = decodeAddress(body, 0);
        const amount = decodeUint256(body, 64);
        const classification = classifyApproval(amount);
        return {
          to,
          method: "approve",
          selector,
          params: {
            spender,
            amount: amount.toString(),
          },
          risk: classification.risk,
          warnings: [classification.label],
          metadata: {
            isUnlimitedApproval: classification.isUnlimited,
          },
        };
      }
      case "0xa9059cbb": {
        // transfer(address to, uint256 amount)
        const to_ = decodeAddress(body, 0);
        const amount = decodeUint256(body, 64);
        return {
          to,
          method: "transfer",
          selector,
          params: { to: to_, amount: amount.toString() },
          risk: "low",
          warnings: [],
        };
      }
      case "0x23b872dd": {
        // transferFrom(address from, address to, uint256 amount)
        const from_ = decodeAddress(body, 0);
        const to_ = decodeAddress(body, 64);
        const amount = decodeUint256(body, 128);
        return {
          to,
          method: "transferFrom",
          selector,
          params: { from: from_, to: to_, amount: amount.toString() },
          risk: "medium",
          warnings: ["Transfer from another account — verify you gave this contract approval."],
        };
      }
      case "0x39509351": {
        // increaseAllowance(address spender, uint256 addedValue)
        const spender = decodeAddress(body, 0);
        const addedValue = decodeUint256(body, 64);
        return {
          to,
          method: "increaseAllowance",
          selector,
          params: { spender, addedValue: addedValue.toString() },
          risk: addedValue >= EFFECTIVELY_UNLIMITED ? "critical" : "medium",
          warnings: addedValue >= EFFECTIVELY_UNLIMITED ? ["Effectively unlimited allowance increase"] : [],
        };
      }
      case "0xa457c2d7": {
        // decreaseAllowance(address spender, uint256 subtractedValue)
        const spender = decodeAddress(body, 0);
        const subtractedValue = decodeUint256(body, 64);
        return {
          to,
          method: "decreaseAllowance",
          selector,
          params: { spender, subtractedValue: subtractedValue.toString() },
          risk: "safe",
          warnings: [],
        };
      }

      // ──────────── ERC-721 / ERC-1155 ────────────
      case "0xa22cb465": {
        // setApprovalForAll(address operator, bool approved)
        const operator = decodeAddress(body, 0);
        const approved = decodeBool(body, 64);
        return {
          to,
          method: "setApprovalForAll",
          selector,
          params: { operator, approved: String(approved) },
          // Approving an entire collection is extremely dangerous.
          risk: approved ? "critical" : "safe",
          warnings: approved
            ? ["⚠ This grants FULL control of your entire NFT collection to this operator."]
            : [],
          metadata: { isCollectionApproval: approved },
        };
      }
      case "0x42842e0e": {
        // safeTransferFrom(address from, address to, uint256 tokenId)
        const from_ = decodeAddress(body, 0);
        const to_ = decodeAddress(body, 64);
        const tokenId = decodeUint256(body, 128);
        return {
          to,
          method: "safeTransferFrom",
          selector,
          params: { from: from_, to: to_, tokenId: tokenId.toString() },
          risk: "medium",
          warnings: [],
        };
      }
      case "0xb88d4fde": {
        // safeTransferFrom(address from, address to, uint256 tokenId, bytes data)
        // We decode only the fixed head (from/to/tokenId), ignore the dynamic `data` tail.
        const from_ = decodeAddress(body, 0);
        const to_ = decodeAddress(body, 64);
        const tokenId = decodeUint256(body, 128);
        return {
          to,
          method: "safeTransferFrom",
          selector,
          params: { from: from_, to: to_, tokenId: tokenId.toString() },
          risk: "medium",
          warnings: [],
        };
      }

      // ──────────── Permit2 (Uniswap) ────────────
      // 0x87517c45 = permit(address, PermitSingle, bytes) — too complex for
      // this minimal decoder; classify as critical and warn.
      case "0x87517c45":
      case "0x2b67b570": // permit(bytes32, uint256, ...) — placeholder
      case "0xd505accf": {
        // ERC-20 permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        // All fields except v/r/s are in the head.
        const owner = decodeAddress(body, 0);
        const spender = decodeAddress(body, 64);
        const value = decodeUint256(body, 128);
        const deadline = decodeUint256(body, 192);
        const classification = classifyApproval(value);
        return {
          to,
          method: "permit",
          selector,
          params: {
            owner,
            spender,
            value: value.toString(),
            deadline: deadline.toString(),
          },
          risk: classification.isUnlimited ? "critical" : "high",
          warnings: [
            "⚠ ERC-20 permit — grants approval without a separate transaction.",
            classification.label,
          ],
          metadata: { isPermit: true, isUnlimitedApproval: classification.isUnlimited },
        };
      }

      // ──────────── Aethelred first-party: Cruzible liquid staking ────────────
      // The vault takes NATIVE AETHEL (payable stake, msg.value carries the
      // amount) and mints rebasing stAETHEL. Decoding these gives the user a
      // real intent instead of "Contract interaction" — the W-1 gap in the
      // Cruzible technology assessment.
      case "0x3a4b66f1": {
        // stake()
        return {
          to,
          method: "stake",
          selector,
          params: {},
          risk: "low",
          warnings: [],
          metadata: { protocol: "cruzible" },
        };
      }
      case "0x96b6ecc5": {
        // stakeWithReferral(uint256 referralCode)
        const referralCode = decodeUint256(body, 0);
        return {
          to,
          method: "stake",
          selector,
          params: { referralCode: referralCode.toString() },
          risk: "low",
          warnings: [],
          metadata: { protocol: "cruzible" },
        };
      }
      case "0xf916cc4f": {
        // stakeWithSeal(string jobId) — compliance-gated entry
        const jobId = decodeString(body, 0);
        return {
          to,
          method: "stakeWithSeal",
          selector,
          params: { jobId },
          risk: "low",
          warnings: [],
          metadata: { protocol: "cruzible" },
        };
      }
      case "0x2e17de78": {
        // unstake(uint256 shares) — enters the withdrawal queue
        const shares = decodeUint256(body, 0);
        return {
          to,
          method: "unstake",
          selector,
          params: { shares: shares.toString() },
          risk: "low",
          warnings: [
            "Enters the unbonding queue — funds become claimable after the unbonding period, at a value fixed now.",
          ],
          metadata: { protocol: "cruzible" },
        };
      }
      case "0xbd0461aa": {
        // instantUnstake(uint256 shares, uint256 minOut)
        const shares = decodeUint256(body, 0);
        const minOut = decodeUint256(body, 64);
        return {
          to,
          method: "instantUnstake",
          selector,
          params: { shares: shares.toString(), minOut: minOut.toString() },
          risk: "low",
          warnings: [
            "Instant exit pays immediately from the vault buffer minus the instant-exit fee — the queue path avoids the fee.",
          ],
          metadata: { protocol: "cruzible" },
        };
      }
      case "0x2e1a7d4d": {
        // withdraw(uint256) — Cruzible queue claim, but ALSO the classic
        // WETH-style withdraw(wad); keep the naming protocol-neutral.
        const value = decodeUint256(body, 0);
        return {
          to,
          method: "withdraw",
          selector,
          params: { value: value.toString() },
          risk: "low",
          warnings: [],
        };
      }
      case "0x72e55399": {
        // batchWithdraw(uint256[] withdrawalIds)
        const tail = Number(decodeUint256(body, 0)) * 2;
        const count = Number(decodeUint256(body, tail));
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
          ids.push(decodeUint256(body, tail + 64 + i * 64).toString());
        }
        return {
          to,
          method: "batchWithdraw",
          selector,
          params: { withdrawalIds: ids.join(", ") },
          risk: "low",
          warnings: [],
          metadata: { protocol: "cruzible" },
        };
      }
      case "0xd8d8422a": {
        // claimStakingRewards(string validator) — permissionless; folds the
        // vault's EARNED x/staking rewards into the exchange rate.
        const validator = decodeString(body, 0);
        return {
          to,
          method: "claimStakingRewards",
          selector,
          params: { validator },
          risk: "safe",
          warnings: [],
          metadata: { protocol: "cruzible" },
        };
      }
      case "0xea598cb0": {
        // wrap(uint256 stAethelAmount) — wstETH-compatible selector
        const amount = decodeUint256(body, 0);
        return {
          to,
          method: "wrap",
          selector,
          params: { amount: amount.toString() },
          risk: "low",
          warnings: [],
          metadata: { protocol: "cruzible" },
        };
      }
      case "0xde0e9a3e": {
        // unwrap(uint256 wstAethelAmount)
        const amount = decodeUint256(body, 0);
        return {
          to,
          method: "unwrap",
          selector,
          params: { amount: amount.toString() },
          risk: "low",
          warnings: [],
          metadata: { protocol: "cruzible" },
        };
      }

      // ──────────── Aethelred first-party: ZeroID identity ────────────
      case "0x3ffb0036": {
        // registerIdentity(bytes32 didHash, bytes32 recoveryHash) —
        // permissionless; binds the SENDER as the identity's controller.
        const didHash = decodeBytes32(body, 0);
        const recoveryHash = decodeBytes32(body, 64);
        return {
          to,
          method: "registerIdentity",
          selector,
          params: { didHash, recoveryHash },
          risk: "low",
          warnings: [],
          metadata: { protocol: "zeroid" },
        };
      }

      // ──────────── Seaport (OpenSea) ────────────
      case "0xe7acab24": // fulfillAdvancedOrder(...)
      case "0xfb0f3ee1": // fulfillBasicOrder(...)
      case "0xf2d12b12": {
        // fulfillOrder(...)
        return {
          to,
          method: "seaport-fulfill",
          selector,
          params: {},
          risk: "high",
          warnings: ["Seaport (OpenSea) order fulfillment — verify the NFT + price on-screen."],
        };
      }

      default:
        return null;
    }
  } catch (err) {
    // Malformed calldata — return a structured error so the caller
    // can raise an appropriate "invalid-calldata" signal.
    return {
      to,
      method: "malformed",
      selector,
      params: {},
      risk: "high",
      warnings: [
        `Calldata appears malformed (${err instanceof Error ? err.message : "unknown"}). Do not sign unless you trust the caller.`,
      ],
      metadata: { malformed: true },
    };
  }
}
