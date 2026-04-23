/**
 * Receiver-side (facilitator) verification tests.
 *
 * The facilitator is the last line of defense against a malicious
 * agent — if it accepts a bad payment, money moves. These tests
 * pin the rejection paths:
 *
 *   - Network / scheme mismatch.
 *   - Expired or not-yet-valid authorization.
 *   - Recipient or amount drift.
 *   - struct hash recomputation mismatch (client-supplied hash lied).
 *   - Signature recovers to the wrong address.
 *   - Attestation required but missing.
 *   - Attestation binding hash does not bind to this payment.
 *   - Attestation verifier rejects the quote itself.
 *
 * A stubbed `SignerRecovery` is used so we don't need a real secp256k1
 * recovery implementation — the `@aethelred/wallet-core` custody
 * tests already pin that behavior. We just verify that the facilitator
 * PASSES the right inputs to the recovery adapter and rejects the
 * right shapes.
 */

import { describe, expect, it, vi } from "vitest";

import {
  computeTransferAuthStructHash,
  computeBindingHash,
  signPaymentAuthorization,
  verifyPayment,
  type AttestationVerifier,
  type PaymentRequirement,
  type TypedDataSigner,
  type SignerRecovery,
  FacilitatorError,
  X402Error,
} from "@aethelred/wallet-x402";
import type { TeeQuote } from "@aethelred/wallet-compliance";

const AGENT = "0x000000000000000000000000000000000000beef" as const;
const RECEIVER = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as const;
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;

function makeSigner(): TypedDataSigner {
  return {
    address: AGENT,
    signTypedData: vi.fn().mockResolvedValue(("0x" + "ab".repeat(65)) as `0x${string}`),
  };
}

function makeRequirement(overrides: Partial<PaymentRequirement> = {}): PaymentRequirement {
  return {
    scheme: "exact",
    network: "base-mainnet",
    maxAmountRequired: "1000",
    resource: "https://api.example.com/weather",
    description: "Weather API",
    payTo: RECEIVER,
    maxTimeoutSeconds: 60,
    asset: USDC_BASE,
    extra: { name: "USD Coin", version: "2" },
    ...overrides,
  };
}

function headerOf(payload: unknown): string {
  return btoa(JSON.stringify(payload));
}

const RECOVER_TO_AGENT: SignerRecovery = async () => AGENT;
const RECOVER_TO_OTHER: SignerRecovery = async () => "0xfeedfacefeedfacefeedfacefeedfacefeedface" as const;

async function buildPayment(overrides: Partial<PaymentRequirement> = {}) {
  const requirement = makeRequirement(overrides);
  const payment = await signPaymentAuthorization({
    requirement,
    from: AGENT,
    signer: makeSigner(),
  });
  return { payment, requirement };
}

describe("facilitator — accepts a well-formed payment", () => {
  it("verifies and returns signer + paymentId", async () => {
    const { payment, requirement } = await buildPayment();
    const result = await verifyPayment({
      requirement,
      paymentHeader: headerOf(payment),
      recover: RECOVER_TO_AGENT,
    });
    expect(result.signerAddress).toBe(AGENT);
    expect(result.paymentId).toBe(payment.payload.structHash);
  });
});

