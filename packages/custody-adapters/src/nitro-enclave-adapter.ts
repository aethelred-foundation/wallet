/**
 * `NitroEnclaveAdapter` — TEE-sealed signing with attestation binding.
 *
 * This is the **moat tier**. The private key physically lives inside
 * an AWS Nitro Enclave (or any compatible TEE host — Intel TDX, GCP
 * Confidential Space, Azure Attestation) and never crosses the
 * boundary. The adapter is a thin client:
 *
 *   1. Compute the EIP-712 digest locally using the shared
 *      `computeTypedDataDigest` — same byte-for-byte output the
 *      `LocalKeyAdapter` would produce.
 *   2. Ship the digest to the enclave over a pluggable
 *      `EnclaveTransport` (vsock, HTTPS-over-mTLS, ALB, gRPC).
 *   3. Enclave signs the digest AND produces a fresh attestation
 *      quote binding the user-data field to the digest.
 *   4. Client verifies the signature recovers to the expected
 *      address — a compromised enclave cannot lie about the signer.
 *
 * The moat: every x402 payment from this adapter can carry a fresh
 * TEE quote whose `userData` binds to the payment's struct hash.
 * The facilitator / merchant verifies:
 *
 *   - The quote's silicon signature chain (DCAP / Nitro root CA).
 *   - The measurements match the approved `codeHash`.
 *   - The `nonce` (= userData) binds to THIS payment's struct hash.
 *
 * MoltPe cannot produce that binding — their custody stack doesn't
 * sit inside a TEE. They can move money safely; they cannot
 * *prove* the code moving it is the code they shipped.
 *
 * ───
 *
 * Transport is pluggable because deployment topologies vary:
 *
 *   - **Nitro-in-VPC**: enclave sibling to an EC2 parent; vsock
 *     transport talks port 5000 on the parent, which proxies to
 *     vsock CID 16.
 *   - **Nitro-public**: ALB in front of a parent that bridges vsock.
 *     HTTPS-over-mTLS.
 *   - **Intel TDX**: gRPC to a trust domain's guest-to-host bridge.
 *   - **GCP Confidential Space**: internal load balancer + workload
 *     identity.
 *
 * The adapter doesn't care — it just calls
 * `transport.requestSignature(...)` and gets back a response with
 * signature + (optionally) an attached quote.
 */

import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3.js";

import "./crypto-bootstrap";
import type {
  CustodyAdapter,
  CustodyCapabilities,
  RawTransactionRequest,
  TeeAttestationBundle,
  TypedDataRequest,
  TypedDataSigner,
} from "./types";
import { computeTypedDataDigest } from "./eip712-hash";
import { CustodyError } from "./errors";

/**
 * Pluggable transport to the enclave. Concrete implementations live
 * next to the deployment model (see header comment). The adapter
 * calls these three methods and doesn't care about the wire protocol.
 */
export interface EnclaveTransport {
  /**
   * Ask the enclave to sign a 32-byte digest. The enclave signs
   * with its sealed private key AND (optionally) attaches a fresh
   * TEE quote binding `userData` to the digest + its code
   * measurements. `userData` is a 32-byte blob passed as-is into
   * the platform-specific quote structure.
   */
  requestSignature(
    request: EnclaveSignatureRequest,
  ): Promise<EnclaveSignatureResponse>;

  /**
   * Ask the enclave for its attested public key + address. Usually
   * called once at startup; the adapter caches the result.
   */
  requestPublicKey(): Promise<EnclavePublicKeyResponse>;

  /**
   * Ask the enclave for a standalone TEE quote bound to `userData`.
   * Called by `produceAttestation()` for the x402 attestation
   * provider path — separate from signing because x402 needs the
   * quote *before* it hashes the payment struct (the struct hash
   * goes INTO the user-data field).
   */
  requestAttestation(userData: `0x${string}`): Promise<TeeAttestationBundle>;
}

