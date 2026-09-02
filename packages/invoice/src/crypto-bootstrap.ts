/** One-time @noble/secp256k1 v2 bootstrap. Mirrors sibling packages. */

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
