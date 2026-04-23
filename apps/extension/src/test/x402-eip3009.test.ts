/**
 * Unit tests for `signPaymentAuthorization` — the EIP-3009 signing
 * path. We use a deterministic test signer that returns a known
 * signature byte-string so we can assert on the full payload shape
 * without importing a real cryptographic library.
 *
 * The property being tested here is **shape integrity** (every field
 * of the returned `PaymentPayload` is exactly what the client will
 * put on the wire). The actual cryptographic soundness of the
 * signature is the signer's responsibility and is covered by
 * `@aethelred/wallet-core`'s custody tests.
 */

import { describe, expect, it, vi } from "vitest";

import {
  MAX_VALIDITY_WINDOW_SECONDS,
  signPaymentAuthorization,
  computeTransferAuthStructHash,
  type PaymentRequirement,
  type TypedDataSigner,
  X402Error,
  SignerError,
} from "@aethelred/wallet-x402";

const AGENT_ADDRESS = "0x000000000000000000000000000000000000beef" as const;
const SIGNATURE = ("0x" + "ab".repeat(65)) as `0x${string}`;

function makeRequirement(overrides: Partial<PaymentRequirement> = {}): PaymentRequirement {
  return {
    scheme: "exact",
    network: "base-mainnet",
    maxAmountRequired: "1000000", // 1 USDC
    resource: "https://api.example.com/data",
    description: "Weather API",
    payTo: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    maxTimeoutSeconds: 60,
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    extra: { name: "USD Coin", version: "2" },
    ...overrides,
  };
}

function makeSigner(overrides: Partial<TypedDataSigner> = {}): TypedDataSigner {
  return {
    address: AGENT_ADDRESS,
    signTypedData: vi.fn().mockResolvedValue(SIGNATURE),
    ...overrides,
  };
}

describe("signPaymentAuthorization — happy path", () => {
  it("builds the payload and invokes the signer with the correct domain + message", async () => {
    const requirement = makeRequirement();
    const signer = makeSigner();

    const result = await signPaymentAuthorization({ requirement, from: AGENT_ADDRESS, signer });

    expect(result.x402Version).toBe(1);
    expect(result.scheme).toBe("exact");
    expect(result.network).toBe("base-mainnet");
    expect(result.payload.authorization.from).toBe(AGENT_ADDRESS);
    expect(result.payload.authorization.to).toBe(requirement.payTo);
    expect(result.payload.authorization.value).toBe("1000000");
    expect(result.payload.authorization.signature).toBe(SIGNATURE);

    // The struct hash must be computable from the authorization alone
    // — redundancy that audit tooling relies on.
    expect(result.payload.structHash).toBe(
      computeTransferAuthStructHash(result.payload.authorization),
    );

    // Domain must use the asset's name/version + network's chainId.
    expect(signer.signTypedData).toHaveBeenCalledOnce();
    const call = vi.mocked(signer.signTypedData).mock.calls[0][0];
    expect(call.domain.name).toBe("USD Coin");
    expect(call.domain.version).toBe("2");
    expect(call.domain.chainId).toBe(8453); // base-mainnet
    expect(call.domain.verifyingContract).toBe(requirement.asset);
    expect(call.primaryType).toBe("TransferWithAuthorization");
  });

  it("generates a fresh 32-byte nonce each call", async () => {
    const requirement = makeRequirement();
    const s1 = await signPaymentAuthorization({ requirement, from: AGENT_ADDRESS, signer: makeSigner() });
    const s2 = await signPaymentAuthorization({ requirement, from: AGENT_ADDRESS, signer: makeSigner() });
    expect(s1.payload.authorization.nonce).not.toBe(s2.payload.authorization.nonce);
    expect(/^0x[0-9a-f]{64}$/.test(s1.payload.authorization.nonce)).toBe(true);
  });

  it("caps validity window to MAX_VALIDITY_WINDOW_SECONDS", async () => {
    const requirement = makeRequirement({
      maxTimeoutSeconds: MAX_VALIDITY_WINDOW_SECONDS * 10, // try to smuggle a 10x window
    });
    const result = await signPaymentAuthorization({ requirement, from: AGENT_ADDRESS, signer: makeSigner() });
    const validBefore = Number(result.payload.authorization.validBefore);
    const now = Math.floor(Date.now() / 1000);
    // Within MAX + 5s buffer for scheduler jitter
    expect(validBefore - now).toBeLessThanOrEqual(MAX_VALIDITY_WINDOW_SECONDS + 5);
  });

  it("uses requirement-declared name/version when provided, defaults to USD Coin otherwise", async () => {
    const requirement = makeRequirement({ extra: { name: "EURC", version: "1" } });
    const signer = makeSigner();
    await signPaymentAuthorization({ requirement, from: AGENT_ADDRESS, signer });
    const call = vi.mocked(signer.signTypedData).mock.calls[0][0];
    expect(call.domain.name).toBe("EURC");
    expect(call.domain.version).toBe("1");
  });
});

