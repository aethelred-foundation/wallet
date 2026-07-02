/**
 * One-time crypto bootstrap for @noble/secp256k1 v2 (chain-cosmos copy).
 *
 * Noble secp256k1 v2 ships WITHOUT a sync HMAC implementation; calling
 * `secp256k1.sign()` before wiring one throws
 * `hashes.hmacSha256Sync not set`. Each wallet package that signs wires it
 * as an import side-effect (see `packages/core/src/crypto-bootstrap.ts` —
 * the pattern is deliberately duplicated per-package so no package relies
 * on a sibling's import order). `src/index.ts` imports this first, so any
 * consumer of `@aethelred/wallet-chain-cosmos` gets the bootstrap.
 */

import * as secp from "@noble/secp256k1";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

// Idempotent — safe to import multiple times. Only the SYNC hook needs
// wiring: noble v2 ships a built-in `etc.hmacSha256Async` default, so an
// async guard here would be dead code (verified under coverage).
if (!secp.etc.hmacSha256Sync) {
  secp.etc.hmacSha256Sync = (key, ...messages) =>
    hmac(sha256, key, secp.etc.concatBytes(...messages));
}

export const cryptoBootstrapped = true;
