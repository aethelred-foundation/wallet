/**
 * SIGN_MODE_DIRECT transaction building + signing for Aethelred's native
 * (Cosmos SDK) side.
 *
 * The flow mirrors exactly what the chain's ante handler verifies:
 *
 *   TxBody(messages, memo)              → bodyBytes
 *   AuthInfo(pubkey, sequence, fee)     → authInfoBytes
 *   SignDoc(bodyBytes, authInfoBytes,
 *           chainId, accountNumber)     → signBytes
 *   digest = keccak256(signBytes)         (eth_secp256k1 — Aethelred)
 *          |  sha256(signBytes)           (vanilla secp256k1 chains)
 *   signature = secp256k1(digest), 64-byte r‖s, low-S
 *   TxRaw(bodyBytes, authInfoBytes, [signature]) → broadcast bytes
 *
 * Aethelred accounts are `eth_secp256k1` (cosmos/evm): the node verifies
 * with `crypto.VerifySignature(pubkey, Keccak256(signBytes), sig[:64])`
 * (see cosmos/evm `crypto/ethsecp256k1`). This is the SAME digest+signature
 * shape the wallet's EVM custody path already produces — one key, one
 * signing backend, two transaction faces.
 *
 * Signing is abstracted behind {@link DigestSigner} so the wallet's custody
 * backends (local, hardware, MPC) plug in directly: the custody `sign()`
 * returns 65-byte r‖s‖v; the recovery byte is trimmed for Cosmos.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import * as secp256k1 from "@noble/secp256k1";

import type { SignatureAlgo } from "./address";
import type { AnyMsg, Coin } from "./messages";
import { encodeCoin } from "./messages";
import { ProtoWriter } from "./proto";

/** `cosmos.tx.signing.v1beta1.SignMode.SIGN_MODE_DIRECT`. */
const SIGN_MODE_DIRECT = 1;

/** Pubkey `Any` type URL for Aethelred (cosmos/evm eth_secp256k1 accounts). */
export const ETHSECP256K1_PUBKEY_TYPE_URL =
  "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey";

/** Pubkey `Any` type URL for vanilla Cosmos secp256k1 accounts. */
export const SECP256K1_PUBKEY_TYPE_URL = "/cosmos.crypto.secp256k1.PubKey";

/** Error thrown for unsignable inputs. */
export class CosmosTxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CosmosTxError";
  }
}

/**
 * Signs a 32-byte digest, returning a 64-byte `r‖s` (low-S) signature —
 * or 65 bytes `r‖s‖v`, from which the recovery byte is trimmed. This is
 * the exact contract of the wallet-core custody backends' `sign()`, so a
 * custody-routed signer is just:
 *
 *   (digest) => custody.sign(keySlotId, digest)
 */
export type DigestSigner = (
  digest: Uint8Array,
) => Uint8Array | Promise<Uint8Array>;

/** Local software signer over a raw private key (tests / dev tooling). */
export function nobleDigestSigner(privateKey: Uint8Array): DigestSigner {
  return (digest) =>
    secp256k1.sign(digest, privateKey, { lowS: true }).toCompactRawBytes();
}

/** Compressed (33-byte) secp256k1 public key for a private key. */
export function compressedPubkey(privateKey: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(privateKey, true);
}

/** Encode a pubkey `Any` for the given signature algorithm. */
export function encodePubkeyAny(
  compressedPubkey33: Uint8Array,
  algo: SignatureAlgo,
): AnyMsg {
  if (compressedPubkey33.length !== 33) {
    throw new CosmosTxError(
      `expected 33-byte compressed pubkey, got ${compressedPubkey33.length}`,
    );
  }
  // Both pubkey messages are `bytes key = 1`.
  const value = new ProtoWriter().bytes(1, compressedPubkey33).finish();
  return {
    typeUrl:
      algo === "eth_secp256k1"
        ? ETHSECP256K1_PUBKEY_TYPE_URL
        : SECP256K1_PUBKEY_TYPE_URL,
    value,
  };
}

/** Encode a `google.protobuf.Any`. */
export function encodeAny(any: AnyMsg): Uint8Array {
  return new ProtoWriter()
    .string(1, any.typeUrl)
    .bytes(2, any.value)
    .finish();
}

/** Encode `cosmos.tx.v1beta1.TxBody`. */
export function encodeTxBody(params: {
  messages: readonly AnyMsg[];
  memo?: string;
  timeoutHeight?: bigint;
}): Uint8Array {
  if (params.messages.length === 0) {
    throw new CosmosTxError("TxBody requires at least one message");
  }
  const w = new ProtoWriter();
  for (const msg of params.messages) {
    w.embedded(1, encodeAny(msg));
  }
  w.string(2, params.memo ?? "");
  w.uint64(3, params.timeoutHeight ?? 0n);
  return w.finish();
}

/** Transaction fee: coins + gas limit (payer/granter for fee-grants). */
export interface Fee {
  readonly amount: readonly Coin[];
  readonly gasLimit: bigint;
  readonly payer?: string;
  readonly granter?: string;
}