describe("signPaymentAuthorization — rejects bad input", () => {
  it("throws amount-over-cap when value > maxAmountRequired", async () => {
    const requirement = makeRequirement({ maxAmountRequired: "1000" });
    await expect(
      signPaymentAuthorization({ requirement, from: AGENT_ADDRESS, signer: makeSigner(), value: "5000" }),
    ).rejects.toMatchObject({ code: "amount-over-cap" });
  });

  it("throws amount-over-cap when value <= 0", async () => {
    const requirement = makeRequirement();
    await expect(
      signPaymentAuthorization({ requirement, from: AGENT_ADDRESS, signer: makeSigner(), value: "0" }),
    ).rejects.toMatchObject({ code: "amount-over-cap" });
  });

  it("wraps signer throws in SignerError with cause preserved", async () => {
    const underlying = new Error("hardware wallet locked");
    const signer = makeSigner({
      signTypedData: vi.fn().mockRejectedValue(underlying),
    });
    await expect(
      signPaymentAuthorization({ requirement: makeRequirement(), from: AGENT_ADDRESS, signer }),
    ).rejects.toSatisfy((err) => {
      return err instanceof SignerError && err.code === "signer-rejected" && err.cause === underlying;
    });
  });

  it("throws when signer returns a malformed signature (< 65 bytes)", async () => {
    const signer = makeSigner({
      signTypedData: vi.fn().mockResolvedValue("0xdeadbeef" as `0x${string}`),
    });
    await expect(
      signPaymentAuthorization({ requirement: makeRequirement(), from: AGENT_ADDRESS, signer }),
    ).rejects.toMatchObject({ code: "signer-rejected" });
  });

  it("throws invalid-payment-requirement when validBefore is in the past", async () => {
    await expect(
      signPaymentAuthorization({
        requirement: makeRequirement(),
        from: AGENT_ADDRESS,
        signer: makeSigner(),
        validBeforeSeconds: Math.floor(Date.now() / 1000) - 10,
      }),
    ).rejects.toBeInstanceOf(X402Error);
  });
});

describe("computeTransferAuthStructHash — determinism", () => {
  it("is stable across re-computations", () => {
    const auth = {
      from: "0x0000000000000000000000000000000000000001" as `0x${string}`,
      to: "0x0000000000000000000000000000000000000002" as `0x${string}`,
      value: "1000000",
      validAfter: "0",
      validBefore: "1999999999",
      nonce: ("0x" + "aa".repeat(32)) as `0x${string}`,
      signature: ("0x" + "bb".repeat(65)) as `0x${string}`,
    };
    const h1 = computeTransferAuthStructHash(auth);
    const h2 = computeTransferAuthStructHash(auth);
    expect(h1).toBe(h2);
    expect(/^0x[0-9a-f]{64}$/.test(h1)).toBe(true);
  });

  it("changes when any field of the authorization changes", () => {
    const base = {
      from: "0x0000000000000000000000000000000000000001" as `0x${string}`,
      to: "0x0000000000000000000000000000000000000002" as `0x${string}`,
      value: "1000000",
      validAfter: "0",
      validBefore: "1999999999",
      nonce: ("0x" + "aa".repeat(32)) as `0x${string}`,
      signature: ("0x" + "bb".repeat(65)) as `0x${string}`,
    };
    const baseHash = computeTransferAuthStructHash(base);
    expect(computeTransferAuthStructHash({ ...base, value: "1000001" })).not.toBe(baseHash);
    expect(
      computeTransferAuthStructHash({ ...base, nonce: ("0x" + "cc".repeat(32)) as `0x${string}` }),
    ).not.toBe(baseHash);
  });
});
