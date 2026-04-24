/**
 * Calldata encoders + event decoders for the Notary contract.
 *
 * Hand-written ABI helpers — no viem / ethers dep, matching the
 * pattern already used in `@aethelred/wallet-agent-budget` and
 * `@aethelred/wallet-smart-account`. Keeps the package lean and
 * eliminates a transitive-dep audit surface.
 */

import { NotarizationError } from "./errors";
import {
  SELECTOR_ANCHOR,
  SELECTOR_GET_BATCH,
  TOPIC_BATCH_ANCHORED,
} from "./abi";
import type { OnChainBatchRecord, RawLog } from "./types";

// ─── Write-path ──────────────────────────────────────────

export interface AnchorArgs {
  readonly merkleRoot: `0x${string}`;
  /** Number of leaves in the Merkle tree. 32-bit. */
  readonly eventCount: number;
}

export function encodeAnchor(args: AnchorArgs): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(args.merkleRoot)) {
    throw new NotarizationError(
      "batch-malformed",
      `merkleRoot must be 32-byte 0x hex, got length ${args.merkleRoot.length}`,
    );
  }
  if (args.merkleRoot.slice(2) === "0".repeat(64)) {
    throw new NotarizationError("root-zero", "merkleRoot is all-zero");
  }
  if (args.eventCount <= 0) {
    throw new NotarizationError(
      "event-count-zero",
      `eventCount must be > 0, got ${args.eventCount}`,
    );
  }
  if (args.eventCount > 0xffffffff) {
    throw new NotarizationError(
      "batch-malformed",
      `eventCount ${args.eventCount} exceeds uint32 range`,
    );
  }
  return concatHex(
    SELECTOR_ANCHOR,
    encBytes32(args.merkleRoot),
    encUint32(args.eventCount),
  );
}

// ─── View-path ───────────────────────────────────────────

export function encodeGetBatch(batchId: bigint): `0x${string}` {
  return concatHex(SELECTOR_GET_BATCH, encUint256(batchId));
}

// ─── Event decoder ────────────────────────────────────

/**
 * Parse a `BatchAnchored` log into an `OnChainBatchRecord`. Skips
 * logs that aren't BatchAnchored so callers can pass the entire
 * `TxReceipt.logs` blob without filtering first.
 *
 * Returns `null` for non-matching logs.
 *
 *     event BatchAnchored(
 *       uint256 indexed batchId,
 *       address indexed submitter,
 *       bytes32 indexed merkleRoot,
 *       uint64 timestamp,
 *       uint32 eventCount
 *     )
 *
 * Topics: [topic0, batchId, submitter, merkleRoot]
 * Data  : timestamp (uint64 padded to 32) || eventCount (uint32 padded to 32)
 */
export function parseBatchAnchoredLog(
  log: RawLog,
  chainId: number,
): OnChainBatchRecord | null {
  if (log.topics.length < 4) return null;
  if (log.topics[0].toLowerCase() !== TOPIC_BATCH_ANCHORED.toLowerCase()) {
    return null;
  }

  const batchId = decodeUint256(log.topics[1]);
  const submitter = decodeIndexedAddress(log.topics[2]);
  const merkleRoot = log.topics[3]; // already bytes32

  const dataBytes = hexToBytes(log.data);
  if (dataBytes.length < 64) {
    throw new NotarizationError(
      "anchor-receipt-malformed",
      `BatchAnchored data too short: ${dataBytes.length} bytes`,
    );
  }
  const timestamp = bigIntFromBytesBE(dataBytes.slice(0, 32));
  const eventCount = Number(bigIntFromBytesBE(dataBytes.slice(32, 64)));

  return {
    batchId,
    submitter,
    merkleRoot,
    eventCount,
    timestamp,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    chainId,
    contract: log.address,
  };
}

/**
 * Scan a receipt's log set and return the first `BatchAnchored`
 * record. Throws if none is found — a successful anchor tx MUST
 * emit exactly one.
 */
export function extractAnchoredRecord(
  logs: ReadonlyArray<RawLog>,
  chainId: number,
  contract: `0x${string}`,
): OnChainBatchRecord {
  for (const log of logs) {
    if (log.address.toLowerCase() !== contract.toLowerCase()) continue;
    const rec = parseBatchAnchoredLog(log, chainId);
    if (rec) return rec;
  }
  throw new NotarizationError(
    "anchor-receipt-missing",
    `no BatchAnchored log from contract ${contract} in receipt`,
  );
}

// ─── ABI primitives ─────────────────────────────────

function concatHex(...parts: ReadonlyArray<`0x${string}`>): `0x${string}` {
  let out = "0x";
  for (const p of parts) out += p.slice(2);
  return out as `0x${string}`;
}

function encBytes32(hex: `0x${string}`): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new NotarizationError(
      "batch-malformed",
      `bytes32 must be 32 bytes, got ${hex.slice(0, 18)}...`,
    );
  }
  return hex.toLowerCase() as `0x${string}`;
}

function encUint32(value: number): `0x${string}` {
  if (!Number.isInteger(value) || value < 0) {
    throw new NotarizationError(
      "batch-malformed",
      `uint32 must be a non-negative integer, got ${value}`,
    );
  }
  if (value > 0xffffffff) {
    throw new NotarizationError(
      "batch-malformed",
      `value ${value} exceeds uint32 range`,
    );
  }
  const hex = value.toString(16);
  return ("0x" + hex.padStart(64, "0")) as `0x${string}`;
}

function encUint256(value: bigint): `0x${string}` {
  if (value < 0n) {
    throw new NotarizationError("batch-malformed", `negative uint256`);
  }
  if (value >> 256n !== 0n) {
    throw new NotarizationError(
      "batch-malformed",
      `value ${value} does not fit in uint256`,
    );
  }
  const hex = value.toString(16);
  return ("0x" + hex.padStart(64, "0")) as `0x${string}`;
}

function decodeUint256(hex: `0x${string}`): bigint {
  return bigIntFromBytesBE(hexToBytes(hex));
}

function decodeIndexedAddress(topic: `0x${string}`): `0x${string}` {
  if (topic.length !== 66) {
    throw new NotarizationError(
      "anchor-receipt-malformed",
      `indexed address topic must be 32 bytes, got ${topic.length / 2}`,
    );
  }
  return ("0x" + topic.slice(26)) as `0x${string}`;
}

function hexToBytes(hex: `0x${string}` | string): Uint8Array {
  const s = typeof hex === "string" && hex.startsWith("0x") ? hex.slice(2) : String(hex);
  if (s.length % 2 !== 0) {
    throw new NotarizationError(
      "batch-malformed",
      `odd-length hex: ${String(hex).slice(0, 18)}...`,
    );
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bigIntFromBytesBE(bytes: Uint8Array): bigint {
  let out = 0n;
  for (const b of bytes) out = (out << 8n) | BigInt(b);
  return out;
}
