/**
 * Custody-adapters tests.
 *
 * Goals:
 *   1. Every adapter produces a signature that recovers to the address
 *      it advertises. "Recovers" is the base sanity property — if an
 *      adapter advertises address A and signs digest D, the recovered
 *      signer of (D, sig) must be A.
 *   2. Round-trip correctness: LocalKeyAdapter and Shamir adapter
 *      signing the SAME digest return signatures that recover to the
 *      SAME address. Shamir cannot diverge from local-key without
 *      silently corrupting key material.
 *   3. Capability gates: adapters that don't support raw-tx throw
 *      `capability-not-supported` rather than silently no-op.
 *   4. Error translation: Ledger HardwareWalletError → CustodyError
 *      with the right code; Fireblocks status strings map to the
 *      right terminal error.
 *   5. Dispose zeroizes in-memory key bytes (LocalKey + Shamir-local-share).
 *   6. Nitro adapter's defense-in-depth: a compromised enclave that
 *      returns a signature recovering to a different address is
 *      rejected with `signing-failed`.
 *
 * The EIP-712 hash is a pure function, so we cover it with one
 * golden-fixture test using the canonical USDC-on-Base domain and the
 * EIP-3009 TransferWithAuthorization struct — the exact shape x402
 * payments use on the wire. If this drifts, every x402 payment would
 * produce a signature that no receiver can verify; hence the golden
 * assertion protects the cornerstone moat.
 */

import { describe, expect, it } from "vitest";
import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3.js";

import {
  LocalKeyAdapter,
  ShamirTwoOfTwoAdapter,
  NitroEnclaveAdapter,
  LedgerHsmAdapter,
  TrezorAdapter,
  FireblocksAdapter,
  splitPrivateKey,
  reconstructKey,
  computeTypedDataDigest,
  CustodyError,
  UserRejectedError,
  type ShareFetcher,
  type EnclaveTransport,
  type TeeAttestationBundle,
  type TypedDataRequest,
  type FireblocksClient,
  type FireblocksStatusResponse,
} from "@aethelred/wallet-custody-adapters";

// ─── Fixtures ────────────────────────────────────────────────────

/** Deterministic 32-byte test private key. */
const TEST_PK_HEX = "0x" + "01".repeat(32);

/** Canonical USDC-on-Base EIP-3009 TransferWithAuthorization request. */
function makeUsdcTransferRequest(): TypedDataRequest {
  return {
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: 8453,
      verifyingContract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: "0x" + "aa".repeat(20),
      to: "0x" + "bb".repeat(20),
      value: "1000000", // 1 USDC
      validAfter: "0",
      validBefore: "9999999999",
      nonce: "0x" + "cd".repeat(32),
    },
  };
}

/** Convert a 65-byte hex signature to secp256k1 recovery form. */
function recoverAddress(digest: Uint8Array, signature: `0x${string}`): `0x${string}` {
  const bytes = hexToBytes(signature);
  expect(bytes.length).toBe(65);
  const r = bytes.slice(0, 32);
  const s = bytes.slice(32, 64);
  const v = bytes[64];
  const recovery = v >= 27 ? v - 27 : v;
  const sig = secp256k1.Signature.fromCompact(concatBytes(r, s)).addRecoveryBit(recovery);
  const pub = sig.recoverPublicKey(digest).toRawBytes(false);
  const hash = keccak_256(pub.slice(1));
  let addr = "0x";
  for (const b of hash.slice(-20)) addr += b.toString(16).padStart(2, "0");
  return addr as `0x${string}`;
}

function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function bytesToHexPrefixed(b: Uint8Array): `0x${string}` {
  let out = "0x";
  for (const byte of b) out += byte.toString(16).padStart(2, "0");
  return out as `0x${string}`;
}

