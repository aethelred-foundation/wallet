/**
 * X402FacilitatorSolver tests.
 *
 * Coverage:
 *
 *   1. Solver identity — id / name / supportedIntentKinds / publicKeyHex null.
 *   2. quote() declines:
 *      - non-payment intents (transfer / swap)
 *      - intents whose creator ≠ configured signer
 *      - intents with missing / malformed / non-http(s) resource
 *   3. quote() happy path — commits to intent.maxAmount,
 *      validity + estimatedFillTimeMs honoured, metadata shape.
 *   4. settle() declines:
 *      - non-payment (throws unsupported-intent-kind)
 *      - creator mismatch (throws signer-mismatch)
 *   5. settle() happy path — calls x402Fetch with expected options,
 *      translates receipt → Fill, actualAmount reads
 *      paidAgainst.maxAmountRequired.
 *   6. settle() failure modes:
 *      - x402Fetch throws → facilitator-http-error
 *      - non-2xx response → facilitator-http-error
 *      - 2xx but no receipt → missing-receipt
 *      - amount exceeds commitment → receipt-amount-exceeds-commitment
 *   7. dispose() — subsequent quote / settle throw solver-disposed.
 *
 * Uses the real `@aethelred/wallet-intent-router.createSignedIntent`
 * + `LocalKeyAdapter` to produce properly-signed intents, with a
 * stubbed `fetch` so no network calls fire.
 */

import { describe, expect, it } from "vitest";

import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import { createSignedIntent, type Intent } from "@aethelred/wallet-intent-router";
import {
  X402FacilitatorSolver,
  X402SolverError,
} from "@aethelred/wallet-x402-solver";
import type {
  PaymentReceipt,
  PaymentRequirement,
  TypedDataSigner,
} from "@aethelred/wallet-x402";

// ─── Fixtures ─────────────────────────────────────

