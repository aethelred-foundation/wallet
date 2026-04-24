/**
 * IntentRouter tests.
 *
 * Coverage targets:
 *
 *   1. Intent envelope: createSignedIntent produces a valid
 *      signature that verifyIntentSignature accepts; tampering with
 *      any field breaks verification; deadline enforcement.
 *   2. Id determinism: same body + envelope-without-id → same id.
 *   3. Solver registry: register/unregister, listFor filters by
 *      supported kind, duplicate-id rejection.
 *   4. Comparators: bestPrice for each intent kind (swap maximises,
 *      transfer/payment minimise), fastestFill breaks ties on price,
 *      composite combines ranks.
 *   5. Router orchestration:
 *        - Happy path: sign → submit → quote → pick → settle.
 *        - No solvers registered → throws no-solvers-available.
 *        - All solvers decline → outcome.kind === "no-quotes".
 *        - Settlement throws → outcome.kind === "settlement-failed".
 *        - Fill amount doesn't match commitment → FillMismatchError
 *          for the appropriate kind (transfer strict, swap >=,
 *          payment <=).
 *        - Signature verification fails → throws intent-signature-invalid.
 *        - Expired intent → throws intent-expired.
 *        - Reused nonce → throws intent-nonce-reused.
 *        - Malformed solver response (wrong solverId / wrong
 *          intentId / pre-expired) → declined.
 *        - Solver quote timeout → declined.
 *   6. Payment gate integration:
 *        - gate.allowed === false → outcome.kind === "payment-gated".
 *        - Gate passes → router proceeds to quoting.
 *   7. Audit sink: events emitted in order, full trace for a
 *      fulfilled intent matches the expected sequence.
 */

import { describe, expect, it } from "vitest";

import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import {
  // types
  type Intent,
  type Quote,
  type Fill,
  type Solver,
  type IntentRouterAuditEvent,
  // envelope
  createSignedIntent,
  verifyIntentSignature,
  // registry + comparators
  InMemorySolverRegistry,
  bestPrice,
  fastestFill,
  composite,
  pickBest,
  // router
  IntentRouter,
  InMemoryNonceStore,
  verifyFillAgainstQuote,
  // errors
  IntentRouterError,
  FillMismatchError,
} from "@aethelred/wallet-intent-router";

// ─── Fixtures ────────────────────────────────────────────────────

const PK_HEX_A = "0x" + "01".repeat(32);