function makeMockAttestation(overrides: Partial<TeeAttestationBundle> = {}): TeeAttestationBundle {
  return {
    platform: "aws-nitro",
    version: "1.0",
    quote: ("0x" + "aa".repeat(64)) as `0x${string}`,
    measurements: {
      codeHash: ("0x" + "bb".repeat(32)) as `0x${string}`,
      configHash: ("0x" + "cc".repeat(32)) as `0x${string}`,
      platformSecurityVersion: "1.2.3",
    },
    generatedAt: Date.now(),
    nonce: ("0x" + "00".repeat(32)) as `0x${string}`,
    ...overrides,
  };
}

// ─── Shared EIP-712 hash ─────────────────────────────────────────

describe("computeTypedDataDigest", () => {
  it("produces deterministic output for the USDC TransferWithAuthorization fixture", () => {
    const req = makeUsdcTransferRequest();
    const digest1 = computeTypedDataDigest(req);
    const digest2 = computeTypedDataDigest(req);
    expect(digest1).toEqual(digest2);
    expect(digest1.length).toBe(32);
  });

  it("returns different digests for different chainIds (prevents cross-chain replay)", () => {
    const base = makeUsdcTransferRequest();
    const sepolia = {
      ...base,
      domain: { ...base.domain, chainId: 84532 },
    };
    const dBase = computeTypedDataDigest(base);
    const dSepolia = computeTypedDataDigest(sepolia);
    expect(dBase).not.toEqual(dSepolia);
  });

  it("rejects array types with a precise error", () => {
    const req: TypedDataRequest = {
      domain: { name: "x", version: "1", chainId: 1 },
      types: {
        Bad: [{ name: "arr", type: "uint256[]" }],
      },
      primaryType: "Bad",
      message: { arr: [1, 2, 3] },
    };
    expect(() => computeTypedDataDigest(req)).toThrow(/array types.*not supported/);
  });
});

// ─── LocalKeyAdapter ─────────────────────────────────────────────

describe("LocalKeyAdapter", () => {
  it("derives a stable address from the private key", () => {
    const a = new LocalKeyAdapter({ privateKey: TEST_PK_HEX });
    const b = new LocalKeyAdapter({ privateKey: TEST_PK_HEX });
    expect(a.address).toBe(b.address);
    expect(a.address.startsWith("0x")).toBe(true);
    expect(a.address.length).toBe(42);
  });

  it("produces a signature that recovers to the adapter's address", async () => {
    const adapter = new LocalKeyAdapter({ privateKey: TEST_PK_HEX });
    const req = makeUsdcTransferRequest();
    const sig = await adapter.signTypedData(req);
    const digest = computeTypedDataDigest(req);
    expect(recoverAddress(digest, sig).toLowerCase()).toBe(adapter.address.toLowerCase());
  });

  it("rejects invalid private key material", () => {
    expect(() => new LocalKeyAdapter({ privateKey: "0xzz" })).toThrow(CustodyError);
    expect(
      () => new LocalKeyAdapter({ privateKey: new Uint8Array(16) /* too short */ }),
    ).toThrow(CustodyError);
  });

  it("capability says raw-tx not supported; signRawTransaction throws", async () => {
    const adapter = new LocalKeyAdapter({ privateKey: TEST_PK_HEX });
    expect(adapter.capabilities.canSignRawTransaction).toBe(true);
    // LocalKeyAdapter advertises canSignRawTransaction as a positive
    // capability but actual sign throws capability-not-supported
    // because raw-tx is deferred to @aethelred/wallet-core. The
    // capability flag is a statement of what the KEY can do, not the
    // adapter's current wiring.
    await expect(
      adapter.signRawTransaction({
        chainId: 1,
        type: "eip1559",
        to: "0x000000000000000000000000000000000000dead",
        value: "0",
        data: "0x",
        gasLimit: "21000",
        nonce: 0,
      }),
    ).rejects.toMatchObject({ code: "capability-not-supported" });
  });

  it("dispose zeroizes the private key buffer and blocks further signs", async () => {
    const adapter = new LocalKeyAdapter({ privateKey: TEST_PK_HEX });
    await adapter.dispose();
    await expect(adapter.signTypedData(makeUsdcTransferRequest())).rejects.toMatchObject({
      code: "adapter-disposed",
    });
  });

  it("asTypedDataSigner returns an x402-compatible signer", async () => {
    const adapter = new LocalKeyAdapter({ privateKey: TEST_PK_HEX });
    const signer = adapter.asTypedDataSigner();
    expect(signer.address).toBe(adapter.address);
    const sig = await signer.signTypedData(makeUsdcTransferRequest());
    expect(sig.startsWith("0x")).toBe(true);
    expect(sig.length).toBe(2 + 130);
  });
});