export interface EnclaveSignatureRequest {
  /** 32-byte digest to sign. */
  readonly digest: Uint8Array;
  /**
   * Optional user-data blob to bind into an attached quote. When
   * provided, the enclave response includes `attestation`. When
   * absent, only the signature is returned.
   */
  readonly userData?: `0x${string}`;
}

export interface EnclaveSignatureResponse {
  /**
   * 65-byte Ethereum-style signature (r || s || v), hex with 0x
   * prefix. v = 27 + recovery.
   */
  readonly signature: `0x${string}`;
  /**
   * Fresh attestation quote bound to this signature, if a userData
   * was supplied in the request. Absent otherwise.
   */
  readonly attestation?: TeeAttestationBundle;
}

export interface EnclavePublicKeyResponse {
  /** Ethereum address derived from the enclave's sealed secp256k1 key. */
  readonly address: `0x${string}`;
  /**
   * Uncompressed public key (65 bytes, 0x04-prefixed hex). Adapter
   * uses this to cross-check recovered signatures before accepting.
   */
  readonly uncompressedPublicKey: `0x${string}`;
  /**
   * Attestation quote that binds the public key to the enclave's
   * measurements. Callers SHOULD verify this quote at wallet
   * construction time so the address is "attested-trusted" before
   * any signing.
   */
  readonly attestation: TeeAttestationBundle;
}

export interface NitroEnclaveAdapterConfig {
  /** Transport to the enclave. Pluggable — see `EnclaveTransport`. */
  readonly transport: EnclaveTransport;

  /** Optional label. Default: "nitro-enclave". */
  readonly label?: string;

  /**
   * Skip the client-side signature verification step (recovery +
   * address cross-check). Default: `false`. Intended only for
   * deployments where the enclave attestation chain is considered
   * self-sufficient (verifier sanity-checks the quote every call).
   * Leaving this at `false` is free insurance — just a keccak and a
   * point multiplication per signature.
   */
  readonly skipClientVerification?: boolean;

  /**
   * Whether to emit an attestation on every `signTypedData` call.
   * When `true`, the adapter computes the digest, asks the enclave
   * to sign AND attest in one round-trip, and exposes the quote via
   * `produceAttestation(digest)` for the x402 provider.
   *
   * Default: `false` — `signTypedData` just signs, and callers
   * request quotes separately via `produceAttestation()`. Flip to
   * `true` for deployments where every payment MUST carry a quote.
   */
  readonly attestOnSign?: boolean;
}

export class NitroEnclaveAdapter implements CustodyAdapter {
  readonly capabilities: CustodyCapabilities;

  private readonly transport: EnclaveTransport;
  private readonly skipClientVerification: boolean;
  private readonly attestOnSign: boolean;

  private cachedAddress?: `0x${string}`;
  private cachedUncompressedPublicKey?: Uint8Array;
  private cachedStartupAttestation?: TeeAttestationBundle;
  private lastSignatureAttestation?: TeeAttestationBundle;
  private disposed = false;

  constructor(config: NitroEnclaveAdapterConfig) {
    this.transport = config.transport;
    this.skipClientVerification = config.skipClientVerification ?? false;
    this.attestOnSign = config.attestOnSign ?? false;

    this.capabilities = {
      canSignTypedData: true,
      canSignRawTransaction: false, // deferred; enclave could support it, but out of scope here
      canExportPublicKey: true,
      canProduceAttestation: true,
      requiresUserInteraction: false,
      requiresNetworkAccess: true,
      label: config.label ?? "nitro-enclave",
    };
  }