const PK_AGENT = "0x" + "01".repeat(32);
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`;
const MERCHANT = ("0x" + "aa".repeat(20)) as `0x${string}`;
const RESOURCE = "https://api.example.com/data";

function agentSigner(): TypedDataSigner {
  return new LocalKeyAdapter({ privateKey: PK_AGENT }).asTypedDataSigner();
}

async function makePaymentIntent(
  signer: TypedDataSigner,
  overrides: { resource?: string; maxAmount?: string } = {},
): Promise<Intent> {
  return createSignedIntent({
    body: {
      kind: "payment",
      asset: USDC,
      maxAmount: overrides.maxAmount ?? "1000000",
      merchant: MERCHANT,
      resource: overrides.resource ?? RESOURCE,
    },
    creator: signer.address,
    chainId: 8453,
    deadlineMs: Date.now() + 60_000,
    signer,
  });
}

async function makeTransferIntent(signer: TypedDataSigner): Promise<Intent> {
  return createSignedIntent({
    body: {
      kind: "transfer",
      asset: USDC,
      amount: "1000000",
      recipient: MERCHANT,
    },
    creator: signer.address,
    chainId: 8453,
    deadlineMs: Date.now() + 60_000,
    signer,
  });
}

function makeReceipt(overrides: Partial<PaymentReceipt> = {}): PaymentReceipt {
  return {
    x402Version: 1,
    scheme: "exact",
    network: "base-mainnet",
    txHash: ("0x" + "ff".repeat(32)) as `0x${string}`,
    pending: false,
    acceptedAt: Math.floor(Date.now() / 1000),
    paymentId: ("0x" + "cc".repeat(32)) as `0x${string}`,
    ...overrides,
  };
}

function makeRequirement(overrides: Partial<PaymentRequirement> = {}): PaymentRequirement {
  return {
    scheme: "exact",
    network: "base-mainnet",
    maxAmountRequired: "1000000",
    resource: RESOURCE,
    description: "test",
    payTo: MERCHANT,
    maxTimeoutSeconds: 60,
    asset: USDC,
    ...overrides,
  };
}

/**
 * Stubbed fetch. Simulates x402's two-request flow: first request
 * returns 402 with the requirement; second (after signing) returns
 * the success response with `X-PAYMENT-RESPONSE` header.
 */
function stubX402Fetch(opts: {
  readonly successStatus?: number;
  readonly requirement?: PaymentRequirement;
  readonly receiptHeader?: string | null;
  readonly throwFirst?: boolean;
  readonly throwSecond?: boolean;
  readonly skipFirstCall?: boolean; // return success on first call (no payment needed)
}): typeof fetch {
  let call = 0;
  return (async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    call += 1;
    if (call === 1) {
      if (opts.throwFirst) throw new Error("network down");
      if (opts.skipFirstCall) {
        // Simulate a 200 OK with no 402 — x402Fetch returns it as
        // `{ response, receipt: undefined, paidAgainst: undefined }`.
        return new Response("ok", { status: 200 });
      }
      const req = opts.requirement ?? makeRequirement();
      return new Response(
        JSON.stringify({ x402Version: 1, accepts: [req] }),
        {
          status: 402,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (opts.throwSecond) throw new Error("facilitator down");
    const headers: Record<string, string> = {};
    if (opts.receiptHeader !== null) {
      headers["X-PAYMENT-RESPONSE"] = opts.receiptHeader ?? encodeReceiptHeader(makeReceipt());
    }
    void input;
    return new Response("paid", {
      status: opts.successStatus ?? 200,
      headers,
    });
  }) as typeof fetch;
}

function encodeReceiptHeader(receipt: PaymentReceipt): string {
  return Buffer.from(JSON.stringify(receipt)).toString("base64");
}

// ─── Identity ─────────────────────────────────────

describe("X402FacilitatorSolver identity", () => {
  it("exposes id, name, supportedIntentKinds, publicKeyHex", () => {
    const solver = new X402FacilitatorSolver({
      id: "x402-test",
      name: "Test Solver",
      signer: agentSigner(),
    });
    expect(solver.id).toBe("x402-test");
    expect(solver.name).toBe("Test Solver");
    expect(solver.supportedIntentKinds).toEqual(["payment"]);
    expect(solver.publicKeyHex).toBeNull();
  });
});

// ─── quote() declines ────────────────────────────

describe("X402FacilitatorSolver.quote", () => {
  it("declines non-payment intents", async () => {
    const signer = agentSigner();
    const solver = new X402FacilitatorSolver({ id: "t", name: "t", signer });
    const intent = await makeTransferIntent(signer);
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines when creator address ≠ signer address", async () => {
    const signerA = agentSigner();
    const signerB = new LocalKeyAdapter({
      privateKey: "0x" + "02".repeat(32),
    }).asTypedDataSigner();
    const solver = new X402FacilitatorSolver({ id: "t", name: "t", signer: signerA });
    const intent = await makePaymentIntent(signerB);
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines when resource is empty", async () => {
    const signer = agentSigner();
    const solver = new X402FacilitatorSolver({ id: "t", name: "t", signer });
    const intent = await makePaymentIntent(signer, { resource: "" });
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines non-http(s) resource URIs (e.g. invoice:slug)", async () => {
    const signer = agentSigner();
    const solver = new X402FacilitatorSolver({ id: "t", name: "t", signer });
    const intent = await makePaymentIntent(signer, { resource: "invoice:ABC123" });
    expect(await solver.quote(intent)).toBeNull();
  });

  it("declines malformed URL", async () => {
    const signer = agentSigner();
    const solver = new X402FacilitatorSolver({ id: "t", name: "t", signer });
    const intent = await makePaymentIntent(signer, { resource: "not a url" });
    expect(await solver.quote(intent)).toBeNull();
  });
});

// ─── quote() happy path ─────────────────────────

describe("X402FacilitatorSolver.quote happy path", () => {
  it("commits to intent.maxAmount with expected validity + metadata", async () => {
    const signer = agentSigner();
    const fixedNow = 1_700_000_000_000;
    const solver = new X402FacilitatorSolver({
      id: "x402-mainnet",
      name: "Mainnet",
      signer,
      supportedNetworks: ["base-mainnet"],
      quoteValidityMs: 30_000,
      estimatedFillTimeMs: 800,
      now: () => fixedNow,
    });
    const intent = await makePaymentIntent(signer, { maxAmount: "2500000" });
    const quote = await solver.quote(intent);
    expect(quote).not.toBeNull();
    expect(quote!.solverId).toBe("x402-mainnet");
    expect(quote!.intentId).toBe(intent.envelope.id);
    expect(quote!.commitment).toBe("2500000");
    expect(quote!.estimatedFillTimeMs).toBe(800);
    expect(quote!.quotedAt).toBe(fixedNow);
    expect(quote!.expiresAt).toBe(fixedNow + 30_000);
    expect(quote!.solverSignature).toBe("0x");
    expect(quote!.metadata).toMatchObject({
      solverClass: "x402-facilitator",
      attestationAvailable: false,
      resource: RESOURCE,
    });
  });

  it("metadata.attestationAvailable reflects config", async () => {
    const signer = agentSigner();
    const solver = new X402FacilitatorSolver({
      id: "t",
      name: "t",
      signer,
      attestation: {
        async getQuote() {
          return {} as never;
        },
      },
    });
    const intent = await makePaymentIntent(signer);
    const quote = await solver.quote(intent);
    expect(quote!.metadata?.attestationAvailable).toBe(true);
  });
});

// ─── settle() declines ──────────────────────────

describe("X402FacilitatorSolver.settle declines", () => {
  it("throws unsupported-intent-kind for non-payment", async () => {
    const signer = agentSigner();
    const solver = new X402FacilitatorSolver({ id: "t", name: "t", signer });
    const intent = await makeTransferIntent(signer);
    const dummyQuote = {
      solverId: "t",
      intentId: intent.envelope.id,
      commitment: "0",
      estimatedFillTimeMs: 0,
      quotedAt: 0,
      expiresAt: Date.now() + 10_000,
      solverSignature: "0x" as `0x${string}`,
    };
    await expect(solver.settle(intent, dummyQuote)).rejects.toMatchObject({
      code: "unsupported-intent-kind",
    });
  });

  it("throws signer-mismatch when creator ≠ signer", async () => {
    const signerA = agentSigner();
    const signerB = new LocalKeyAdapter({
      privateKey: "0x" + "02".repeat(32),
    }).asTypedDataSigner();
    const solver = new X402FacilitatorSolver({ id: "t", name: "t", signer: signerA });
    const intent = await makePaymentIntent(signerB);
    const quote = {
      solverId: "t",
      intentId: intent.envelope.id,
      commitment: "1000000",
      estimatedFillTimeMs: 0,
      quotedAt: 0,
      expiresAt: Date.now() + 10_000,
      solverSignature: "0x" as `0x${string}`,
    };
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "signer-mismatch",
    });
  });
});

// ─── settle() happy path ────────────────────────

describe("X402FacilitatorSolver.settle happy path", () => {
  it("returns a Fill with actualAmount = paidAgainst.maxAmountRequired", async () => {
    const signer = agentSigner();
    const solver = new X402FacilitatorSolver({
      id: "t",
      name: "t",
      signer,
      fetch: stubX402Fetch({
        requirement: makeRequirement({ maxAmountRequired: "950000" }),
      }),
    });
    const intent = await makePaymentIntent(signer, { maxAmount: "1000000" });
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);
    expect(fill.solverId).toBe("t");
    expect(fill.intentId).toBe(intent.envelope.id);
    expect(fill.quoteCommitment).toBe("1000000");
    expect(fill.actualAmount).toBe("950000");
    expect(fill.settlementRef.startsWith("0x")).toBe(true);
    expect(fill.metadata).toMatchObject({
      solverClass: "x402-facilitator",
      httpStatus: 200,
    });
  });
});

// ─── settle() failure modes ────────────────────

describe("X402FacilitatorSolver.settle failure modes", () => {
  it("wraps x402Fetch throws as facilitator-http-error", async () => {
    const signer = agentSigner();
    const solver = new X402FacilitatorSolver({
      id: "t",
      name: "t",
      signer,
      fetch: stubX402Fetch({ throwFirst: true }),
    });
    const intent = await makePaymentIntent(signer);
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "facilitator-http-error",
    });
  });

  it("surfaces non-2xx response as facilitator-http-error", async () => {
    const signer = agentSigner();
    const solver = new X402FacilitatorSolver({
      id: "t",
      name: "t",
      signer,
      fetch: stubX402Fetch({ successStatus: 500 }),
    });
    const intent = await makePaymentIntent(signer);
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "facilitator-http-error",
    });
  });

  it("surfaces 2xx without receipt as missing-receipt", async () => {
    const signer = agentSigner();
    const solver = new X402FacilitatorSolver({
      id: "t",
      name: "t",
      signer,
      fetch: stubX402Fetch({ skipFirstCall: true }),
    });
    const intent = await makePaymentIntent(signer);
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "missing-receipt",
    });
  });

  it("surfaces amount-exceeds-commitment", async () => {
    const signer = agentSigner();
    const solver = new X402FacilitatorSolver({
      id: "t",
      name: "t",
      signer,
      fetch: stubX402Fetch({
        requirement: makeRequirement({ maxAmountRequired: "2000000" }),
      }),
    });
    const intent = await makePaymentIntent(signer, { maxAmount: "1000000" });
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "receipt-amount-exceeds-commitment",
    });
  });
});

// ─── dispose ───────────────────────────────────

describe("X402FacilitatorSolver.dispose", () => {
  it("blocks subsequent quote + settle with solver-disposed", async () => {
    const signer = agentSigner();
    const solver = new X402FacilitatorSolver({ id: "t", name: "t", signer });
    solver.dispose();
    const intent = await makePaymentIntent(signer);
    await expect(solver.quote(intent)).rejects.toMatchObject({
      code: "solver-disposed",
    });
    await expect(
      solver.settle(intent, {
        solverId: "t",
        intentId: intent.envelope.id,
        commitment: "1",
        estimatedFillTimeMs: 0,
        quotedAt: 0,
        expiresAt: Date.now() + 10_000,
        solverSignature: "0x" as `0x${string}`,
      }),
    ).rejects.toMatchObject({ code: "solver-disposed" });
  });

  it("X402SolverError is exported + instanceof works", () => {
    const e = new X402SolverError("solver-disposed", "test");
    expect(e).toBeInstanceOf(X402SolverError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("solver-disposed");
  });
});

// ─── PR #105: Balance pre-flight ─────────────────────

describe("X402FacilitatorSolver balance pre-flight (PR #105)", () => {
  function makeRecordingPreflight(returns: bigint): {
    readonly fn: (
      owner: `0x${string}`,
      asset: `0x${string}`,
    ) => Promise<bigint>;
    readonly calls: ReadonlyArray<{ owner: string; asset: string }>;
  } {
    const calls: Array<{ owner: string; asset: string }> = [];
    const fn = async (
      owner: `0x${string}`,
      asset: `0x${string}`,
    ): Promise<bigint> => {
      calls.push({ owner, asset });
      return returns;
    };
    return { fn, calls };
  }

  /**
   * Build a fetch stub that records call counts so we can assert
   * "x402Fetch was never invoked" on insufficient-balance paths.
   */
  function stubX402FetchWithCount(opts: Parameters<typeof stubX402Fetch>[0]): {
    readonly fetch: typeof fetch;
    readonly count: { calls: number };
  } {
    const count = { calls: 0 };
    const inner = stubX402Fetch(opts);
    const fetchImpl = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      count.calls += 1;
      return inner(input, init);
    }) as typeof fetch;
    return { fetch: fetchImpl, count };
  }

  it("balancePreflight not configured (default) — solver behaves as before", async () => {
    // Sanity test: omitting balancePreflight doesn't perturb existing behavior.
    const signer = agentSigner();
    const solver = new X402FacilitatorSolver({
      id: "t",
      name: "t",
      signer,
      fetch: stubX402Fetch({}),
      // balancePreflight intentionally omitted
    });
    const intent = await makePaymentIntent(signer);
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);
    expect(fill.actualAmount).toBe("1000000");
  });

  it("sufficient balance → settle proceeds normally; preflight called once with (signer.address, asset)", async () => {
    const signer = agentSigner();
    const { fn: balancePreflight, calls } = makeRecordingPreflight(5_000_000n);
    const solver = new X402FacilitatorSolver({
      id: "t",
      name: "t",
      signer,
      fetch: stubX402Fetch({}),
      balancePreflight,
    });
    const intent = await makePaymentIntent(signer, { maxAmount: "1000000" });
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);
    expect(fill.actualAmount).toBe("1000000");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      owner: signer.address.toLowerCase(),
      asset: USDC,
    });
  });

  it("insufficient balance → throws pre-flight-insufficient-balance; x402Fetch never called", async () => {
    const signer = agentSigner();
    const { fn: balancePreflight } = makeRecordingPreflight(500_000n);
    const { fetch: stubFetch, count } = stubX402FetchWithCount({});
    const solver = new X402FacilitatorSolver({
      id: "t",
      name: "t",
      signer,
      fetch: stubFetch,
      balancePreflight,
    });
    const intent = await makePaymentIntent(signer, { maxAmount: "1000000" });
    const quote = (await solver.quote(intent))!;

    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "pre-flight-insufficient-balance",
      details: {
        balance: "500000",
        maxAmount: "1000000",
        asset: USDC,
        owner: signer.address.toLowerCase(),
      },
    });
    // The crucial property: HTTP request never happened.
    expect(count.calls).toBe(0);
  });

  it("exact balance == maxAmount → settle proceeds (≥ check, not strict >)", async () => {
    const signer = agentSigner();
    const { fn: balancePreflight } = makeRecordingPreflight(1_000_000n);
    const solver = new X402FacilitatorSolver({
      id: "t",
      name: "t",
      signer,
      fetch: stubX402Fetch({}),
      balancePreflight,
    });
    const intent = await makePaymentIntent(signer, { maxAmount: "1000000" });
    const quote = (await solver.quote(intent))!;
    const fill = await solver.settle(intent, quote);
    expect(fill.actualAmount).toBe("1000000");
  });

  it("preflight callback throws → fail-OPEN: settle proceeds with x402Fetch", async () => {
    const signer = agentSigner();
    const balancePreflight = async () => {
      throw new Error("simulated RPC flake");
    };
    const { fetch: stubFetch, count } = stubX402FetchWithCount({});
    const solver = new X402FacilitatorSolver({
      id: "t",
      name: "t",
      signer,
      fetch: stubFetch,
      balancePreflight,
    });
    const intent = await makePaymentIntent(signer, { maxAmount: "1000000" });
    const quote = (await solver.quote(intent))!;
    // RPC throw is swallowed; HTTP path runs.
    const fill = await solver.settle(intent, quote);
    expect(fill.actualAmount).toBe("1000000");
    expect(count.calls).toBeGreaterThan(0);
  });

  it("preflight throws + facilitator rejects → final error is facilitator-http-error (NOT pre-flight)", async () => {
    // Belt-and-suspenders: confirm fail-OPEN doesn't swallow a
    // genuine downstream HTTP failure.
    const signer = agentSigner();
    const balancePreflight = async () => {
      throw new Error("simulated RPC flake");
    };
    const solver = new X402FacilitatorSolver({
      id: "t",
      name: "t",
      signer,
      fetch: stubX402Fetch({ successStatus: 500 }),
      balancePreflight,
    });
    const intent = await makePaymentIntent(signer);
    const quote = (await solver.quote(intent))!;
    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "facilitator-http-error",
    });
  });

  it("preflight returns 0n → throws pre-flight-insufficient-balance", async () => {
    const signer = agentSigner();
    const { fn: balancePreflight } = makeRecordingPreflight(0n);
    const { fetch: stubFetch, count } = stubX402FetchWithCount({});
    const solver = new X402FacilitatorSolver({
      id: "t",
      name: "t",
      signer,
      fetch: stubFetch,
      balancePreflight,
    });
    const intent = await makePaymentIntent(signer, { maxAmount: "1000000" });
    const quote = (await solver.quote(intent))!;

    await expect(solver.settle(intent, quote)).rejects.toMatchObject({
      code: "pre-flight-insufficient-balance",
    });
    expect(count.calls).toBe(0);
  });

  it("preflight check happens AFTER signer-mismatch (mismatch short-circuits)", async () => {
    // Order matters: signer-mismatch is a fast-fail check that
    // must NOT trigger the pre-flight RPC.
    const signerA = agentSigner();
    const signerB = new LocalKeyAdapter({
      privateKey: "0x" + "02".repeat(32),
    }).asTypedDataSigner();
    const { fn: balancePreflight, calls } = makeRecordingPreflight(0n);
    const solver = new X402FacilitatorSolver({
      id: "t",
      name: "t",
      signer: signerA,
      fetch: stubX402Fetch({}),
      balancePreflight,
    });
    const intent = await makePaymentIntent(signerB);

    await expect(
      solver.settle(intent, {
        solverId: "t",
        intentId: intent.envelope.id,
        commitment: intent.body.kind === "payment" ? intent.body.maxAmount : "0",
        estimatedFillTimeMs: 0,
        quotedAt: 0,
        expiresAt: Date.now() + 10_000,
        solverSignature: "0x" as `0x${string}`,
      }),
    ).rejects.toMatchObject({ code: "signer-mismatch" });

    expect(calls).toHaveLength(0); // preflight never called
  });

  it("malformed maxAmount throws pre-flight-insufficient-balance with cause", async () => {
    // Defensive: if intent.body.maxAmount fails BigInt() parsing,
    // the pre-flight raises a typed error rather than letting an
    // unwrapped exception bubble. (The router's validate-on-submit
    // path should prevent this in practice, but defending against
    // it costs nothing.)
    const signer = agentSigner();
    const { fn: balancePreflight } = makeRecordingPreflight(1_000_000n);
    const solver = new X402FacilitatorSolver({
      id: "t",
      name: "t",
      signer,
      fetch: stubX402Fetch({}),
      balancePreflight,
    });
    // Forge an intent with non-numeric maxAmount via a synthetic quote.
    const intent = await makePaymentIntent(signer);
    // Shadow the body's maxAmount with a malformed value.
    const malformed: Intent = {
      ...intent,
      body: {
        ...intent.body,
        maxAmount: "not-a-number",
      } as typeof intent.body,
    };

    await expect(
      solver.settle(malformed, {
        solverId: "t",
        intentId: intent.envelope.id,
        commitment: "1000000",
        estimatedFillTimeMs: 0,
        quotedAt: 0,
        expiresAt: Date.now() + 10_000,
        solverSignature: "0x" as `0x${string}`,
      }),
    ).rejects.toMatchObject({
      code: "pre-flight-insufficient-balance",
    });
  });
});