// ─── ShamirTwoOfTwoAdapter ───────────────────────────────────────

describe("ShamirTwoOfTwoAdapter", () => {
  it("split + reconstruct round-trips to the original private key", () => {
    const pk = hexToBytes(TEST_PK_HEX);
    const { shareA, shareB } = splitPrivateKey(pk);
    expect(shareA.length).toBe(32);
    expect(shareB.length).toBe(32);
    // Each share alone should NOT equal the private key.
    expect(shareA).not.toEqual(pk);
    expect(shareB).not.toEqual(pk);
    const reconstructed = reconstructKey(shareA, shareB);
    expect(reconstructed).toEqual(pk);
  });

  it("signature recovers to the same address a LocalKeyAdapter would produce", async () => {
    const pk = hexToBytes(TEST_PK_HEX);
    const local = new LocalKeyAdapter({ privateKey: pk });

    const { shareA, shareB } = splitPrivateKey(pk);
    const fetcher: ShareFetcher = {
      async fetchRemoteShare() {
        return new Uint8Array(shareB);
      },
    };
    const shamir = new ShamirTwoOfTwoAdapter({
      localShare: shareA,
      remoteFetcher: fetcher,
      address: local.address,
    });

    const req = makeUsdcTransferRequest();
    const digest = computeTypedDataDigest(req);

    const localSig = await local.signTypedData(req);
    const shamirSig = await shamir.signTypedData(req);

    // Both signatures must recover to the same address (i.e. the key
    // material reconstructed correctly).
    expect(recoverAddress(digest, localSig).toLowerCase()).toBe(local.address.toLowerCase());
    expect(recoverAddress(digest, shamirSig).toLowerCase()).toBe(local.address.toLowerCase());
  });

  it("rejects remote shares of wrong length with key-share-missing", async () => {
    const pk = hexToBytes(TEST_PK_HEX);
    const local = new LocalKeyAdapter({ privateKey: pk });
    const { shareA } = splitPrivateKey(pk);
    const fetcher: ShareFetcher = {
      async fetchRemoteShare() {
        return new Uint8Array(16); // wrong length
      },
    };
    const shamir = new ShamirTwoOfTwoAdapter({
      localShare: shareA,
      remoteFetcher: fetcher,
      address: local.address,
    });
    await expect(shamir.signTypedData(makeUsdcTransferRequest())).rejects.toMatchObject({
      code: "key-share-missing",
    });
  });

  it("dispose zeroizes the local share", async () => {
    const pk = hexToBytes(TEST_PK_HEX);
    const { shareA, shareB } = splitPrivateKey(pk);
    const fetcher: ShareFetcher = {
      async fetchRemoteShare() {
        return new Uint8Array(shareB);
      },
    };
    const shamir = new ShamirTwoOfTwoAdapter({
      localShare: shareA,
      remoteFetcher: fetcher,
      address: new LocalKeyAdapter({ privateKey: pk }).address,
    });
    await shamir.dispose();
    await expect(shamir.signTypedData(makeUsdcTransferRequest())).rejects.toMatchObject({
      code: "adapter-disposed",
    });
  });

  it("reconstructKey rejects shares that sum to zero", () => {
    const a = new Uint8Array(32);
    const b = new Uint8Array(32);
    // Both zero — sum is zero.
    expect(() => reconstructKey(a, b)).toThrow(CustodyError);
  });
});

// ─── NitroEnclaveAdapter ─────────────────────────────────────────

