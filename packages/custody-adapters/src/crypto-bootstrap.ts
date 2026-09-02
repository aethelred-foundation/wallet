/**
 * One-time crypto bootstrap for @noble/secp256k1 v2.
 *
 * Mirrors `packages/core/src/crypto-bootstrap.ts`. Noble secp256k1 v2
 * ships without a sync HMAC; any `secp256k1.sign()` call before this
 * bootstrap throws `hashes.hmacSha256Sync not set`.
 *
 * This module is a side-effect import used by every adapter source that
 * calls `sign()`. It is idempotent — safe to import from more than one
 * entry point.
 */

import * as secp from "@noble/secp256k1";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

if (!secp.etc.hmacSha256Sync) {
  secp.etc.hmacSha256Sync = (key, ...messages) =>
    hmac(sha256, key, secp.etc.concatBytes(...messages));
}

if (!secp.etc.hmacSha256Async) {
  secp.etc.hmacSha256Async = async (key, ...messages) =>
    hmac(sha256, key, secp.etc.concatBytes(...messages));
}
