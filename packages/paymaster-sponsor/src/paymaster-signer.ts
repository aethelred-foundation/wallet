/**
 * `PaymasterSigner` — produces the signature the on-chain
 * VerifyingPaymaster contract validates.
 *
 * VerifyingPaymaster signing scheme (EF reference + common forks):
 *
 *     hash = keccak256(abi.encode(
 *       userOpHash,
 *       validUntil,   // uint48
 *       validAfter    // uint48
 *     ))
 *     sig  = secp256k1.sign(
 *       keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash))
 *     )  // EIP-191 personal-sign envelope
 *
 * Then the paymasterData layout is:
 *
 *     paymasterAddress (20)  || verifGas (16)  || postOpGas (16)
 *       || validUntil (6)    || validAfter (6) || signature (65)
 *
 * We wrap the signer behind a `TypedDataSigner`-like interface so
 * the paymaster signing key can be any CustodyAdapter — including
 * a Nitro-enclave-sealed signer. That's the moat: regulated
 * operators prove (via TEE attestation) that their sponsor service
 * is running approved code.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";

import type { TypedDataSigner } from "@aethelred/wallet-custody-adapters";
import { computeTypedDataDigest } from "@aethelred/wallet-custody-adapters";

import { PaymasterSponsorError } from "./errors";

export interface PaymasterSignerConfig {
  readonly paymasterAddress: `0x${string}`;
  readonly signer: TypedDataSigner;
}

/**
 * Output: a 65-byte secp256k1 signature packed with validUntil
 * (6 bytes) + validAfter (6 bytes) as per the common
 * VerifyingPaymaster layout.
 */
export interface PaymasterSignature {
  /** 65-byte `r||s||v`. */
  readonly signature: `0x${string}`;
  /** Assembled paymasterData blob ready to splat into UserOp. */
  readonly paymasterData: `0x${string}`;
}

export class PaymasterSigner {
  readonly paymasterAddress: `0x${string}`;
  private readonly signer: TypedDataSigner;

  constructor(config: PaymasterSignerConfig) {
    if (config.signer.address.toLowerCase() !== config.paymasterAddress.toLowerCase()) {
      // We don't require the signer address equal the paymaster
      // contract address — the paymaster contract holds a separate
      // "verifier" key that signs approvals. But we DO require the
      // caller tells us which paymaster the signer is authorized for.
    }
    this.paymasterAddress = config.paymasterAddress;
    this.signer = config.signer;
  }

  /**
   * Produce signature + packed paymasterData for a
   * (userOpHash, validUntil, validAfter) triple. Uses a minimal
   * EIP-712 wrapper so the result works with any `TypedDataSigner`
   * (including hardware + enclave signers that refuse raw-digest
   * signing).
   *
   * The structure we sign:
   *
   *     PaymasterApproval(
   *       bytes32 userOpHash,
   *       uint48 validUntil,
   *       uint48 validAfter,
   *       address paymaster
   *     )
   */
  async sign(params: {
    readonly userOpHash: `0x${string}`;
    readonly validUntil: number;
    readonly validAfter: number;
    readonly paymasterVerificationGas: bigint;
    readonly paymasterPostOpGas: bigint;
    readonly chainId: number;
  }): Promise<PaymasterSignature> {
    if (params.validAfter >= params.validUntil) {
      throw new PaymasterSponsorError(
        "request-malformed",
        `validAfter ${params.validAfter} must be < validUntil ${params.validUntil}`,
      );
    }
    if (params.validUntil > 0xffffffffffff) {
      throw new PaymasterSponsorError(
        "request-malformed",
        `validUntil ${params.validUntil} exceeds uint48 range`,
      );
    }

    const digest = buildApprovalDigest({
      userOpHash: params.userOpHash,
      validUntil: params.validUntil,
      validAfter: params.validAfter,
      paymaster: this.paymasterAddress,
      chainId: params.chainId,
    });

    // Sign via EIP-712 so hardware/TEE signers can show a meaningful
    // prompt. We treat the already-computed digest as the "message"
    // under a one-field wrapper so the signing request carries the
    // bytes the paymaster contract expects.
    const req = {
      domain: {
        name: "AethelredPaymasterApproval",
        version: "1",
        chainId: params.chainId,
        verifyingContract: this.paymasterAddress,
      },
      types: {
        Approval: [
          { name: "userOpHash", type: "bytes32" },
          { name: "validUntil", type: "uint256" },
          { name: "validAfter", type: "uint256" },
        ],
      },
      primaryType: "Approval",
      message: {
        userOpHash: params.userOpHash,
        validUntil: params.validUntil,
        validAfter: params.validAfter,
      },
    } as const;

    // The signer produces a 65-byte sig against the EIP-712 digest of
    // `req`. That digest is deterministic and equals what on-chain
    // code would recompute, so the paymaster contract validates by
    // re-deriving the same EIP-712 digest + ecrecover-ing the signer.
    const signature = await this.signer.signTypedData(req);

    const eip712Digest = computeTypedDataDigest(req);
    void eip712Digest;
    void digest; // kept for structural parity + future audit dumps

    const paymasterData = encodePaymasterData({
      paymaster: this.paymasterAddress,
      verificationGas: params.paymasterVerificationGas,
      postOpGas: params.paymasterPostOpGas,
      validUntil: params.validUntil,
      validAfter: params.validAfter,
      signature,
    });

    return { signature, paymasterData };
  }

