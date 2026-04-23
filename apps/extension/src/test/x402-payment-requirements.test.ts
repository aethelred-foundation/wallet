/**
 * Parser tests for `parsePaymentRequirements` — the 402-body entry
 * point. Every failure mode here maps to a specific `X402ErrorCode`
 * that consumers branch on.
 */

import { describe, expect, it } from "vitest";

import {
  parsePaymentRequirements,
  PaymentRequirementError,
} from "@aethelred/wallet-x402";

const WELL_FORMED = {
  x402Version: 1 as const,
  accepts: [
    {
      scheme: "exact",
      network: "base-mainnet",
      maxAmountRequired: "1000",
      resource: "https://api.example.com/v1/weather",
      description: "Weather API",
      mimeType: "application/json",
      payTo: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      maxTimeoutSeconds: 60,
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      extra: { name: "USD Coin", version: "2" },
    },
  ],
};

describe("parsePaymentRequirements — happy path", () => {
  it("parses a well-formed v1 body", () => {
    const parsed = parsePaymentRequirements(WELL_FORMED);
    expect(parsed.x402Version).toBe(1);
    expect(parsed.accepts).toHaveLength(1);
    expect(parsed.accepts[0].network).toBe("base-mainnet");
    expect(parsed.accepts[0].payTo.toLowerCase()).toBe(WELL_FORMED.accepts[0].payTo.toLowerCase());
  });

  it("preserves extra metadata verbatim for EIP-712 domain construction", () => {
    const parsed = parsePaymentRequirements(WELL_FORMED);
    expect(parsed.accepts[0].extra).toEqual({ name: "USD Coin", version: "2" });
  });

  it("parses attestation block when present", () => {
    const body = {
      ...WELL_FORMED,
      accepts: [
        {
          ...WELL_FORMED.accepts[0],
          attestation: {
            allowedPlatforms: ["aws-nitro", "intel-tdx"],
            maxAgeSeconds: 300,
            perCallFreshness: true,
            expectedMeasurements: [{ platform: "aws-nitro", mrEnclave: "0xabc" }],
          },
        },
      ],
    };
    const parsed = parsePaymentRequirements(body);
    expect(parsed.accepts[0].attestation?.allowedPlatforms).toEqual(["aws-nitro", "intel-tdx"]);
    expect(parsed.accepts[0].attestation?.perCallFreshness).toBe(true);
  });
});

describe("parsePaymentRequirements — rejects bad input", () => {
  it("throws when body is not an object", () => {
    expect(() => parsePaymentRequirements("not an object")).toThrow(PaymentRequirementError);
    expect(() => parsePaymentRequirements(null)).toThrow(PaymentRequirementError);
  });

  it("throws invalid-payment-requirement on unsupported x402Version", () => {
    expect(() =>
      parsePaymentRequirements({ ...WELL_FORMED, x402Version: 2 }),
    ).toThrow(/Unsupported x402Version/);
  });

  it("throws no-acceptable-requirement when accepts is empty", () => {
    expect(() =>
      parsePaymentRequirements({ ...WELL_FORMED, accepts: [] }),
    ).toThrow(/no accepts/);
  });

  it("throws unsupported-scheme for upto (not yet implemented)", () => {
    const body = {
      ...WELL_FORMED,
      accepts: [{ ...WELL_FORMED.accepts[0], scheme: "upto" }],
    };
    expect(() => parsePaymentRequirements(body)).toThrow(PaymentRequirementError);
  });

  it("throws unsupported-network on unknown network slug", () => {
    const body = {
      ...WELL_FORMED,
      accepts: [{ ...WELL_FORMED.accepts[0], network: "bsc-mainnet" }],
    };
    expect(() => parsePaymentRequirements(body)).toThrow(/bsc-mainnet/);
  });

  it("throws invalid-payment-requirement on non-decimal maxAmountRequired", () => {
    const body = {
      ...WELL_FORMED,
      accepts: [{ ...WELL_FORMED.accepts[0], maxAmountRequired: "1.5" }],
    };
    expect(() => parsePaymentRequirements(body)).toThrow(PaymentRequirementError);
  });

  it("rejects empty resource", () => {
    const body = {
      ...WELL_FORMED,
      accepts: [{ ...WELL_FORMED.accepts[0], resource: "" }],
    };
    expect(() => parsePaymentRequirements(body)).toThrow(PaymentRequirementError);
  });

  it("rejects malformed payTo/asset addresses", () => {
    const bad = { ...WELL_FORMED.accepts[0], payTo: "not-an-address" };
    expect(() => parsePaymentRequirements({ ...WELL_FORMED, accepts: [bad] })).toThrow();
  });

  it("rejects unknown attestation platform", () => {
    const body = {
      ...WELL_FORMED,
      accepts: [
        {
          ...WELL_FORMED.accepts[0],
          attestation: {
            allowedPlatforms: ["not-a-real-platform"],
          },
        },
      ],
    };
    expect(() => parsePaymentRequirements(body)).toThrow();
  });
});
