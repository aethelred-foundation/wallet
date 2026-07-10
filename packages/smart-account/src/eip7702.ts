/**
 * EIP-7702 — Set Code for EOAs (Pectra, live on Ethereum mainnet).
 *
 * EIP-7702 lets an externally-owned account (EOA) temporarily delegate
 * its code to a smart-contract implementation by signing an
 * *authorization tuple*. Unlike ERC-4337 (which uses a separate
 * contract account), 7702 upgrades the EOA in place — critical for
 * enterprise clients who already hold assets in legacy EOAs and cannot
 * migrate to a new address.
 *
 * This module covers the authorization primitive — the load-bearing,
 * security-sensitive part — independent of any RPC/bundler:
 *
 *   - {@link hashAuthorization}        the digest the authority signs
 *   - {@link signAuthorization}        produce a signed authorization
 *   - {@link recoverAuthority}         recover the signing EOA
 *   - {@link verifyAuthorization}      check a signature against an EOA
 *   - {@link encodeSignedAuthorization} RLP tuple for `authorization_list`
 *
 * Spec (EIP-7702):
 *   magic   = 0x05
 *   message = magic ‖ rlp([chain_id, address, nonce])
 *   digest  = keccak256(message)
 *   the authority signs `digest` with secp256k1 → (y_parity, r, s)
 *   authorization tuple in a tx = [chain_id, address, nonce, y_parity, r, s]
 *
 * `chain_id == 0` is the wildcard: the authorization is valid on every
 * chain. Any non-zero value pins it to a single chain. The `nonce` is
 * the authority EOA's account nonce at the time of inclusion and MUST
 * match for the delegation to take effect — this is the replay guard.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  bytesToHex,
  hexToBytes,
  recoverSignerAddress,
  rlpEncode,
  splitSignature,
} from "@aethelred/wallet-core";

/** EIP-7702 authorization magic prefix byte. */
export const AUTHORIZATION_MAGIC = 0x05;

/** EIP-7702 "set code" transaction type byte (0x04). */
export const SET_CODE_TX_TYPE = 0x04;

/** Wildcard chain id — an authorization valid on every chain. */
export const ANY_CHAIN_ID = 0n;

/**
 * An unsigned EIP-7702 authorization. The authority (an EOA) is
 * committing to delegate its code to `address` on `chainId`, valid only
 * while its account nonce equals `nonce`.
 */
export interface Authorization {
  /** Target chain id, or {@link ANY_CHAIN_ID} (0) for "every chain". */
  readonly chainId: bigint;
  /** Delegate implementation address, 20-byte `0x`-prefixed hex. */
  readonly address: `0x${string}`;
  /** Authority EOA account nonce this authorization is bound to. */
  readonly nonce: bigint;
}

/**
 * A signed authorization — the tuple actually carried in a type-0x04
 * transaction's `authorization_list`. `yParity` is 0 or 1 (NOT the
 * legacy 27/28); `r`/`s` are 32-byte `0x`-prefixed hex.
 */
export interface SignedAuthorization extends Authorization {
  readonly yParity: 0 | 1;
  readonly r: `0x${string}`;
  readonly s: `0x${string}`;
}

/**
 * Signs a 32-byte digest and returns a 65-byte `r ‖ s ‖ v` signature.
 * Custody-agnostic: the same shape is produced by the local key
 * backend, a Ledger, or a test key — so this module never touches a
 * private key directly.
 */
export type SignDigestFn = (digest: Uint8Array) => Uint8Array | Promise<Uint8Array>;

function assertAddress(address: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`EIP-7702: invalid delegate address "${address}"`);
  }
}

/** RLP-encode the `[chain_id, address, nonce]` authorization tuple. */
function encodeAuthorizationTuple(auth: Authorization): Uint8Array {
  assertAddress(auth.address);
  if (auth.chainId < 0n) throw new Error("EIP-7702: chainId must be >= 0");
  if (auth.nonce < 0n) throw new Error("EIP-7702: nonce must be >= 0");
  return rlpEncode([auth.chainId, hexToBytes(auth.address), auth.nonce]);
}

/**
 * The 32-byte digest the authority must sign:
 * `keccak256(0x05 ‖ rlp([chain_id, address, nonce]))`.
 */
export function hashAuthorization(auth: Authorization): Uint8Array {
  const tuple = encodeAuthorizationTuple(auth);
  const message = new Uint8Array(1 + tuple.length);
  message[0] = AUTHORIZATION_MAGIC;
  message.set(tuple, 1);
  return keccak_256(message);
}

/** Normalise a recovery id (0/1 or 27/28) to a 7702 y-parity (0/1). */
function toYParity(recovery: number): 0 | 1 {
  const v = recovery >= 27 ? recovery - 27 : recovery;
  if (v !== 0 && v !== 1) {
    throw new Error(`EIP-7702: invalid recovery id ${recovery}`);
  }
  return v;
}

/**
 * Produce a signed authorization. `signDigest` signs the
 * {@link hashAuthorization} digest with the authority EOA's key.
 */
export async function signAuthorization(
  auth: Authorization,
  signDigest: SignDigestFn,
): Promise<SignedAuthorization> {
  const digest = hashAuthorization(auth);
  const sig65 = await signDigest(digest);
  if (sig65.length !== 65) {
    throw new Error(`EIP-7702: expected 65-byte signature, got ${sig65.length}`);
  }
  const { r, s, recovery } = splitSignature(sig65);
  return {
    ...auth,
    yParity: toYParity(recovery),
    r: bytesToHex(r) as `0x${string}`,
    s: bytesToHex(s) as `0x${string}`,
  };
}

/**
 * Recover the authority EOA address that signed an authorization.
 * Returns a lower-case `0x`-prefixed address.
 */
export function recoverAuthority(signed: SignedAuthorization): `0x${string}` {
  const digest = hashAuthorization(signed);
  const r = hexToBytes(signed.r);
  const s = hexToBytes(signed.s);
  if (r.length !== 32 || s.length !== 32) {
    throw new Error("EIP-7702: r and s must each be 32 bytes");
  }
  const sig65 = new Uint8Array(65);
  sig65.set(r, 0);
  sig65.set(s, 32);
  sig65[64] = signed.yParity;
  return recoverSignerAddress(digest, sig65) as `0x${string}`;
}

/**
 * True iff `signed` is a valid authorization by `expectedAuthority`.
 * Comparison is case-insensitive (recovered addresses are lower-case).
 */
export function verifyAuthorization(
  signed: SignedAuthorization,
  expectedAuthority: `0x${string}`,
): boolean {
  assertAddress(expectedAuthority);
  let recovered: string;
  try {
    recovered = recoverAuthority(signed);
  } catch {
    return false;
  }
  return recovered.toLowerCase() === expectedAuthority.toLowerCase();
}

/**
 * RLP-encode a signed authorization as the 6-element tuple
 * `[chain_id, address, nonce, y_parity, r, s]` for inclusion in a
 * type-0x04 transaction's `authorization_list`.
 */
export function encodeSignedAuthorization(signed: SignedAuthorization): Uint8Array {
  assertAddress(signed.address);
  return rlpEncode([
    signed.chainId,
    hexToBytes(signed.address),
    signed.nonce,
    BigInt(signed.yParity),
    hexToBytes(signed.r),
    hexToBytes(signed.s),
  ]);
}

/**
 * Is this authorization the cross-chain wildcard (`chain_id == 0`)?
 * Wildcard authorizations are replayable on every chain, so callers
 * should surface this prominently in any approval UI.
 */
export function isWildcardAuthorization(auth: Authorization): boolean {
  return auth.chainId === ANY_CHAIN_ID;
}