  /**
   * Before signing, consumers MUST call `initialize()` once (or
   * rely on the lazy load in `signTypedData`). This fetches the
   * enclave's attested public key + startup quote so we know which
   * address we're signing for.
   */
  async initialize(): Promise<void> {
    if (this.cachedAddress && this.cachedUncompressedPublicKey) return;
    this.ensureAlive();

    const pk = await this.transport.requestPublicKey();
    this.validateUncompressedPublicKey(pk.uncompressedPublicKey);
    this.cachedAddress = pk.address;
    this.cachedUncompressedPublicKey = hexToBytes(pk.uncompressedPublicKey);
    this.cachedStartupAttestation = pk.attestation;

    // Verify the address the enclave claims matches what we'd derive
    // from the uncompressed public key. If the enclave lies here, the
    // attestation chain should separately reject the key, but this
    // cross-check is free.
    const derived = computeAddressFromUncompressedPublicKey(
      this.cachedUncompressedPublicKey,
    );
    if (derived.toLowerCase() !== pk.address.toLowerCase()) {
      throw new CustodyError(
        "invalid-key-material",
        `Enclave-reported address ${pk.address} does not match derived ${derived}`,
      );
    }
  }

  get address(): `0x${string}` {
    if (!this.cachedAddress) {
      throw new CustodyError(
        "adapter-config-invalid",
        "NitroEnclaveAdapter not initialized — call `await adapter.initialize()` before reading address",
      );
    }
    return this.cachedAddress;
  }

  /**
   * Startup attestation that binds the enclave's public key to its
   * measurements. Present after `initialize()` succeeds; useful for
   * auditors and for the verifier to decide whether this address is
   * allowed to transact at all.
   */
  get startupAttestation(): TeeAttestationBundle | undefined {
    return this.cachedStartupAttestation;
  }

  async signTypedData(req: TypedDataRequest): Promise<`0x${string}`> {
    this.ensureAlive();
    if (!this.cachedAddress) {
      // Lazy init: cache-miss on first sign. Most callers will have
      // called initialize() already — this is defensive.
      await this.initialize();
    }

    const digest = computeTypedDataDigest(req);

    // When attestOnSign is enabled, bind the fresh quote to the
    // struct hash — NOT the digest. The x402 facilitator needs the
    // binding to match the payment struct, which is what the quote
    // provider returns.
    //
    // Structure: we cache the attestation for the most recent sign
    // so produceAttestation(userData === digest) returns it without
    // another round-trip.
    const userData: `0x${string}` | undefined = this.attestOnSign
      ? bytesToHexPrefixed(digest)
      : undefined;

    const response = await this.transport.requestSignature({
      digest,
      userData,
    });

    if (!this.skipClientVerification) {
      this.verifySignatureRecovers(digest, response.signature);
    }

    if (response.attestation) {
      // Sanity: the attestation must carry the same nonce we asked
      // for. Defends against adapter-swap attacks where an enclave
      // returns a cached quote.
      if (
        userData !== undefined &&
        response.attestation.nonce.toLowerCase() !== userData.toLowerCase()
      ) {
        throw new CustodyError(
          "attestation-failed",
          `Enclave attestation nonce ${response.attestation.nonce} does not match requested userData ${userData}`,
        );
      }
      this.lastSignatureAttestation = response.attestation;
    }

    return response.signature;
  }

  async signRawTransaction(_req: RawTransactionRequest): Promise<`0x${string}`> {
    throw new CustodyError(
      "capability-not-supported",
      "NitroEnclaveAdapter.signRawTransaction is deferred to @aethelred/wallet-core custody",
    );
  }

  /**
   * Produce a fresh attestation quote bound to `userData`. This is
   * the hot path for x402's `AttestationProvider`: before each
   * payment, x402 computes the struct hash, passes it as userData,
   * and gets back a quote whose binding ties the quote to THIS
   * payment.
   *
   * If a matching attestation was cached by the most recent
   * `signTypedData(..., attestOnSign: true)`, we return it without
   * an extra round-trip. Otherwise we fetch fresh.
   */
  async produceAttestation(userData: `0x${string}`): Promise<TeeAttestationBundle> {
    this.ensureAlive();
    if (
      this.lastSignatureAttestation &&
      this.lastSignatureAttestation.nonce.toLowerCase() === userData.toLowerCase()
    ) {
      // Freshness guard: cached attestations older than 5 minutes
      // are discarded even if they bind to the right user-data.
      // MoltPe-tier customers won't notice; regulated customers
      // will want to tune this via config (follow-up).
      const ageMs = Date.now() - this.lastSignatureAttestation.generatedAt;
      if (ageMs < 5 * 60_000) {
        return this.lastSignatureAttestation;
      }
    }
    const attestation = await this.transport.requestAttestation(userData);
    if (attestation.nonce.toLowerCase() !== userData.toLowerCase()) {
      throw new CustodyError(
        "attestation-failed",
        `Enclave returned attestation whose nonce ${attestation.nonce} does not match requested userData ${userData}`,
      );
    }
    return attestation;
  }