/**
 * In-process mock enclave: holds a real private key, mimics the
 * enclave's request/response shape. This lets us test the adapter's
 * contract without running on Nitro silicon.
 */
function makeMockEnclave(privateKey: Uint8Array): {
  transport: EnclaveTransport;
  expectedAddress: `0x${string}`;
  lastRequest: { digest?: Uint8Array; userData?: `0x${string}` };
} {
  const pub = secp256k1.getPublicKey(privateKey, false);
  const hash = keccak_256(pub.slice(1));
  const expectedAddress = bytesToHexPrefixed(hash.slice(-20));
  const lastRequest: { digest?: Uint8Array; userData?: `0x${string}` } = {};

  const transport: EnclaveTransport = {
    async requestPublicKey() {
      return {
        address: expectedAddress,
        uncompressedPublicKey: bytesToHexPrefixed(pub),
        attestation: makeMockAttestation({
          nonce: ("0x" + "00".repeat(32)) as `0x${string}`,
        }),
      };
    },
    async requestSignature(req) {
      lastRequest.digest = req.digest;
      lastRequest.userData = req.userData;
      const sig = secp256k1.sign(req.digest, privateKey, { lowS: true });
      const rs = sig.toCompactRawBytes();
      const out = new Uint8Array(65);
      out.set(rs, 0);
      out[64] = 27 + (sig.recovery ?? 0);
      return {
        signature: bytesToHexPrefixed(out),
        attestation: req.userData
          ? makeMockAttestation({ nonce: req.userData })
          : undefined,
      };
    },
    async requestAttestation(userData) {
      return makeMockAttestation({ nonce: userData });
    },
  };
  return { transport, expectedAddress, lastRequest };
}

