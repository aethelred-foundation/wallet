/**
 * End-to-end client tests.
 *
 * We stub `fetch` to simulate a 402 flow and verify that:
 *   1. `x402Fetch` calls the resource first without payment
 *      (speculation-free).
 *   2. On 402, it parses requirements, runs policy, signs, and
 *      retries with the correct headers.
 *   3. The policy hook is called BEFORE any signing — a deny
 *      short-circuits before the signer fires.
 *   4. Attestation is attached when required and validated on
 *      the receipt echo.
 *   5. A receipt binding mismatch throws receipt-binding-mismatch.
 *
 * These are the "moat preserved end-to-end" tests — bypassing any
 * one would downgrade our story to vanilla x402.
 */

import { describe, expect, it, vi } from "vitest";

import type { TeeQuote } from "@aethelred/wallet-compliance";
import {
  computeBindingHash,
  encodeReceiptHeader,
  x402Fetch,
  type AttestationProvider,
  type AuditHook,
  type PaymentPolicyHook,
  type TypedDataSigner,
} from "@aethelred/wallet-x402";

const AGENT = "0x000000000000000000000000000000000000beef" as const;
const RECEIVER = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as const;
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const SIG = ("0x" + "ab".repeat(65)) as `0x${string}`;

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

function makeSigner(): TypedDataSigner {
  return {
    address: AGENT,
    signTypedData: vi.fn().mockResolvedValue(SIG),
  };
}

function makeAttestationProvider(): AttestationProvider {
  return {
    getQuote: vi.fn().mockResolvedValue(baselineQuote()),
  };
}

function makeAudit(): AuditHook & { events: Array<Parameters<AuditHook["record"]>[0]> } {
  const events: Array<Parameters<AuditHook["record"]>[0]> = [];
  return {
    events,
    record(e) {
      events.push(e);
    },
  };
}

const REQUIREMENTS_BODY = {
  x402Version: 1 as const,
  accepts: [
    {
      scheme: "exact" as const,
      network: "base-mainnet" as const,
      maxAmountRequired: "1000",
      resource: "https://api.example.com/weather",
      description: "Weather API",
      payTo: RECEIVER,
      maxTimeoutSeconds: 60,
      asset: USDC_BASE,
      extra: { name: "USD Coin", version: "2" },
    },
  ],
};

/**
 * Build a stubbed fetch: first call returns 402, second call
 * returns the provided success response.
 */
function makeStubbedFetch(
  successInit: ResponseInit & { headers: Record<string, string> } = {
    status: 200,
    headers: {},
  },
): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    call += 1;
    if (call === 1) {
      return new Response(JSON.stringify(REQUIREMENTS_BODY), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("ok", successInit);
  }) as unknown as typeof fetch;
}

