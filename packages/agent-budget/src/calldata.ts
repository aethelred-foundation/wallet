/**
 * Calldata encoders / decoders for AgentBudget.
 *
 * Every function gets a pair:
 *   - `encodeX(args)` → `0x`-prefixed calldata ready for `eth_call`
 *     or a transaction `data` field.
 *   - `decodeX(return)` → typed result from an eth_call return blob.
 *
 * We avoid taking a dependency on viem / ethers so the package is
 * lean, works inside the browser-extension bundle, and matches the
 * sibling `@aethelred/wallet-smart-account` pattern. Every primitive
 * (address / uint256 / uint64 / bool) is encoded in the canonical
 * Solidity ABI layout (left-padded 32-byte words) by small helpers
 * at the bottom of this file.
 */

import { AgentBudgetError } from "./errors";
import {
  SELECTOR_CAN_SPEND,
  SELECTOR_CREATE_BUDGET,
  SELECTOR_GRANT_SESSION,
  SELECTOR_REMAINING_IN_WINDOW,
  SELECTOR_REVOKE_BUDGET,
  SELECTOR_REVOKE_SESSION,
  SELECTOR_SPEND,
  SELECTOR_UPDATE_CAPS,
} from "./abi";

// ─── Write-path encoders ───────────────────────────────────────

export interface CreateBudgetArgs {
  readonly asset: `0x${string}`;
  readonly dailyCap: bigint;
  readonly perTxCap: bigint;
  readonly windowSeconds: bigint;
}
export function encodeCreateBudget(args: CreateBudgetArgs): `0x${string}` {
  if (args.windowSeconds <= 0n) {
    throw new AgentBudgetError("invalid-window", "windowSeconds must be > 0");
  }
  return concatHex(
    SELECTOR_CREATE_BUDGET,
    encAddr(args.asset),
    encU256(args.dailyCap),
    encU256(args.perTxCap),
    encU256(args.windowSeconds), // uint64 in the ABI is right-padded to a word
  );
}

export interface UpdateCapsArgs {
  readonly budgetId: bigint;
  readonly dailyCap: bigint;
  readonly perTxCap: bigint;
}
export function encodeUpdateCaps(args: UpdateCapsArgs): `0x${string}` {
  return concatHex(
    SELECTOR_UPDATE_CAPS,
    encU256(args.budgetId),
    encU256(args.dailyCap),
    encU256(args.perTxCap),
  );
}

export interface RevokeBudgetArgs {
  readonly budgetId: bigint;
}
export function encodeRevokeBudget(args: RevokeBudgetArgs): `0x${string}` {
  return concatHex(SELECTOR_REVOKE_BUDGET, encU256(args.budgetId));
}

export interface GrantSessionArgs {
  readonly budgetId: bigint;
  readonly sessionKey: `0x${string}`;
  readonly expiresAt: bigint;
  readonly perCallCap: bigint;
}
export function encodeGrantSession(args: GrantSessionArgs): `0x${string}` {
  return concatHex(
    SELECTOR_GRANT_SESSION,
    encU256(args.budgetId),
    encAddr(args.sessionKey),
    encU256(args.expiresAt),
    encU256(args.perCallCap),
  );
}

export interface RevokeSessionArgs {
  readonly sessionKey: `0x${string}`;
}
export function encodeRevokeSession(args: RevokeSessionArgs): `0x${string}` {
  return concatHex(SELECTOR_REVOKE_SESSION, encAddr(args.sessionKey));
}

export interface SpendArgs {
  readonly sessionKey: `0x${string}`;
  readonly amount: bigint;
  readonly to: `0x${string}`;
}
export function encodeSpend(args: SpendArgs): `0x${string}` {
  if (args.amount === 0n) {
    throw new AgentBudgetError("zero-amount", "spend amount must be > 0");
  }
  return concatHex(
    SELECTOR_SPEND,
    encAddr(args.sessionKey),
    encU256(args.amount),
    encAddr(args.to),
  );
}

// ─── View encoders ─────────────────────────────────────────────

export function encodeRemainingInWindow(budgetId: bigint): `0x${string}` {
  return concatHex(SELECTOR_REMAINING_IN_WINDOW, encU256(budgetId));
}