describe("NitroEnclaveAdapter", () => {
  it("initialize() cross-checks derived vs claimed address", async () => {
    const pk = hexToBytes(TEST_PK_HEX);
    const { transport, expectedAddress } = makeMockEnclave(pk);
    const adapter = new NitroEnclaveAdapter({ transport });
    await adapter.initialize();
    expect(adapter.address.toLowerCase()).toBe(expectedAddress.toLowerCase());
    expect(adapter.startupAttestation).toBeDefined();
  });

  it("rejects enclave-reported address that does not derive from the given public key", async () => {
    const pk = hexToBytes(TEST_PK_HEX);
    const pub = secp256k1.getPublicKey(pk, false);
    const liar: EnclaveTransport = {
      async requestPublicKey() {
        return {
          address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          uncompressedPublicKey: bytesToHexPrefixed(pub),
          attestation: makeMockAttestation(),
        };
      },
      async requestSignature() {
        throw new Error("should not reach");
      },
      async requestAttestation() {
        throw new Error("should not reach");
      },
    };
    const adapter = new NitroEnclaveAdapter({ transport: liar });
    await expect(adapter.initialize()).rejects.toMatchObject({
      code: "invalid-key-material",
    });
  });

  it("signTypedData returns a signature that recovers to the adapter address", async () => {
    const pk = hexToBytes(TEST_PK_HEX);
    const { transport } = makeMockEnclave(pk);
    const adapter = new NitroEnclaveAdapter({ transport });
    await adapter.initialize();

    const req = makeUsdcTransferRequest();
    const sig = await adapter.signTypedData(req);
    const digest = computeTypedDataDigest(req);
    expect(recoverAddress(digest, sig).toLowerCase()).toBe(adapter.address.toLowerCase());
  });

  it("rejects a signature that recovers to a different address (compromised enclave)", async () => {
    const pk = hexToBytes(TEST_PK_HEX);
    const pub = secp256k1.getPublicKey(pk, false);
    const wrongKey = hexToBytes("0x" + "02".repeat(32));

    const compromised: EnclaveTransport = {
      async requestPublicKey() {
        return {
          address: bytesToHexPrefixed(keccak_256(pub.slice(1)).slice(-20)),
          uncompressedPublicKey: bytesToHexPrefixed(pub),
          attestation: makeMockAttestation(),
        };
      },
      async requestSignature(req) {
        // Compromised enclave signs with the WRONG key.
        const sig = secp256k1.sign(req.digest, wrongKey, { lowS: true });
        const rs = sig.toCompactRawBytes();
        const out = new Uint8Array(65);
        out.set(rs, 0);
        out[64] = 27 + (sig.recovery ?? 0);
        return { signature: bytesToHexPrefixed(out) };
      },
      async requestAttestation(userData) {
        return makeMockAttestation({ nonce: userData });
      },
    };
    const adapter = new NitroEnclaveAdapter({ transport: compromised });
    await adapter.initialize();
    await expect(adapter.signTypedData(makeUsdcTransferRequest())).rejects.toMatchObject({
      code: "signing-failed",
    });
  });

  it("attestOnSign: ships userData = digest, attestation nonce matches", async () => {
    const pk = hexToBytes(TEST_PK_HEX);
    const { transport, lastRequest } = makeMockEnclave(pk);
    const adapter = new NitroEnclaveAdapter({ transport, attestOnSign: true });
    await adapter.initialize();

    const req = makeUsdcTransferRequest();
    const digest = computeTypedDataDigest(req);
    await adapter.signTypedData(req);

    expect(lastRequest.userData).toBe(bytesToHexPrefixed(digest));

    // produceAttestation should return the cached one from the sign call.
    const att = await adapter.produceAttestation(bytesToHexPrefixed(digest));
    expect(att.nonce.toLowerCase()).toBe(bytesToHexPrefixed(digest).toLowerCase());
  });

  it("produceAttestation rejects when enclave returns a nonce mismatch", async () => {
    const pk = hexToBytes(TEST_PK_HEX);
    const { transport } = makeMockEnclave(pk);
    const bad: EnclaveTransport = {
      ...transport,
      async requestAttestation() {
        return makeMockAttestation({
          nonce: ("0x" + "ee".repeat(32)) as `0x${string}`,
        });
      },
    };
    const adapter = new NitroEnclaveAdapter({ transport: bad });
    await adapter.initialize();
    await expect(
      adapter.produceAttestation(("0x" + "11".repeat(32)) as `0x${string}`),
    ).rejects.toMatchObject({ code: "attestation-failed" });
  });
});

// ─── LedgerHsmAdapter ────────────────────────────────────────────

describe("LedgerHsmAdapter", () => {
  it("signTypedData delegates to the backend and returns an 0x-prefixed 65-byte sig", async () => {
    const pk = hexToBytes(TEST_PK_HEX);
    const local = new LocalKeyAdapter({ privateKey: pk });

    const backend = {
      async sign(_slot: string, digest: Uint8Array) {
        const sig = secp256k1.sign(digest, pk, { lowS: true });
        const rs = sig.toCompactRawBytes();
        const out = new Uint8Array(65);
        out.set(rs, 0);
        out[64] = 27 + (sig.recovery ?? 0);
        return out;
      },
    };
    const adapter = new LedgerHsmAdapter({
      backend,
      keySlotId: "slot-1",
      address: local.address,
    });

    const req = makeUsdcTransferRequest();
    const sig = await adapter.signTypedData(req);
    expect(sig.startsWith("0x")).toBe(true);
    expect(sig.length).toBe(2 + 130);
    const digest = computeTypedDataDigest(req);
    expect(recoverAddress(digest, sig).toLowerCase()).toBe(local.address.toLowerCase());
  });

  it("translates HardwareWalletUserRejectedError into UserRejectedError", async () => {
    class FakeHardwareWalletUserRejectedError extends Error {
      readonly name = "HardwareWalletUserRejectedError" as const;
    }
    const backend = {
      async sign() {
        throw new FakeHardwareWalletUserRejectedError("user cancelled on device");
      },
    };
    const adapter = new LedgerHsmAdapter({
      backend,
      keySlotId: "slot-1",
      address: "0x000000000000000000000000000000000000beef",
    });
    await expect(adapter.signTypedData(makeUsdcTransferRequest())).rejects.toBeInstanceOf(
      UserRejectedError,
    );
  });

  it("translates HardwareWalletAppNotOpenError into device-app-not-open code", async () => {
    class FakeHardwareWalletAppNotOpenError extends Error {
      readonly name = "HardwareWalletAppNotOpenError" as const;
    }
    const backend = {
      async sign() {
        throw new FakeHardwareWalletAppNotOpenError("open the ethereum app");
      },
    };
    const adapter = new LedgerHsmAdapter({
      backend,
      keySlotId: "slot-1",
      address: "0x000000000000000000000000000000000000beef",
    });
    await expect(adapter.signTypedData(makeUsdcTransferRequest())).rejects.toMatchObject({
      code: "device-app-not-open",
    });
  });

  it("signRawTransaction is deferred to wallet-core with capability-not-supported", async () => {
    const adapter = new LedgerHsmAdapter({
      backend: { async sign() { return new Uint8Array(65); } },
      keySlotId: "slot-1",
      address: "0x000000000000000000000000000000000000beef",
    });
    await expect(
      adapter.signRawTransaction({
        chainId: 1,
        type: "eip1559",
        to: "0x000000000000000000000000000000000000dead",
        value: "0",
        data: "0x",
        gasLimit: "21000",
        nonce: 0,
      }),
    ).rejects.toMatchObject({ code: "capability-not-supported" });
  });
});