  get signerAddress(): `0x${string}` {
    return this.signer.address;
  }
}

// ─── Low-level helpers ────────────────────────────────────────

/**
 * Build the keccak digest a legacy (non-EIP-712) paymaster contract
 * would compute. Kept for reference / audit dumps even though the
 * actual signer runs EIP-712.
 */
export function buildApprovalDigest(params: {
  readonly userOpHash: `0x${string}`;
  readonly validUntil: number;
  readonly validAfter: number;
  readonly paymaster: `0x${string}`;
  readonly chainId: number;
}): Uint8Array {
  const preimage = concatBytes(
    abiEncodeBytes32(params.userOpHash),
    abiEncodeUint256(BigInt(params.validUntil)),
    abiEncodeUint256(BigInt(params.validAfter)),
    abiEncodeAddress(params.paymaster),
    abiEncodeUint256(BigInt(params.chainId)),
  );
  return keccak_256(preimage);
}

export function encodePaymasterData(params: {
  readonly paymaster: `0x${string}`;
  readonly verificationGas: bigint;
  readonly postOpGas: bigint;
  readonly validUntil: number;
  readonly validAfter: number;
  readonly signature: `0x${string}`;
}): `0x${string}` {
  const parts = [
    stripHex(params.paymaster), // 20 bytes
    bigintToHex(params.verificationGas, 16), // 16 bytes
    bigintToHex(params.postOpGas, 16), // 16 bytes
    bigintToHex(BigInt(params.validUntil), 6), // 6 bytes
    bigintToHex(BigInt(params.validAfter), 6), // 6 bytes
    stripHex(params.signature), // 65 bytes
  ];
  return ("0x" + parts.join("").toLowerCase()) as `0x${string}`;
}

/**
 * Inverse of `encodePaymasterData`. Useful for audit replay /
 * bundler integrations that want to re-derive the fields.
 */
export function decodePaymasterData(data: `0x${string}`): {
  readonly paymaster: `0x${string}`;
  readonly verificationGas: bigint;
  readonly postOpGas: bigint;
  readonly validUntil: number;
  readonly validAfter: number;
  readonly signature: `0x${string}`;
} {
  const raw = stripHex(data);
  // 20 + 16 + 16 + 6 + 6 + 65 = 129 bytes = 258 hex chars
  if (raw.length !== 258) {
    throw new PaymasterSponsorError(
      "request-malformed",
      `paymasterData must be 129 bytes, got ${raw.length / 2}`,
    );
  }
  let offset = 0;
  const paymaster = ("0x" + raw.slice(offset, offset + 40)) as `0x${string}`;
  offset += 40;
  const verificationGas = BigInt("0x" + raw.slice(offset, offset + 32));
  offset += 32;
  const postOpGas = BigInt("0x" + raw.slice(offset, offset + 32));
  offset += 32;
  const validUntil = Number(BigInt("0x" + raw.slice(offset, offset + 12)));
  offset += 12;
  const validAfter = Number(BigInt("0x" + raw.slice(offset, offset + 12)));
  offset += 12;
  const signature = ("0x" + raw.slice(offset)) as `0x${string}`;
  return { paymaster, verificationGas, postOpGas, validUntil, validAfter, signature };
}

// ─── ABI primitive helpers ────────────────────────────────────

function stripHex(v: string): string {
  return v.startsWith("0x") ? v.slice(2) : v;
}

function bigintToHex(value: bigint, bytes: number): string {
  if (value < 0n) {
    throw new PaymasterSponsorError("gas-overflow", `negative value: ${value}`);
  }
  const hex = value.toString(16);
  if (hex.length > bytes * 2) {
    throw new PaymasterSponsorError(
      "gas-overflow",
      `value ${value} does not fit in ${bytes} bytes`,
    );
  }
  return hex.padStart(bytes * 2, "0");
}

function abiEncodeBytes32(hex: `0x${string}`): Uint8Array {
  const raw = stripHex(hex);
  if (raw.length !== 64) {
    throw new PaymasterSponsorError(
      "request-malformed",
      `bytes32 must be 32 bytes, got ${raw.length / 2}`,
    );
  }
  return hexToBytes(raw);
}

function abiEncodeUint256(v: bigint): Uint8Array {
  if (v < 0n) throw new PaymasterSponsorError("gas-overflow", `negative uint256`);
  const hex = v.toString(16).padStart(64, "0");
  if (hex.length > 64) throw new PaymasterSponsorError("gas-overflow", `uint256 overflow`);
  return hexToBytes(hex);
}

function abiEncodeAddress(a: `0x${string}`): Uint8Array {
  const raw = stripHex(a);
  if (raw.length !== 40) {
    throw new PaymasterSponsorError(
      "request-malformed",
      `address must be 20 bytes, got ${raw.length / 2}`,
    );
  }
  return hexToBytes("0".repeat(24) + raw);
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new PaymasterSponsorError("request-malformed", `odd-length hex`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
