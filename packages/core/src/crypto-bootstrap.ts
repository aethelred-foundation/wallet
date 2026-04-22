/**
 * One-time crypto bootstrap for @noble/secp256k1 v2.
 *
 * Noble secp256k1 v2 ships WITHOUT a sync HMAC implementation — the
 * library's philosophy is to keep the surface minimal and let consumers
 * wire in whatever hash function they already have. That means calling
 * `secp256k1.sign()` before this bootstrap runs throws:
 *
 *   Error: hashes.hmacSha256Sync not set
 *
 * This file wires HMAC-SHA256 as a side-effect of being imported. It
 * must be imported (even just for side-effects) before any code that
 * calls `secp256k1.sign`. `packages/core/src/index.ts` imports it as
 * the very first statement so any consumer of `@aethelred/wallet-core`
 * automatically gets the bootstrap.
 *
 * This bug was silently broken in production before tests were written
 * — every signing attempt would crash — because nothing in the repo
 * previously exercised the sign path under test.
 */

import * as secp from "@noble/secp256k1";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

// Idempotent — safe to import multiple times
if (!secp.etc.hmacSha256Sync) {
  secp.etc.hmacSha256Sync = (key, ...messages) =>
    hmac(sha256, key, secp.etc.concatBytes(...messages));
}

// Also wire the async variant in case any consumer awaits it
if (!secp.etc.hmacSha256Async) {
  secp.etc.hmacSha256Async = async (key, ...messages) =>
    hmac(sha256, key, secp.etc.concatBytes(...messages));
}

export const cryptoBootstrapped = true;