describe("x402Fetch — non-402 responses pass through", () => {
  it("returns the initial response when the server returns 200", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const { response, receipt, paidAgainst } = await x402Fetch(
      "https://api.example.com/free",
      { signer: makeSigner(), fetch: fetchImpl as unknown as typeof fetch },
    );
    expect(response.status).toBe(200);
    expect(receipt).toBeUndefined();
    expect(paidAgainst).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("x402Fetch — 402 flow without attestation", () => {
  it("parses requirements, signs, and retries with X-PAYMENT", async () => {
    const fetchImpl = makeStubbedFetch({
      status: 200,
      headers: {
        "X-PAYMENT-RESPONSE": encodeReceiptHeader({
          x402Version: 1,
          scheme: "exact",
          network: "base-mainnet",
          txHash: "0xcafe",
          pending: false,
          acceptedAt: 1,
          paymentId: ("0x" + "aa".repeat(32)) as `0x${string}`,
        }),
      },
    });
    const signer = makeSigner();
    const audit = makeAudit();

    const { response, receipt, paidAgainst } = await x402Fetch(
      "https://api.example.com/weather",
      { signer, audit, fetch: fetchImpl },
    );

    expect(response.status).toBe(200);
    expect(paidAgainst?.resource).toBe("https://api.example.com/weather");
    expect(receipt?.paymentId).toBeDefined();

    // Assert the second fetch carried the X-PAYMENT header.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondCallInit = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1] as
      | RequestInit
      | undefined;
    const headers = new Headers(secondCallInit?.headers);
    expect(headers.get("X-PAYMENT")).toBeTruthy();
    expect(headers.get("X-PAYMENT-ATTESTATION")).toBeNull();

    // Audit trail records start + success.
    expect(audit.events.map((e) => e.kind)).toEqual(["x402-pay-start", "x402-pay-success"]);
  });
});

describe("x402Fetch — policy hook gate", () => {
  it("deny short-circuits BEFORE the signer is called", async () => {
    const fetchImpl = makeStubbedFetch();
    const signer = makeSigner();
    const audit = makeAudit();
    const policy: PaymentPolicyHook = vi.fn().mockResolvedValue({
      decision: "deny",
      reason: "daily spend cap exceeded",
    });

    await expect(
      x402Fetch("https://api.example.com/weather", {
        signer,
        audit,
        onPolicyCheck: policy,
        fetch: fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "facilitator-rejected" });

    // The crucial invariant: signer NEVER touched on deny.
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(audit.events.at(-1)?.kind).toBe("x402-pay-failure");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // only the initial, no retry
  });

  it("approval-required surfaces distinctly for UI handoff", async () => {
    const fetchImpl = makeStubbedFetch();
    const policy: PaymentPolicyHook = () => ({
      decision: "approval-required",
      reason: "over $100",
    });
    await expect(
      x402Fetch("https://api.example.com/weather", {
        signer: makeSigner(),
        onPolicyCheck: policy,
        fetch: fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "facilitator-rejected" });
  });
});

describe("x402Fetch — attestation path (moat)", () => {
  const ATTESTED_REQUIREMENTS = {
    ...REQUIREMENTS_BODY,
    accepts: [
      {
        ...REQUIREMENTS_BODY.accepts[0],
        attestation: {
          allowedPlatforms: ["aws-nitro"],
          maxAgeSeconds: 600,
        },
      },
    ],
  };

  function makeAttestedFetch(receiptBindingHash?: `0x${string}`): typeof fetch {
    let call = 0;
    return vi.fn(async (_url, init) => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify(ATTESTED_REQUIREMENTS), {
          status: 402,
          headers: { "content-type": "application/json" },
        });
      }
      // Extract the payment header to recompute structHash for echo
      const headers = new Headers(init?.headers);
      const paymentHeader = headers.get("X-PAYMENT");
      expect(paymentHeader).toBeTruthy();
      const paymentPayload = JSON.parse(atob(paymentHeader!));
      const structHash = paymentPayload.payload.structHash as `0x${string}`;
      const bindingEcho = receiptBindingHash ?? computeBindingHash(structHash, baselineQuote());
      return new Response("ok", {
        status: 200,
        headers: {
          "X-PAYMENT-RESPONSE": encodeReceiptHeader({
            x402Version: 1,
            scheme: "exact",
            network: "base-mainnet",
            txHash: "0xcafe",
            pending: false,
            acceptedAt: 1,
            paymentId: structHash,
            attestationBindingHash: bindingEcho,
          }),
        },
      });
    }) as unknown as typeof fetch;
  }

  it("attaches X-PAYMENT-ATTESTATION when the receiver requires it", async () => {
    const fetchImpl = makeAttestedFetch();
    const attestation = makeAttestationProvider();
    const { response, receipt } = await x402Fetch("https://api.example.com/weather", {
      signer: makeSigner(),
      attestation,
      fetch: fetchImpl,
    });
    expect(response.status).toBe(200);
    expect(receipt?.attestationBindingHash).toBeTruthy();
    expect(attestation.getQuote).toHaveBeenCalledOnce();

    // Verify the retry request carried the attestation header.
    const fetchCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const retryInit = fetchCalls[1][1] as RequestInit;
    const headers = new Headers(retryInit.headers);
    expect(headers.get("X-PAYMENT-ATTESTATION")).toBeTruthy();
  });

  it("throws attestation-unavailable when receiver requires it but none provided", async () => {
    const fetchImpl = makeAttestedFetch();
    await expect(
      x402Fetch("https://api.example.com/weather", {
        signer: makeSigner(),
        fetch: fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "attestation-unavailable" });
  });

  it("throws receipt-binding-mismatch when facilitator echoes a wrong binding", async () => {
    const wrongBinding = ("0x" + "ff".repeat(32)) as `0x${string}`;
    const fetchImpl = makeAttestedFetch(wrongBinding);
    const attestation = makeAttestationProvider();
    await expect(
      x402Fetch("https://api.example.com/weather", {
        signer: makeSigner(),
        attestation,
        fetch: fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "receipt-binding-mismatch" });
  });

  it("throws receipt-binding-mismatch when facilitator silently drops the attestation echo", async () => {
    // Stubbed fetch returns a receipt WITHOUT attestationBindingHash
    let call = 0;
    const fetchImpl = vi.fn(async (_url, init) => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify(ATTESTED_REQUIREMENTS), { status: 402 });
      }
      const paymentHeader = new Headers(init?.headers).get("X-PAYMENT")!;
      const paymentPayload = JSON.parse(atob(paymentHeader));
      return new Response("ok", {
        status: 200,
        headers: {
          "X-PAYMENT-RESPONSE": encodeReceiptHeader({
            x402Version: 1,
            scheme: "exact",
            network: "base-mainnet",
            txHash: "0xcafe",
            pending: false,
            acceptedAt: 1,
            paymentId: paymentPayload.payload.structHash,
            // No attestationBindingHash!
          }),
        },
      });
    });
    const attestation = makeAttestationProvider();
    await expect(
      x402Fetch("https://api.example.com/weather", {
        signer: makeSigner(),
        attestation,
        fetch: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "receipt-binding-mismatch" });
  });
});

describe("x402Fetch — failure modes", () => {
  it("throws when retry returns non-2xx with facilitator context", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify(REQUIREMENTS_BODY), { status: 402 });
      return new Response("no funds", { status: 402, headers: { "content-type": "text/plain" } });
    });
    await expect(
      x402Fetch("https://api.example.com/weather", {
        signer: makeSigner(),
        fetch: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "facilitator-rejected", httpStatus: 402 });
  });

  it("throws unexpected-response-shape when server accepts without X-PAYMENT-RESPONSE", async () => {
    const fetchImpl = makeStubbedFetch({ status: 200, headers: {} });
    await expect(
      x402Fetch("https://api.example.com/weather", {
        signer: makeSigner(),
        fetch: fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "unexpected-response-shape" });
  });
});