export function encodeCanSpend(sessionKey: `0x${string}`, amount: bigint): `0x${string}` {
  return concatHex(SELECTOR_CAN_SPEND, encAddr(sessionKey), encU256(amount));
}

// ─── Decoders (views) ──────────────────────────────────────────

/** `remainingInWindow` returns `uint256`. */
export function decodeUint256(ret: `0x${string}`): bigint {
  const bytes = stripHexLE(ret, 32);
  return bytesBEToBigInt(bytes);
}

/** `canSpend` returns `(bool, uint8)` — two 32-byte words. */
export function decodeCanSpend(ret: `0x${string}`): { ok: boolean; reasonByte: number } {
  const raw = hexToBytes(ret);
  if (raw.length < 64) {
    throw new AgentBudgetError(
      "provider-call-failed",
      `canSpend return too short: expected 64 bytes, got ${raw.length}`,
    );
  }
  const okWord = raw.slice(0, 32);
  const reasonWord = raw.slice(32, 64);
  // The low byte of each 32-byte word is the payload.
  const ok = okWord[31] === 1;
  const reasonByte = reasonWord[31];
  return { ok, reasonByte };
}

// ─── Log decoders ──────────────────────────────────────────────

/** Helpers used by `client.parseLogs`. Exported for unit-testability. */

export function decodeIndexedAddress(topic: `0x${string}`): `0x${string}` {
  // An indexed address is left-padded in a 32-byte topic: the 20-byte
  // address is the last 20 bytes. topicHex length is 66 (0x + 64).
  if (topic.length !== 66) {
    throw new AgentBudgetError(
      "calldata-encode-failed",
      `expected 32-byte topic, got length ${topic.length}`,
    );
  }
  return ("0x" + topic.slice(26)) as `0x${string}`;
}

export function decodeIndexedUint256(topic: `0x${string}`): bigint {
  return bytesBEToBigInt(hexToBytes(topic));
}

/** Split a non-indexed data blob into 32-byte words (bigint-decoded). */
export function decodeDataWords(data: `0x${string}`): ReadonlyArray<bigint> {
  const bytes = hexToBytes(data);
  const words: bigint[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32) {
    words.push(bytesBEToBigInt(bytes.slice(offset, offset + 32)));
  }
  return words;
}

// ─── Primitive helpers ─────────────────────────────────────────

function concatHex(...parts: ReadonlyArray<`0x${string}`>): `0x${string}` {
  let out = "0x";
  for (const p of parts) out += p.slice(2);
  return out as `0x${string}`;
}

function encAddr(addr: `0x${string}`): `0x${string}` {
  const bytes = hexToBytes(addr);
  if (bytes.length !== 20) {
    throw new AgentBudgetError(
      "calldata-encode-failed",
      `address must be 20 bytes, got ${bytes.length}: ${addr}`,
    );
  }
  return ("0x" + "0".repeat(24) + addr.slice(2).toLowerCase()) as `0x${string}`;
}

function encU256(value: bigint): `0x${string}` {
  if (value < 0n) {
    throw new AgentBudgetError("calldata-encode-failed", `uint256 cannot be negative: ${value}`);
  }
  if (value >> 256n !== 0n) {
    throw new AgentBudgetError(
      "calldata-encode-failed",
      `value ${value} does not fit in 256 bits`,
    );
  }
  let hex = value.toString(16);
  if (hex.length > 64) {
    throw new AgentBudgetError(
      "calldata-encode-failed",
      `uint256 hex overflow: ${hex}`,
    );
  }
  return ("0x" + hex.padStart(64, "0")) as `0x${string}`;
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (s.length % 2 !== 0) {
    throw new AgentBudgetError(
      "calldata-encode-failed",
      `odd-length hex: ${hex.slice(0, 18)}...`,
    );
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function stripHexLE(ret: `0x${string}`, expectedBytes: number): Uint8Array {
  const bytes = hexToBytes(ret);
  if (bytes.length < expectedBytes) {
    throw new AgentBudgetError(
      "provider-call-failed",
      `eth_call return too short: expected ≥${expectedBytes} bytes, got ${bytes.length}`,
    );
  }
  return bytes.slice(0, expectedBytes);
}

function bytesBEToBigInt(bytes: Uint8Array): bigint {
  let out = 0n;
  for (const b of bytes) out = (out << 8n) | BigInt(b);
  return out;
}