const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`;
const WETH_BASE = "0x4200000000000000000000000000000000000006" as `0x${string}`;
const DEMO_RECIPIENT = ("0x" + "aa".repeat(20)) as `0x${string}`;
const DEMO_MERCHANT = ("0x" + "bb".repeat(20)) as `0x${string}`;

function adapterA(): LocalKeyAdapter {
  return new LocalKeyAdapter({ privateKey: PK_HEX_A });
}

async function makeTransferIntent(
  overrides: Partial<{ deadline: number; amount: string }> = {},
): Promise<Intent> {
  const a = adapterA();
  return createSignedIntent({
    body: {
      kind: "transfer",
      asset: USDC_BASE,
      amount: overrides.amount ?? "1000000",
      recipient: DEMO_RECIPIENT,
    },
    creator: a.address,
    chainId: 8453,
    deadlineMs: overrides.deadline ?? Date.now() + 60_000,
    signer: a.asTypedDataSigner(),
  });
}

async function makeSwapIntent(): Promise<Intent> {
  const a = adapterA();
  return createSignedIntent({
    body: {
      kind: "swap",
      sellAsset: USDC_BASE,
      sellAmount: "100000000", // 100 USDC
      buyAsset: WETH_BASE,
      minBuyAmount: "30000000000000000", // 0.03 WETH
      recipient: DEMO_RECIPIENT,
    },
    creator: a.address,
    chainId: 8453,
    deadlineMs: Date.now() + 60_000,
    signer: a.asTypedDataSigner(),
  });
}

async function makePaymentIntent(): Promise<Intent> {
  const a = adapterA();
  return createSignedIntent({
    body: {
      kind: "payment",
      asset: USDC_BASE,
      maxAmount: "1000000",
      merchant: DEMO_MERCHANT,
      resource: "https://api.example.com/data",
      description: "demo",
    },
    creator: a.address,
    chainId: 8453,
    deadlineMs: Date.now() + 60_000,
    signer: a.asTypedDataSigner(),
  });
}

function mockSolver(id: string, overrides: Partial<Solver> = {}): Solver {
  return {
    id,
    name: id,
    supportedIntentKinds: overrides.supportedIntentKinds ?? ["transfer", "swap", "payment"],
    publicKeyHex: null,
    async quote(intent: Intent): Promise<Quote | null> {
      return {
        solverId: id,
        intentId: intent.envelope.id,
        commitment:
          intent.body.kind === "swap"
            ? intent.body.minBuyAmount
            : intent.body.kind === "transfer"
              ? intent.body.amount
              : intent.body.maxAmount,
        estimatedFillTimeMs: 500,
        quotedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        solverSignature: "0x" as `0x${string}`,
      };
    },
    async settle(intent: Intent, quote: Quote): Promise<Fill> {
      return {
        solverId: id,
        intentId: intent.envelope.id,
        quoteCommitment: quote.commitment,
        actualAmount: quote.commitment,
        settlementRef: `tx-${id}-${Date.now()}`,
        settledAt: Date.now(),
      };
    },
    ...overrides,
  };
}

function collectingAuditSink(): {
  sink: { emit: (ev: IntentRouterAuditEvent) => void };
  events: IntentRouterAuditEvent[];
} {
  const events: IntentRouterAuditEvent[] = [];
  return {
    sink: {
      emit(ev: IntentRouterAuditEvent) {
        events.push(ev);
      },
    },
    events,
  };
}

// ─── Envelope + id ──────────────────────────────────────────────

describe("createSignedIntent + verifyIntentSignature", () => {
  it("creates intents whose signature recovers to creator", async () => {
    const intent = await makeTransferIntent();
    expect(() => verifyIntentSignature(intent)).not.toThrow();
    expect(intent.envelope.id.startsWith("0x")).toBe(true);
    expect(intent.envelope.id.length).toBe(66);
  });

  it("supports swap intents", async () => {
    const intent = await makeSwapIntent();
    expect(() => verifyIntentSignature(intent)).not.toThrow();
  });

  it("supports payment intents", async () => {
    const intent = await makePaymentIntent();
    expect(() => verifyIntentSignature(intent)).not.toThrow();
  });

  it("rejects when creator does not match signer address", async () => {
    const a = adapterA();
    await expect(
      createSignedIntent({
        body: {
          kind: "transfer",
          asset: USDC_BASE,
          amount: "1",
          recipient: DEMO_RECIPIENT,
        },
        creator: ("0x" + "99".repeat(20)) as `0x${string}`, // wrong
        chainId: 1,
        deadlineMs: Date.now() + 60_000,
        signer: a.asTypedDataSigner(),
      }),
    ).rejects.toMatchObject({ code: "intent-signer-mismatch" });
  });

  it("same body + envelope → same id (deterministic)", async () => {
    const a = adapterA();
    const nonce = ("0x" + "aa".repeat(32)) as `0x${string}`;
    const i1 = await createSignedIntent({
      body: {
        kind: "transfer",
        asset: USDC_BASE,
        amount: "1",
        recipient: DEMO_RECIPIENT,
      },
      creator: a.address,
      chainId: 1,
      deadlineMs: 42,
      signer: a.asTypedDataSigner(),
      nonce,
    });
    const i2 = await createSignedIntent({
      body: {
        kind: "transfer",
        asset: USDC_BASE,
        amount: "1",
        recipient: DEMO_RECIPIENT,
      },
      creator: a.address,
      chainId: 1,
      deadlineMs: 42,
      signer: a.asTypedDataSigner(),
      nonce,
    });
    expect(i1.envelope.id).toBe(i2.envelope.id);
  });

  it("tampering with amount breaks id-match", async () => {
    const intent = await makeTransferIntent();
    const tampered: Intent = {
      ...intent,
      body: { ...intent.body, amount: "999999999999" } as Intent["body"],
    };
    expect(() => verifyIntentSignature(tampered)).toThrow(IntentRouterError);
  });

  it("tampering with signature fails signer recovery", async () => {
    const intent = await makeTransferIntent();
    const badSig = ("0x" + "ff".repeat(65)) as `0x${string}`;
    const tampered: Intent = {
      ...intent,
      envelope: { ...intent.envelope, signature: badSig },
    };
    expect(() => verifyIntentSignature(tampered)).toThrow(IntentRouterError);
  });

  it("different chainId → different id (cross-chain replay defence)", async () => {
    const a = adapterA();
    const nonce = ("0x" + "aa".repeat(32)) as `0x${string}`;
    const base = await createSignedIntent({
      body: { kind: "transfer", asset: USDC_BASE, amount: "1", recipient: DEMO_RECIPIENT },
      creator: a.address,
      chainId: 8453,
      deadlineMs: 42,
      signer: a.asTypedDataSigner(),
      nonce,
    });
    const eth = await createSignedIntent({
      body: { kind: "transfer", asset: USDC_BASE, amount: "1", recipient: DEMO_RECIPIENT },
      creator: a.address,
      chainId: 1,
      deadlineMs: 42,
      signer: a.asTypedDataSigner(),
      nonce,
    });
    expect(base.envelope.id).not.toBe(eth.envelope.id);
  });
});

// ─── Solver registry ────────────────────────────────────────────

describe("InMemorySolverRegistry", () => {
  it("lists solvers by supported kind", () => {
    const transferOnly = mockSolver("t", { supportedIntentKinds: ["transfer"] });
    const swapOnly = mockSolver("s", { supportedIntentKinds: ["swap"] });
    const registry = new InMemorySolverRegistry([transferOnly, swapOnly]);
    expect(registry.listFor("transfer").map((s) => s.id)).toEqual(["t"]);
    expect(registry.listFor("swap").map((s) => s.id)).toEqual(["s"]);
    expect(registry.listFor("payment")).toHaveLength(0);
  });

  it("rejects duplicate ids", () => {
    const registry = new InMemorySolverRegistry([mockSolver("dup")]);
    expect(() => registry.register(mockSolver("dup"))).toThrow(/already registered/i);
  });

  it("unregister removes solver", () => {
    const registry = new InMemorySolverRegistry([mockSolver("a")]);
    expect(registry.listFor("transfer")).toHaveLength(1);
    registry.unregister("a");
    expect(registry.listFor("transfer")).toHaveLength(0);
  });
});

// ─── Comparators ────────────────────────────────────────────────

describe("comparators", () => {
  async function buildQuotes(): Promise<{
    intent: Intent;
    q1: Quote;
    q2: Quote;
    q3: Quote;
  }> {
    const intent = await makePaymentIntent();
    const q1: Quote = {
      solverId: "a",
      intentId: intent.envelope.id,
      commitment: "800000",
      estimatedFillTimeMs: 200,
      quotedAt: 0,
      expiresAt: Date.now() + 60_000,
      solverSignature: "0x" as `0x${string}`,
    };
    const q2: Quote = {
      solverId: "b",
      intentId: intent.envelope.id,
      commitment: "900000",
      estimatedFillTimeMs: 100,
      quotedAt: 0,
      expiresAt: Date.now() + 60_000,
      solverSignature: "0x" as `0x${string}`,
    };
    const q3: Quote = {
      solverId: "c",
      intentId: intent.envelope.id,
      commitment: "700000",
      estimatedFillTimeMs: 500,
      quotedAt: 0,
      expiresAt: Date.now() + 60_000,
      solverSignature: "0x" as `0x${string}`,
    };
    return { intent, q1, q2, q3 };
  }

  it("bestPrice for payment picks lowest commitment", async () => {
    const { intent, q1, q2, q3 } = await buildQuotes();
    const winner = pickBest([q1, q2, q3], intent, bestPrice);
    expect(winner?.solverId).toBe("c"); // 700k is cheapest
  });

  it("bestPrice for swap picks highest commitment", async () => {
    const intent = await makeSwapIntent();
    const q1: Quote = {
      solverId: "a",
      intentId: intent.envelope.id,
      commitment: "40000000000000000",
      estimatedFillTimeMs: 200,
      quotedAt: 0,
      expiresAt: Date.now() + 60_000,
      solverSignature: "0x" as `0x${string}`,
    };
    const q2: Quote = { ...q1, solverId: "b", commitment: "50000000000000000" };
    const winner = pickBest([q1, q2], intent, bestPrice);
    expect(winner?.solverId).toBe("b");
  });

  it("fastestFill picks lowest estimatedFillTimeMs", async () => {
    const { intent, q1, q2, q3 } = await buildQuotes();
    const winner = pickBest([q1, q2, q3], intent, fastestFill);
    expect(winner?.solverId).toBe("b"); // 100 ms
  });

  it("composite blends price, speed, and trust ranks", async () => {
    const { intent, q1, q2, q3 } = await buildQuotes();
    const picker = composite(
      { price: 0.5, speed: 0.4, trust: 0.1 },
      (id) => (id === "a" ? 1 : 0),
    );
    const winner = picker([q1, q2, q3], intent);
    // q1 has mid-price (rank 1 in price) + mid-speed (rank 1) + best
    // trust (rank 0). Weighted sum: 0.5*1 + 0.4*1 + 0.1*0 = 0.9.
    // q2: 0.5*2 + 0.4*0 + 0.1*1 = 1.1. q3: 0.5*0 + 0.4*2 + 0.1*2 = 1.0.
    // Lower weighted rank = better; q1 wins.
    expect(winner?.solverId).toBe("a");
  });
});

// ─── verifyFillAgainstQuote ────────────────────────────────────

describe("verifyFillAgainstQuote", () => {
  it("transfer: strict equality required", async () => {
    const intent = await makeTransferIntent({ amount: "100" });
    const quote: Quote = {
      solverId: "a",
      intentId: intent.envelope.id,
      commitment: "100",
      estimatedFillTimeMs: 0,
      quotedAt: 0,
      expiresAt: Date.now() + 60_000,
      solverSignature: "0x" as `0x${string}`,
    };
    expect(() =>
      verifyFillAgainstQuote(intent, quote, {
        intentId: intent.envelope.id,
        actualAmount: "100",
      }),
    ).not.toThrow();
    expect(() =>
      verifyFillAgainstQuote(intent, quote, {
        intentId: intent.envelope.id,
        actualAmount: "99",
      }),
    ).toThrow(FillMismatchError);
    expect(() =>
      verifyFillAgainstQuote(intent, quote, {
        intentId: intent.envelope.id,
        actualAmount: "101",
      }),
    ).toThrow(FillMismatchError);
  });

  it("swap: actualAmount >= commitment passes, less fails", async () => {
    const intent = await makeSwapIntent();
    const quote: Quote = {
      solverId: "a",
      intentId: intent.envelope.id,
      commitment: "30000000000000000",
      estimatedFillTimeMs: 0,
      quotedAt: 0,
      expiresAt: Date.now() + 60_000,
      solverSignature: "0x" as `0x${string}`,
    };
    expect(() =>
      verifyFillAgainstQuote(intent, quote, {
        intentId: intent.envelope.id,
        actualAmount: "30000000000000000",
      }),
    ).not.toThrow();
    expect(() =>
      verifyFillAgainstQuote(intent, quote, {
        intentId: intent.envelope.id,
        actualAmount: "30000000000000001",
      }),
    ).not.toThrow();
    expect(() =>
      verifyFillAgainstQuote(intent, quote, {
        intentId: intent.envelope.id,
        actualAmount: "29999999999999999",
      }),
    ).toThrow(FillMismatchError);
  });

  it("payment: actualAmount <= commitment passes, more fails", async () => {
    const intent = await makePaymentIntent();
    const quote: Quote = {
      solverId: "a",
      intentId: intent.envelope.id,
      commitment: "900000",
      estimatedFillTimeMs: 0,
      quotedAt: 0,
      expiresAt: Date.now() + 60_000,
      solverSignature: "0x" as `0x${string}`,
    };
    expect(() =>
      verifyFillAgainstQuote(intent, quote, {
        intentId: intent.envelope.id,
        actualAmount: "900000",
      }),
    ).not.toThrow();
    expect(() =>
      verifyFillAgainstQuote(intent, quote, {
        intentId: intent.envelope.id,
        actualAmount: "800000",
      }),
    ).not.toThrow();
    expect(() =>
      verifyFillAgainstQuote(intent, quote, {
        intentId: intent.envelope.id,
        actualAmount: "900001",
      }),
    ).toThrow(FillMismatchError);
  });
});

// ─── Router: happy + failure modes ─────────────────────────────

describe("IntentRouter.execute", () => {
  it("happy path: sign → quote → pick → settle → fulfilled", async () => {
    const intent = await makeTransferIntent({ amount: "100" });
    const solverA = mockSolver("a");
    const solverB = mockSolver("b");
    const registry = new InMemorySolverRegistry([solverA, solverB]);
    const audit = collectingAuditSink();
    const router = new IntentRouter({ registry, auditSink: audit.sink });

    const result = await router.execute(intent);

    expect(result.outcome.kind).toBe("fulfilled");
    if (result.outcome.kind === "fulfilled") {
      expect(result.outcome.fill.actualAmount).toBe("100");
    }
    expect(result.quotes).toHaveLength(2);

    // Audit trail: at minimum intent-submitted, quotes-solicited,
    // 2x quote-received, quote-chosen, settlement-succeeded.
    const types = audit.events.map((e) => e.type);
    expect(types).toContain("intent-submitted");
    expect(types).toContain("quotes-solicited");
    expect(types.filter((t) => t === "quote-received")).toHaveLength(2);
    expect(types).toContain("quote-chosen");
    expect(types).toContain("settlement-succeeded");
  });

  it("throws when no solvers registered for kind", async () => {
    const intent = await makeTransferIntent();
    const registry = new InMemorySolverRegistry([]);
    const router = new IntentRouter({ registry });
    await expect(router.execute(intent)).rejects.toMatchObject({
      code: "no-solvers-available",
    });
  });

  it("returns no-quotes outcome when all solvers decline", async () => {
    const intent = await makeTransferIntent();
    const declining = mockSolver("declining", {
      async quote() {
        return null;
      },
    });
    const registry = new InMemorySolverRegistry([declining]);
    const router = new IntentRouter({ registry });
    const result = await router.execute(intent);
    expect(result.outcome.kind).toBe("no-quotes");
  });

  it("returns settlement-failed outcome when solver.settle throws", async () => {
    const intent = await makeTransferIntent();
    const failing = mockSolver("failing", {
      async settle() {
        throw new Error("broken pipe");
      },
    });
    const registry = new InMemorySolverRegistry([failing]);
    const router = new IntentRouter({ registry });
    const result = await router.execute(intent);
    expect(result.outcome.kind).toBe("settlement-failed");
    if (result.outcome.kind === "settlement-failed") {
      expect(result.outcome.error).toContain("broken pipe");
    }
  });

  it("rejects intent with expired deadline", async () => {
    const intent = await makeTransferIntent({ deadline: Date.now() - 1000 });
    const router = new IntentRouter({ registry: new InMemorySolverRegistry([mockSolver("a")]) });
    await expect(router.execute(intent)).rejects.toMatchObject({
      code: "intent-expired",
    });
  });

  it("rejects reused nonce", async () => {
    const intent = await makeTransferIntent();
    const registry = new InMemorySolverRegistry([mockSolver("a")]);
    const router = new IntentRouter({ registry }, new InMemoryNonceStore());
    await router.execute(intent);
    await expect(router.execute(intent)).rejects.toMatchObject({
      code: "intent-nonce-reused",
    });
  });

  it("declines malformed solver response (wrong solverId)", async () => {
    const intent = await makeTransferIntent();
    const liar = mockSolver("liar", {
      async quote(i: Intent) {
        return {
          solverId: "not-me", // mismatch
          intentId: i.envelope.id,
          commitment: "0",
          estimatedFillTimeMs: 0,
          quotedAt: 0,
          expiresAt: Date.now() + 60_000,
          solverSignature: "0x" as `0x${string}`,
        };
      },
    });
    const registry = new InMemorySolverRegistry([liar]);
    const router = new IntentRouter({ registry });
    const result = await router.execute(intent);
    expect(result.outcome.kind).toBe("no-quotes");
  });

  it("declines pre-expired quotes", async () => {
    const intent = await makeTransferIntent();
    const stale = mockSolver("stale", {
      async quote(i: Intent) {
        return {
          solverId: "stale",
          intentId: i.envelope.id,
          commitment: "0",
          estimatedFillTimeMs: 0,
          quotedAt: 0,
          expiresAt: Date.now() - 10_000, // already expired
          solverSignature: "0x" as `0x${string}`,
        };
      },
    });
    const registry = new InMemorySolverRegistry([stale]);
    const router = new IntentRouter({ registry });
    const result = await router.execute(intent);
    expect(result.outcome.kind).toBe("no-quotes");
  });

  it("enforces per-solver quote timeout", async () => {
    const intent = await makeTransferIntent();
    const slow = mockSolver("slow", {
      async quote() {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return null;
      },
    });
    const registry = new InMemorySolverRegistry([slow]);
    const router = new IntentRouter({ registry, solverQuoteTimeoutMs: 10 });
    const result = await router.execute(intent);
    expect(result.outcome.kind).toBe("no-quotes");
  });

  it("payment-gated outcome when paymentGate denies", async () => {
    const intent = await makePaymentIntent();
    const solver = mockSolver("s", { supportedIntentKinds: ["payment"] });
    const registry = new InMemorySolverRegistry([solver]);
    const router = new IntentRouter({
      registry,
      paymentGate: {
        async evaluate() {
          return {
            allowed: false,
            failedRuleIds: ["require-registered-agent"],
            evaluation: null,
          };
        },
      },
    });
    const result = await router.execute(intent);
    expect(result.outcome.kind).toBe("payment-gated");
  });

  it("paymentGate allowing proceeds to quoting", async () => {
    const intent = await makePaymentIntent();
    const solver = mockSolver("s", { supportedIntentKinds: ["payment"] });
    const registry = new InMemorySolverRegistry([solver]);
    const router = new IntentRouter({
      registry,
      paymentGate: {
        async evaluate() {
          return { allowed: true, evaluation: null };
        },
      },
    });
    const result = await router.execute(intent);
    expect(result.outcome.kind).toBe("fulfilled");
  });

  it("paymentGate runs for transfer intents (not payment-only)", async () => {
    const intent = await makeTransferIntent();
    const solver = mockSolver("s", { supportedIntentKinds: ["transfer"] });
    const registry = new InMemorySolverRegistry([solver]);
    let seenKind: string | null = null;
    const router = new IntentRouter({
      registry,
      paymentGate: {
        async evaluate(i) {
          seenKind = i.body.kind;
          return { allowed: true, evaluation: null };
        },
      },
    });
    await router.execute(intent);
    expect(seenKind).toBe("transfer");
  });

  it("paymentGate runs for swap intents (not payment-only)", async () => {
    const intent = await makeSwapIntent();
    const solver = mockSolver("s", { supportedIntentKinds: ["swap"] });
    const registry = new InMemorySolverRegistry([solver]);
    let seenKind: string | null = null;
    const router = new IntentRouter({
      registry,
      paymentGate: {
        async evaluate(i) {
          seenKind = i.body.kind;
          return { allowed: true, evaluation: null };
        },
      },
    });
    await router.execute(intent);
    expect(seenKind).toBe("swap");
  });

  it("paymentGate denial surfaces payment-gated outcome for transfer intents", async () => {
    const intent = await makeTransferIntent();
    const solver = mockSolver("s", { supportedIntentKinds: ["transfer"] });
    const registry = new InMemorySolverRegistry([solver]);
    const router = new IntentRouter({
      registry,
      paymentGate: {
        async evaluate() {
          return {
            allowed: false,
            failedRuleIds: ["require-registered-agent"],
            evaluation: null,
          };
        },
      },
    });
    const result = await router.execute(intent);
    expect(result.outcome.kind).toBe("payment-gated");
  });
});