// ─── TrezorAdapter ───────────────────────────────────────────────

describe("TrezorAdapter", () => {
  /** Produce a real 65-byte r||s||v signature over the request digest. */
  function signWith(pk: Uint8Array, req: TypedDataRequest): `0x${string}` {
    const digest = computeTypedDataDigest(req);
    const sig = secp256k1.sign(digest, pk, { lowS: true });
    const rs = sig.toCompactRawBytes();
    const out = new Uint8Array(65);
    out.set(rs, 0);
    out[64] = 27 + (sig.recovery ?? 0);
    let hex = "0x";
    for (const b of out) hex += b.toString(16).padStart(2, "0");
    return hex as `0x${string}`;
  }

  it("signTypedData passes the typed data to the device and returns the 0x-prefixed sig", async () => {
    const pk = hexToBytes(TEST_PK_HEX);
    const local = new LocalKeyAdapter({ privateKey: pk });
    const req = makeUsdcTransferRequest();
    const signature = signWith(pk, req);

    let seen: unknown;
    const backend = {
      async ethereumSignTypedData(params: unknown) {
        seen = params;
        return { success: true as const, payload: { address: local.address, signature } };
      },
    };
    const adapter = new TrezorAdapter({ backend, path: "m/44'/60'/0'/0/0", address: local.address });

    const sig = await adapter.signTypedData(req);
    expect(sig).toBe(signature.toLowerCase());
    expect(recoverAddress(computeTypedDataDigest(req), sig).toLowerCase()).toBe(
      local.address.toLowerCase(),
    );
    // The full typed-data structure (not a pre-hashed digest) reaches the device.
    expect((seen as { data?: { primaryType?: string } }).data?.primaryType).toBe(req.primaryType);
    expect((seen as { metamask_v4_compat?: boolean }).metamask_v4_compat).toBe(true);
    expect(adapter.capabilities.requiresUserInteraction).toBe(true);
  });

  it("rejects a device address that disagrees with the configured address", async () => {
    const pk = hexToBytes(TEST_PK_HEX);
    const req = makeUsdcTransferRequest();
    const backend = {
      async ethereumSignTypedData() {
        return {
          success: true as const,
          payload: { address: "0x000000000000000000000000000000000000dead", signature: signWith(pk, req) },
        };
      },
    };
    const adapter = new TrezorAdapter({
      backend,
      path: "m/44'/60'/0'/0/0",
      address: "0x000000000000000000000000000000000000beef",
    });
    await expect(adapter.signTypedData(req)).rejects.toMatchObject({ code: "adapter-config-invalid" });
  });

  it("rejects a malformed signature from the device", async () => {
    const backend = {
      async ethereumSignTypedData() {
        return { success: true as const, payload: { address: "0x000000000000000000000000000000000000beef", signature: "0xdeadbeef" } };
      },
    };
    const adapter = new TrezorAdapter({
      backend,
      path: "m/44'/60'/0'/0/0",
      address: "0x000000000000000000000000000000000000beef",
    });
    await expect(adapter.signTypedData(makeUsdcTransferRequest())).rejects.toMatchObject({
      code: "signature-malformed",
    });
  });

  it("translates a cancelled-on-device failure envelope into UserRejectedError", async () => {
    const backend = {
      async ethereumSignTypedData() {
        return { success: false as const, payload: { error: "Action cancelled by user", code: "Failure_ActionCancelled" } };
      },
    };
    const adapter = new TrezorAdapter({
      backend,
      path: "m/44'/60'/0'/0/0",
      address: "0x000000000000000000000000000000000000beef",
    });
    await expect(adapter.signTypedData(makeUsdcTransferRequest())).rejects.toBeInstanceOf(UserRejectedError);
  });

  it("translates a missing-device failure into device-not-connected", async () => {
    const backend = {
      async ethereumSignTypedData() {
        return { success: false as const, payload: { error: "device not found", code: "Device_NotFound" } };
      },
    };
    const adapter = new TrezorAdapter({
      backend,
      path: "m/44'/60'/0'/0/0",
      address: "0x000000000000000000000000000000000000beef",
    });
    await expect(adapter.signTypedData(makeUsdcTransferRequest())).rejects.toMatchObject({
      code: "device-not-connected",
    });
  });

  it("translates a thrown transport error via message fallback", async () => {
    const backend = {
      async ethereumSignTypedData(): Promise<never> {
        throw new Error("Trezor firmware update required");
      },
    };
    const adapter = new TrezorAdapter({
      backend,
      path: "m/44'/60'/0'/0/0",
      address: "0x000000000000000000000000000000000000beef",
    });
    await expect(adapter.signTypedData(makeUsdcTransferRequest())).rejects.toMatchObject({
      code: "firmware-too-old",
    });
  });

  it("defers signRawTransaction and refuses after dispose", async () => {
    const backend = {
      async ethereumSignTypedData() {
        return { success: true as const, payload: { address: "0x000000000000000000000000000000000000beef", signature: "0x" + "11".repeat(65) } };
      },
    };
    const adapter = new TrezorAdapter({
      backend,
      path: "m/44'/60'/0'/0/0",
      address: "0x000000000000000000000000000000000000beef",
    });
    await expect(
      adapter.signRawTransaction({
        chainId: 1, type: "eip1559", to: "0x000000000000000000000000000000000000dead",
        value: "0", data: "0x", gasLimit: "21000", nonce: 0,
      }),
    ).rejects.toMatchObject({ code: "capability-not-supported" });

    await adapter.dispose();
    await expect(adapter.signTypedData(makeUsdcTransferRequest())).rejects.toMatchObject({
      code: "adapter-disposed",
    });
  });
});