describe("facilitator — rejects wire-mismatched payments", () => {
  it("rejects when payment network differs from requirement network", async () => {
    const { payment, requirement } = await buildPayment();
    const mutatedPayment = { ...payment, network: "polygon-mainnet" as const };
    await expect(
      verifyPayment({
        requirement,
        paymentHeader: headerOf(mutatedPayment),
        recover: RECOVER_TO_AGENT,
      }),
    ).rejects.toBeInstanceOf(FacilitatorError);
  });

  it("rejects when validBefore is in the past", async () => {
    const { payment, requirement } = await buildPayment();
    const expiredPayment = {
      ...payment,
      payload: {
        ...payment.payload,
        authorization: { ...payment.payload.authorization, validBefore: "1000" },
      },
    };
    await expect(
      verifyPayment({
        requirement,
        paymentHeader: headerOf(expiredPayment),
        recover: RECOVER_TO_AGENT,
      }),
    ).rejects.toMatchObject({ code: "facilitator-rejected" });
  });

  it("rejects when recipient address differs from payTo", async () => {
    const { payment, requirement } = await buildPayment();
    const mutated = {
      ...payment,
      payload: {
        ...payment.payload,
        authorization: {
          ...payment.payload.authorization,
          to: "0x1111111111111111111111111111111111111111" as `0x${string}`,
        },
      },
    };
    await expect(
      verifyPayment({
        requirement,
        paymentHeader: headerOf(mutated),
        recover: RECOVER_TO_AGENT,
      }),
    ).rejects.toBeInstanceOf(FacilitatorError);
  });

  it("rejects when amount exceeds maxAmountRequired", async () => {
    const { payment, requirement } = await buildPayment({ maxAmountRequired: "500" });
    const mutated = {
      ...payment,
      payload: {
        ...payment.payload,
        authorization: { ...payment.payload.authorization, value: "9999" },
      },
    };
    await expect(
      verifyPayment({
        requirement,
        paymentHeader: headerOf(mutated),
        recover: RECOVER_TO_AGENT,
      }),
    ).rejects.toBeInstanceOf(FacilitatorError);
  });

  it("rejects when client-supplied structHash doesn't match recomputed", async () => {
    const { payment, requirement } = await buildPayment();
    const mutated = {
      ...payment,
      payload: { ...payment.payload, structHash: ("0x" + "ff".repeat(32)) as `0x${string}` },
    };
    await expect(
      verifyPayment({
        requirement,
        paymentHeader: headerOf(mutated),
        recover: RECOVER_TO_AGENT,
      }),
    ).rejects.toBeInstanceOf(FacilitatorError);
  });

  it("rejects when recovered signer does not match 'from'", async () => {
    const { payment, requirement } = await buildPayment();
    await expect(
      verifyPayment({
        requirement,
        paymentHeader: headerOf(payment),
        recover: RECOVER_TO_OTHER,
      }),
    ).rejects.toBeInstanceOf(FacilitatorError);
  });

  it("throws on malformed base64 in payment header", async () => {
    const { requirement } = await buildPayment();
    await expect(
      verifyPayment({
        requirement,
        paymentHeader: "not-base64!!!",
        recover: RECOVER_TO_AGENT,
      }),
    ).rejects.toBeInstanceOf(FacilitatorError);
  });
});

