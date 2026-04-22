/**
 * ═══════════════════════════════════════════════════════════════════════
 * Crypto micro-benchmarks — @aethelred/wallet-core
 * ═══════════════════════════════════════════════════════════════════════
 *
 * These benchmarks cover the four hottest primitives in the signing
 * pipeline:
 *
 *   1. EIP-1559 transaction signing throughput
 *   2. secp256k1 keypair generation
 *   3. keccak256 hashing of a 1 KB payload
 *   4. RLP encoding of a typical transaction
 *
 * Each `bench` is annotated with a target (the steady-state number we
 * want on a modern developer laptop — 2022+ Apple Silicon or equivalent)
 * and a fail threshold (the "CI must fail" number, generally 3x slower
 * than the target to absorb cold-CPU noise on shared GitHub runners).
 *
 * Results are collected by `vitest bench --run` and appended to
 * `docs/perf/bench-history.jsonl` by `.github/workflows/perf.yml`. Once
 * we have seven days of runs the regression detector switches from
 * "fail if target unmet" to "fail if >20% slower than rolling p50".
 *
 * How to run:
 *   npm run bench                      # root — runs every bench file
 *   npx vitest bench --run packages/core/bench/signer.bench.ts
 *
 * Owner: wallet-core team. See docs/perf/SLO.md §3.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { bench, describe } from "vitest";
import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  buildUnsignedEip1559Tx,
  buildUnsignedEip1559TxBytes,
  assembleSignedEip1559Tx,
  type UnsignedEip1559Tx,
} from "../src/transaction";
import { rlpEncode } from "../src/rlp";
import "../src/crypto-bootstrap";

/* ─── Shared fixtures ─────────────────────────────────────────────── */

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Deterministic 32-byte test key — NOT for production use. */
const TEST_PRIVATE_KEY = hexToBytes(
  "4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318",
);

/** Canonical 20-byte zero-prefixed recipient used by every tx fixture. */
const TEST_RECIPIENT = hexToBytes("c0ffee254729296a45a3885639ac7e10f9d54979");

/** Typical low-value ETH transfer — the shape most users sign most often. */
const SAMPLE_TX: UnsignedEip1559Tx = {
  chainId: 1n,
  nonce: 42n,
  maxPriorityFeePerGas: 2_000_000_000n, // 2 gwei tip
  maxFeePerGas: 30_000_000_000n, // 30 gwei cap
  gasLimit: 21_000n,
  to: TEST_RECIPIENT,
  value: 1_000_000_000_000_000n, // 0.001 ETH
  data: new Uint8Array(0),
  accessList: [],
};

/**
 * 1 KB buffer for keccak benchmarks. Filled with a non-repeating pseudo
 * pattern so the bench isn't accidentally hashing a compressible constant
 * (which can give misleading throughput on some platforms that SIMD
 * optimize `0x00...`).
 */
const KECCAK_INPUT_1KB = new Uint8Array(1024);
for (let i = 0; i < KECCAK_INPUT_1KB.length; i++) {
  KECCAK_INPUT_1KB[i] = (i * 13 + 7) & 0xff;
}

/* ─── Benchmarks ──────────────────────────────────────────────────── */

describe("@aethelred/wallet-core crypto primitives", () => {
  /**
   * Target: > 500 EIP-1559 signs / sec  (≤ 2 ms per sign)
   * Fail:    < 150 signs / sec          (> 6.7 ms per sign)
   *
   * Each iteration re-builds the unsigned tx digest, derives the signature
   * via `@noble/secp256k1`, and assembles the signed RLP payload — the
   * full end-to-end cost the wallet pays in the happy path. We do NOT
   * pre-cache the digest because that would hide regressions in
   * `buildUnsignedEip1559TxBytes`.
   */
  bench(
    "EIP-1559 tx signing throughput (target ≥ 500 ops/s)",
    () => {
      const digest = buildUnsignedEip1559Tx(SAMPLE_TX);
      const sig = secp256k1.sign(digest, TEST_PRIVATE_KEY, { lowS: true });
      const signature = new Uint8Array(65);
      signature.set(sig.toCompactRawBytes(), 0);
      signature[64] = sig.recovery ?? 0;
      assembleSignedEip1559Tx(SAMPLE_TX, signature);
    },
    { time: 1000 },
  );

  /**
   * Target: > 2k keypairs / sec  (≤ 500 µs)
   * Fail:    < 500 keypairs / sec (> 2 ms)
   *
   * Keygen is on the critical path for every new wallet, every imported
   * account, and every derived slot. We measure the full "random bytes
   * → public key" path (validation + point multiplication), not just
   * the `getPublicKey` step. The 2k/s target is the observed steady
   * state of @noble/secp256k1 v2 on a 2022+ MacBook Air — pure JS with
   * no WASM, so it's deliberately conservative relative to WASM libs.
   */
  bench(
    "secp256k1 keypair generation (target ≥ 2k ops/s)",
    () => {
      const priv = secp256k1.utils.randomPrivateKey();
      secp256k1.getPublicKey(priv, false);
    },
    { time: 1000 },
  );

  /**
   * Target: > 15k keccak256(1 KB) / sec
   * Fail:    < 5k  / sec
   *
   * keccak256 is called on every tx digest and every signed message. The
   * 1 KB input is representative of a medium-size ERC-20 transfer payload
   * (selector + 3 padded args + a 512-byte calldata rider). We use the
   * same `@noble/hashes` entry point as the signer. The 15k/s target is
   * tuned to the pure-JS noble implementation; a WASM alternative would
   * comfortably hit >100k/s but we don't pay that deployment cost today.
   */
  bench(
    "keccak256 of 1 KB input (target ≥ 15k ops/s)",
    () => {
      keccak_256(KECCAK_INPUT_1KB);
    },
    { time: 1000 },
  );

  /**
   * Target: > 100k RLP encodes / sec
   * Fail:    < 20k  / sec
   *
   * RLP encoding is the bottleneck when a user batches many transactions
   * (smart-account flows, Safe queue replays). Each iteration encodes the
   * full EIP-1559 header — chainId, nonce, gas fields, to, value, data,
   * and an empty access list — which is what every normal tx actually
   * looks like.
   */
  bench(
    "RLP encode of typical EIP-1559 tx (target ≥ 100k ops/s)",
    () => {
      buildUnsignedEip1559TxBytes(SAMPLE_TX);
    },
    { time: 1000 },
  );

  /**
   * Target: > 500k rlpEncode(primitive list) / sec
   * Fail:    < 100k / sec
   *
   * Micro-benchmark of the raw encoder alone, without the tx builder
   * wrapper. Useful when `typical EIP-1559 tx` regresses: if this one
   * stays flat, the fault is upstream (the builder); if it drops in
   * lockstep, the fault is in `rlpEncode` itself.
   */
  bench(
    "rlpEncode of small nested list (target ≥ 500k ops/s)",
    () => {
      rlpEncode([
        new Uint8Array([1]),
        new Uint8Array([42]),
        TEST_RECIPIENT,
        new Uint8Array([0x01, 0x02, 0x03, 0x04]),
      ]);
    },
    { time: 1000 },
  );
});