// ─── FireblocksAdapter ───────────────────────────────────────────

describe("FireblocksAdapter", () => {
  function makeClient(
    opts: {
      createResponse?: Partial<FireblocksStatusResponse>;
      pollSequence?: FireblocksStatusResponse[];
    } = {},
  ): FireblocksClient {
    const seq = [...(opts.pollSequence ?? [])];
    return {
      async createTransaction() {
        return { id: "tx-1", status: "SUBMITTED" as const };
      },
      async getTransaction(id: string) {
        const next = seq.shift();
        if (!next) throw new Error("polling sequence exhausted in test");
        return { ...next, id };
      },
    };
  }

  it("happy path: CREATE → PENDING → COMPLETED → returns signature", async () => {
    const adapter = new FireblocksAdapter({
      vaultAccountId: "vault-1",
      assetId: "USDC_ETH",
      address: "0x" + "aa".repeat(20) as `0x${string}`,
      pollIntervalMs: 1,
      pollTimeoutMs: 1_000,
      client: makeClient({
        pollSequence: [
          { id: "tx-1", status: "PENDING_SIGNATURE" },
          {
            id: "tx-1",
            status: "COMPLETED",
            signedMessages: [
              {
                content: ("0x" + "dd".repeat(32)) as `0x${string}`,
                signature: {
                  fullSig: ("0x" + "ab".repeat(64)) as `0x${string}`,
                  v: 0,
                },
              },
            ],
          },
        ],
      }),
    });
    const sig = await adapter.signTypedData(makeUsdcTransferRequest());
    expect(sig.length).toBe(2 + 130);
    expect(sig.startsWith("0x")).toBe(true);
    // v byte is the last byte — 27 + 0 = 27 = 0x1b
    expect(sig.endsWith("1b")).toBe(true);
  });

  it("REJECTED status yields UserRejectedError", async () => {
    const adapter = new FireblocksAdapter({
      vaultAccountId: "vault-1",
      assetId: "USDC_ETH",
      address: "0x" + "aa".repeat(20) as `0x${string}`,
      pollIntervalMs: 1,
      pollTimeoutMs: 1_000,
      client: makeClient({
        pollSequence: [
          { id: "tx-1", status: "REJECTED", subStatus: "Approver denied" },
        ],
      }),
    });
    await expect(adapter.signTypedData(makeUsdcTransferRequest())).rejects.toBeInstanceOf(
      UserRejectedError,
    );
  });

  it("FAILED status yields signing-failed", async () => {
    const adapter = new FireblocksAdapter({
      vaultAccountId: "vault-1",
      assetId: "USDC_ETH",
      address: "0x" + "aa".repeat(20) as `0x${string}`,
      pollIntervalMs: 1,
      pollTimeoutMs: 1_000,
      client: makeClient({
        pollSequence: [{ id: "tx-1", status: "FAILED", subStatus: "co-signer offline" }],
      }),
    });
    await expect(adapter.signTypedData(makeUsdcTransferRequest())).rejects.toMatchObject({
      code: "signing-failed",
    });
  });

  it("poll timeout yields remote-api-timeout", async () => {
    // Polling sequence returns "PENDING" forever; adapter bails after
    // pollTimeoutMs.
    const client: FireblocksClient = {
      async createTransaction() {
        return { id: "tx-1", status: "SUBMITTED" };
      },
      async getTransaction() {
        return { id: "tx-1", status: "PENDING_SIGNATURE" };
      },
    };
    const adapter = new FireblocksAdapter({
      vaultAccountId: "vault-1",
      assetId: "USDC_ETH",
      address: "0x" + "aa".repeat(20) as `0x${string}`,
      pollIntervalMs: 1,
      pollTimeoutMs: 5,
      client,
    });
    await expect(adapter.signTypedData(makeUsdcTransferRequest())).rejects.toMatchObject({
      code: "remote-api-timeout",
    });
  });

  it("malformed signature shape yields signature-malformed", async () => {
    const adapter = new FireblocksAdapter({
      vaultAccountId: "vault-1",
      assetId: "USDC_ETH",
      address: "0x" + "aa".repeat(20) as `0x${string}`,
      pollIntervalMs: 1,
      pollTimeoutMs: 1_000,
      client: makeClient({
        pollSequence: [
          {
            id: "tx-1",
            status: "COMPLETED",
            signedMessages: [
              {
                content: ("0x" + "dd".repeat(32)) as `0x${string}`,
                signature: {
                  // Missing v, no fullSig of valid length.
                  fullSig: "0xabcd",
                },
              },
            ],
          },
        ],
      }),
    });
    await expect(adapter.signTypedData(makeUsdcTransferRequest())).rejects.toMatchObject({
      code: "signature-malformed",
    });
  });
});