describe("facilitator — attestation path (moat)", () => {
  function baselineQuote(): TeeQuote {
    return {
      platform: "aws-nitro",
      version: "4",
      quote: ("0x" + "de".repeat(32)) as `0x${string}`,
      nonce: ("0x" + "11".repeat(32)) as `0x${string}`,
      generatedAt: 1,
      measurements: {
        codeHash: ("0x" + "aa".repeat(32)) as `0x${string}`,
        configHash: ("0x" + "bb".repeat(32)) as `0x${string}`,
        platformSecurityVersion: "2.0.0",
      },
    };
  }

  function makeRequirementWithAttestation(): PaymentRequirement {
    return makeRequirement({
      attestation: {
        allowedPlatforms: ["aws-nitro"],
        maxAgeSeconds: 600,
      },
    });
  }

  it("rejects when attestation is required but header missing", async () => {
    const requirement = makeRequirementWithAttestation();
    const payment = await signPaymentAuthorization({
      requirement,
      from: AGENT,
      signer: makeSigner(),
    });
    await expect(
      verifyPayment({
        requirement,
        paymentHeader: headerOf(payment),
        recover: RECOVER_TO_AGENT,
      }),
    ).rejects.toMatchObject({ code: "facilitator-rejected" });
  });

  it("throws attestation-verification-failed when no verifier is configured", async () => {
    const requirement = makeRequirementWithAttestation();
    const payment = await signPaymentAuthorization({
      requirement,
      from: AGENT,
      signer: makeSigner(),
    });
    const quote = baselineQuote();
    const bindingHash = computeBindingHash(payment.payload.structHash, quote);
    const attestationHeader = headerOf({ x402Version: 1, quote, bindingHash });
    await expect(
      verifyPayment({
        requirement,
        paymentHeader: headerOf(payment),
        attestationHeader,
        recover: RECOVER_TO_AGENT,
      }),
    ).rejects.toMatchObject({ code: "attestation-verification-failed" });
  });

  it("rejects when binding hash doesn't bind to this payment", async () => {
    const requirement = makeRequirementWithAttestation();
    const payment = await signPaymentAuthorization({
      requirement,
      from: AGENT,
      signer: makeSigner(),
    });
    const quote = baselineQuote();
    const wrongBinding = ("0x" + "ff".repeat(32)) as `0x${string}`;
    const attestationHeader = headerOf({ x402Version: 1, quote, bindingHash: wrongBinding });
    const verifier: AttestationVerifier = {
      verify: vi.fn().mockResolvedValue({ ok: true }),
    };
    await expect(
      verifyPayment({
        requirement,
        paymentHeader: headerOf(payment),
        attestationHeader,
        recover: RECOVER_TO_AGENT,
        attestationVerifier: verifier,
      }),
    ).rejects.toMatchObject({ code: "facilitator-rejected" });
    expect(verifier.verify).not.toHaveBeenCalled(); // bail before invoking
  });

  it("rejects when verifier rejects the quote", async () => {
    const requirement = makeRequirementWithAttestation();
    const payment = await signPaymentAuthorization({
      requirement,
      from: AGENT,
      signer: makeSigner(),
    });
    const quote = baselineQuote();
    const bindingHash = computeBindingHash(payment.payload.structHash, quote);
    const attestationHeader = headerOf({ x402Version: 1, quote, bindingHash });
    const verifier: AttestationVerifier = {
      verify: vi.fn().mockResolvedValue({ ok: false, reason: "measurement mismatch" }),
    };
    await expect(
      verifyPayment({
        requirement,
        paymentHeader: headerOf(payment),
        attestationHeader,
        recover: RECOVER_TO_AGENT,
        attestationVerifier: verifier,
      }),
    ).rejects.toMatchObject({ code: "facilitator-rejected" });
    expect(verifier.verify).toHaveBeenCalledOnce();
  });

  it("accepts when binding + verifier both pass", async () => {
    const requirement = makeRequirementWithAttestation();
    const payment = await signPaymentAuthorization({
      requirement,
      from: AGENT,
      signer: makeSigner(),
    });
    const quote = baselineQuote();
    const bindingHash = computeBindingHash(payment.payload.structHash, quote);
    const attestationHeader = headerOf({ x402Version: 1, quote, bindingHash });
    const verifier: AttestationVerifier = {
      verify: vi.fn().mockResolvedValue({ ok: true }),
    };
    const result = await verifyPayment({
      requirement,
      paymentHeader: headerOf(payment),
      attestationHeader,
      recover: RECOVER_TO_AGENT,
      attestationVerifier: verifier,
    });
    expect(result.attestation?.bindingHash).toBe(bindingHash);
  });
});

describe("facilitator — sanity on computeTransferAuthStructHash parity", () => {
  it("client struct hash matches facilitator-recomputed hash", async () => {
    const { payment } = await buildPayment();
    const rebuilt = computeTransferAuthStructHash(payment.payload.authorization);
    expect(rebuilt).toBe(payment.payload.structHash);
  });
});

describe("facilitator — error taxonomy discipline", () => {
  it("every thrown error is a typed subclass", async () => {
    const { requirement } = await buildPayment();
    try {
      await verifyPayment({
        requirement,
        paymentHeader: "garbage",
        recover: RECOVER_TO_AGENT,
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(X402Error);
      expect(err).toBeInstanceOf(FacilitatorError);
      expect((err as X402Error).code).toBeDefined();
    }
  });
});