/** Encode `cosmos.tx.v1beta1.Fee`. */
export function encodeFee(fee: Fee): Uint8Array {
  const w = new ProtoWriter();
  for (const coin of fee.amount) {
    w.embedded(1, encodeCoin(coin));
  }
  w.uint64(2, fee.gasLimit);
  w.string(3, fee.payer ?? "");
  w.string(4, fee.granter ?? "");
  return w.finish();
}

/** Encode `cosmos.tx.v1beta1.AuthInfo` for a single direct signer. */
export function encodeAuthInfo(params: {
  pubkey: AnyMsg;
  sequence: bigint;
  fee: Fee;
}): Uint8Array {
  // ModeInfo { single { mode: SIGN_MODE_DIRECT } }
  const single = new ProtoWriter().uint64(1, SIGN_MODE_DIRECT).finish();
  const modeInfo = new ProtoWriter().embedded(1, single).finish();
  const signerInfo = new ProtoWriter()
    .embedded(1, encodeAny(params.pubkey))
    .embedded(2, modeInfo)
    .uint64(3, params.sequence)
    .finish();
  return new ProtoWriter()
    .embedded(1, signerInfo)
    .embedded(2, encodeFee(params.fee))
    .finish();
}

/** Encode `cosmos.tx.v1beta1.SignDoc` — the SIGN_MODE_DIRECT sign bytes. */
export function encodeSignDoc(params: {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  chainId: string;
  accountNumber: bigint;
}): Uint8Array {
  return new ProtoWriter()
    .bytes(1, params.bodyBytes)
    .bytes(2, params.authInfoBytes)
    .string(3, params.chainId)
    .uint64(4, params.accountNumber)
    .finish();
}

/**
 * The digest the chain actually verifies for SIGN_MODE_DIRECT:
 * keccak256 for `eth_secp256k1` (Aethelred), sha256 for vanilla Cosmos.
 */
export function signDocDigest(
  signDocBytes: Uint8Array,
  algo: SignatureAlgo,
): Uint8Array {
  return algo === "eth_secp256k1"
    ? keccak_256(signDocBytes)
    : sha256(signDocBytes);
}

/** Encode `cosmos.tx.v1beta1.TxRaw` — the broadcastable transaction. */
export function encodeTxRaw(params: {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  signature: Uint8Array;
}): Uint8Array {
  return new ProtoWriter()
    .bytes(1, params.bodyBytes)
    .bytes(2, params.authInfoBytes)
    .bytes(3, params.signature)
    .finish();
}

/** Cosmos tx hash: uppercase hex SHA-256 of the TxRaw bytes. */
export function txHash(txRawBytes: Uint8Array): string {
  return Array.from(sha256(txRawBytes), (b) =>
    b.toString(16).padStart(2, "0"),
  )
    .join("")
    .toUpperCase();
}

/** Everything needed to sign one native transaction. */
export interface SignDirectParams {
  readonly messages: readonly AnyMsg[];
  readonly memo?: string;
  readonly timeoutHeight?: bigint;
  readonly fee: Fee;
  readonly chainId: string;
  readonly accountNumber: bigint;
  readonly sequence: bigint;
  /** 33-byte compressed secp256k1 public key of the signer. */
  readonly pubkey: Uint8Array;
  readonly algo: SignatureAlgo;
  readonly signer: DigestSigner;
}

/** A signed native transaction, ready to broadcast. */
export interface SignedTx {
  readonly txRaw: Uint8Array;
  readonly txHash: string;
  readonly signDocBytes: Uint8Array;
  readonly signature: Uint8Array;
}

/**
 * Build and sign a SIGN_MODE_DIRECT transaction.
 *
 * Accepts 64-byte (`r‖s`) or 65-byte (`r‖s‖v`, custody-backend shape)
 * signatures from the {@link DigestSigner}; the recovery byte is trimmed
 * because Cosmos SDK signatures are exactly `r‖s`.
 */
export async function signDirect(params: SignDirectParams): Promise<SignedTx> {
  const bodyBytes = encodeTxBody({
    messages: params.messages,
    memo: params.memo,
    timeoutHeight: params.timeoutHeight,
  });
  const authInfoBytes = encodeAuthInfo({
    pubkey: encodePubkeyAny(params.pubkey, params.algo),
    sequence: params.sequence,
    fee: params.fee,
  });
  const signDocBytes = encodeSignDoc({
    bodyBytes,
    authInfoBytes,
    chainId: params.chainId,
    accountNumber: params.accountNumber,
  });

  const raw = await params.signer(signDocDigest(signDocBytes, params.algo));
  if (raw.length !== 64 && raw.length !== 65) {
    throw new CosmosTxError(
      `signer returned ${raw.length} bytes; expected 64 (r‖s) or 65 (r‖s‖v)`,
    );
  }
  const signature = raw.length === 65 ? raw.subarray(0, 64) : raw;

  const txRaw = encodeTxRaw({ bodyBytes, authInfoBytes, signature });
  return { txRaw, txHash: txHash(txRaw), signDocBytes, signature };
}