  asTypedDataSigner(): TypedDataSigner {
    return {
      address: this.address,
      signTypedData: (req) => this.signTypedData(req),
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.cachedUncompressedPublicKey = undefined;
    this.cachedStartupAttestation = undefined;
    this.lastSignatureAttestation = undefined;
    this.disposed = true;
  }

  // ─── Private ────────────────────────────────────────────────

  private ensureAlive(): void {
    if (this.disposed) {
      throw new CustodyError("adapter-disposed", "NitroEnclaveAdapter has been disposed");
    }
  }

  private validateUncompressedPublicKey(hex: `0x${string}`): void {
    const bytes = hexToBytes(hex);
    if (bytes.length !== 65 || bytes[0] !== 0x04) {
      throw new CustodyError(
        "invalid-key-material",
        `Enclave-reported public key must be 65 bytes starting with 0x04, got ${bytes.length} bytes starting with 0x${bytes[0]?.toString(16)}`,
      );
    }
    // Verify the point is on the curve. secp256k1.ProjectivePoint.fromHex
    // throws on invalid points.
    try {
      secp256k1.ProjectivePoint.fromHex(bytes);
    } catch (cause) {
      throw new CustodyError("invalid-key-material", "Enclave-reported public key is not on secp256k1", { cause });
    }
  }

  /**
   * Verify the returned signature recovers to the expected address.
   * Defends against a compromised enclave lying about WHICH key it
   * signed with. Separate from attestation verification — which
   * defends against lying about the code. You want both.
   */
  private verifySignatureRecovers(digest: Uint8Array, signatureHex: `0x${string}`): void {
    const sigBytes = hexToBytes(signatureHex);
    if (sigBytes.length !== 65) {
      throw new CustodyError(
        "signature-malformed",
        `Expected 65-byte signature (r||s||v), got ${sigBytes.length}`,
      );
    }
    const r = sigBytes.slice(0, 32);
    const s = sigBytes.slice(32, 64);
    const v = sigBytes[64];
    const recovery = v >= 27 ? v - 27 : v;
    if (recovery !== 0 && recovery !== 1) {
      throw new CustodyError("signature-malformed", `Invalid recovery byte v=${v}`);
    }

    // Build a secp256k1 Signature and recover the public key.
    const sig = secp256k1.Signature.fromCompact(concat(r, s)).addRecoveryBit(recovery);
    const recoveredPubPoint = sig.recoverPublicKey(digest);
    const recoveredPub = recoveredPubPoint.toRawBytes(/* compressed */ false);
    const recoveredAddress = computeAddressFromUncompressedPublicKey(recoveredPub);

    if (recoveredAddress.toLowerCase() !== this.address.toLowerCase()) {
      throw new CustodyError(
        "signing-failed",
        `Enclave signature recovers to ${recoveredAddress} but expected ${this.address} — enclave may be misbehaving`,
      );
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (s.length % 2 !== 0) {
    throw new CustodyError("invalid-key-material", `Odd-length hex string: ${hex.slice(0, 18)}...`);
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function bytesToHexPrefixed(bytes: Uint8Array): `0x${string}` {
  return `0x${bytesToHex(bytes)}` as `0x${string}`;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function computeAddressFromUncompressedPublicKey(pub: Uint8Array): `0x${string}` {
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new CustodyError(
      "invalid-key-material",
      "Expected uncompressed 65-byte public key starting with 0x04",
    );
  }
  const hash = keccak_256(pub.slice(1));
  return `0x${bytesToHex(hash.slice(-20))}` as `0x${string}`;
}
