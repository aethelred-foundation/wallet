/**
 * Property-based tests for `IntentRouter.execute()` outcomes.
 *
 * Where the unit suite (intent-router.test.ts, solver-trio-demo.test.ts, etc.)
 * pins specific scenarios, this file pins INVARIANTS that must hold for any
 * valid intent + solver registry + gate configuration. fast-check generates
 * a randomised intent body per iteration and asserts:
 *
 *   1. Outcome closure — `result.outcome.kind` is always in the documented
 *      closed set `{fulfilled, no-quotes, settlement-failed, payment-gated}`,
 *      no surprise kinds.
 *
 *   2. Commitment-rule invariants on `fulfilled`:
 *        transfer: `actualAmount === quoteCommitment`
 *        swap:     `actualAmount >= quoteCommitment`
 *        payment:  `actualAmount <= quoteCommitment`
 *
 *   3. Dispatch correctness — `fill.solverId` matches the expected solver
 *      for the intent's kind. The registry never crosses streams.
 *
 *   4. Gate denial precludes fill — when the gate denies, no Fill is
 *      emitted; `evaluation.failedRuleIds` is non-empty.
 *
 *   5. Audit sequence on fulfilled — emits the documented 5-event chain
 *      (intent-submitted → quotes-solicited → quote-received → quote-chosen
 *      → settlement-succeeded).
 *
 * Run counts are dialled down vs. pure-function property tests because each
 * iteration performs a real EIP-712 sign + a full router execution. 30
 * iterations per property is enough to surface state-space issues without
 * making CI sluggish.
 */

import { beforeAll, describe, expect, it } from "vitest";
import * as fc from "fast-check";

import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import {
  composeGatesByIntentKind,
  createSignedIntent,
  InMemorySolverRegistry,
  IntentRouter,
  ReputationPaymentGate,
  ReputationSwapGate,
  ReputationTransferGate,
  type Intent,
  type IntentExecutionResult,
  type IntentRouterAuditEvent,
  type Solver,
} from "@aethelred/wallet-intent-router";
import type {
  AnchorChainProvider,
  TxReceipt,
} from "@aethelred/wallet-notarization";
import {
  InMemoryERC8004Resolver,
  type AgentIdentity,
  type GateCredentialSource,
  type Issuer,
  type SerializedVcGate,
  type VerifiableCredential,
} from "@aethelred/wallet-reputation";
import { StubSwapVenue, SwapSolver } from "@aethelred/wallet-swap-solver";
import { TransferSolver } from "@aethelred/wallet-transfer-solver";
import { X402FacilitatorSolver } from "@aethelred/wallet-x402-solver";
import type {
  PaymentReceipt,
  PaymentRequirement,
  TypedDataSigner,
} from "@aethelred/wallet-x402";

// ─── Constants ──────────────────────────────────────

const PK_AGENT = "0x" + "01".repeat(32);
const CHAIN_ID = 8453;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`;
const WETH = "0x4200000000000000000000000000000000000006" as `0x${string}`;
const MERCHANT = ("0x" + "aa".repeat(20)) as `0x${string}`;
const SWAP_RECIP = ("0x" + "bb".repeat(20)) as `0x${string}`;
const STUB_ROUTER = ("0x" + "cc".repeat(20)) as `0x${string}`;

const TRANSFER_SOLVER_ID = "transfer:base-mainnet";
const SWAP_SOLVER_ID = "swap:stub:base-mainnet";
const X402_SOLVER_ID = "x402-facilitator:base-mainnet";

const OPERATOR_POLICY: SerializedVcGate = {
  combinator: "all",
  directives: [
    { type: "require-registered-agent" },
    { type: "require-not-revoked" },
  ],
};

// ─── Harness ────────────────────────────────────────

class PropChainProvider implements AnchorChainProvider {
  readonly chainId: number;
  private nextIdx = 0;
  private readonly receipts = new Map<string, TxReceipt>();

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  async sendTransaction(req: {
    readonly to: `0x${string}`;
    readonly data: `0x${string}`;
    readonly value?: bigint;
  }): Promise<`0x${string}`> {
    const txHash = ("0x" +
      "ee".repeat(28) +
      this.nextIdx.toString(16).padStart(8, "0")) as `0x${string}`;
    this.nextIdx += 1;
    void req;
    this.receipts.set(txHash.toLowerCase(), {
      transactionHash: txHash,
      blockNumber: 1n + BigInt(this.nextIdx),
      status: "success",
      logs: [],
      gasUsed: 60_000n,
      effectiveGasPrice: 500_000n,
    });
    return txHash;
  }

  async getTransactionReceipt(txHash: `0x${string}`): Promise<TxReceipt | null> {
    return this.receipts.get(txHash.toLowerCase()) ?? null;
  }
}

function emptyCredentialSource(): GateCredentialSource {
  return {
    async listVerifiedCredentials(): Promise<ReadonlyArray<VerifiableCredential>> {
      return [];
    },
    listTrustedIssuers(): ReadonlyArray<Issuer> {
      return [];
    },
  };
}

function makeAgentIdentity(controlAddress: `0x${string}`): AgentIdentity {
  return {
    agentId: ("0x" + "aa".repeat(32)) as `0x${string}`,
    controlAddress,
    operatorAddress: ("0x" + "22".repeat(20)) as `0x${string}`,
    policyRoot: ("0x" + "33".repeat(32)) as `0x${string}`,
    reputationRoot: ("0x" + "44".repeat(32)) as `0x${string}`,
    registeredAt: 1_700_000_000_000,
    revoked: false,
  };
}

/**
 * Stub x402 fetch — alternates [402, 200, 402, 200, ...] by call parity
 * so multi-iteration property tests don't fall off the handshake script.
 */
function stubX402Fetch(opts: {
  readonly resource: string;
  readonly payTo: `0x${string}`;
  readonly asset: `0x${string}`;
  readonly maxAmountRequired: string;
}): typeof fetch {
  let call = 0;
  return (async (): Promise<Response> => {
    call += 1;
    if (call % 2 === 1) {
      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "base-mainnet",
        maxAmountRequired: opts.maxAmountRequired,
        resource: opts.resource,
        description: "property test resource",
        payTo: opts.payTo,
        maxTimeoutSeconds: 60,
        asset: opts.asset,
      };
      return new Response(
        JSON.stringify({ x402Version: 1, accepts: [requirement] }),
        { status: 402, headers: { "content-type": "application/json" } },
      );
    }
    const receipt: PaymentReceipt = {
      x402Version: 1,
      scheme: "exact",
      network: "base-mainnet",
      txHash: ("0x" + "fe".repeat(32)) as `0x${string}`,
      pending: false,
      acceptedAt: Math.floor(Date.now() / 1000),
      paymentId: ("0x" + "fa".repeat(32)) as `0x${string}`,
    };
    return new Response("paid", {
      status: 200,
      headers: {
        "X-PAYMENT-RESPONSE": Buffer.from(JSON.stringify(receipt)).toString(
          "base64",
        ),
      },
    });
  }) as typeof fetch;
}

interface Harness {
  readonly router: IntentRouter;
  readonly signer: TypedDataSigner;
  readonly auditEvents: IntentRouterAuditEvent[];
}

function makeHarness(opts: { readonly skipAgentRegistration?: boolean } = {}): Harness {
  const custody = new LocalKeyAdapter({ privateKey: PK_AGENT });
  const signer = custody.asTypedDataSigner();
  const provider = new PropChainProvider(CHAIN_ID);
  const resolver = new InMemoryERC8004Resolver(
    opts.skipAgentRegistration ? [] : [{ identity: makeAgentIdentity(signer.address) }],
  );
  const credentialSource = emptyCredentialSource();

  const transferSolver = new TransferSolver({
    id: TRANSFER_SOLVER_ID,
    name: "Transfer",
    from: signer.address,
    provider,
    sleep: async () => {},
  });

  const swapVenue = new StubSwapVenue({
    id: "stub-venue",
    chainId: CHAIN_ID,
    router: STUB_ROUTER,
    priceNumerator: 270_000_000_000_000n,
    priceDenominator: 1_000_000n,
  });
  const swapSolver = new SwapSolver({
    id: SWAP_SOLVER_ID,
    name: "Swap",
    from: signer.address,
    provider,
    venue: swapVenue,
    internalSlippageBps: 50,
    sleep: async () => {},
  });

  const x402Solver = new X402FacilitatorSolver({
    id: X402_SOLVER_ID,
    name: "X402",
    signer,
    supportedNetworks: ["base-mainnet"],
    fetch: stubX402Fetch({
      resource: "https://api.example.com/r",
      payTo: MERCHANT,
      asset: USDC,
      maxAmountRequired: "950000",
    }),
  });

  const composedGate = composeGatesByIntentKind({
    transfer: new ReputationTransferGate({
      gate: OPERATOR_POLICY,
      resolver,
      credentialSource,
    }),
    swap: new ReputationSwapGate({
      gate: OPERATOR_POLICY,
      resolver,
      credentialSource,
    }),
    payment: new ReputationPaymentGate({ resolver, credentialSource }),
  });

  const auditEvents: IntentRouterAuditEvent[] = [];
  const registry = new InMemorySolverRegistry([
    transferSolver as unknown as Solver,
    swapSolver as unknown as Solver,
    x402Solver as unknown as Solver,
  ]);
  const router = new IntentRouter({
    registry,
    paymentGate: composedGate,
    auditSink: {
      emit(event: IntentRouterAuditEvent) {
        auditEvents.push(event);
      },
    },
  });

  return { router, signer, auditEvents };
}

// ─── Arbitraries ────────────────────────────────────

const transferBodyArb = fc.bigInt({ min: 1n, max: 10n ** 15n }).map((amount) => ({
  kind: "transfer" as const,
  asset: USDC,
  amount: amount.toString(),
  recipient: MERCHANT,
}));

const swapBodyArb = fc
  .bigInt({ min: 1_000_000n, max: 10_000_000n })
  .map((sellAmount) => {
    const mid = (sellAmount * 270_000_000_000_000n) / 1_000_000n;
    const floor = (mid * 9950n) / 10_000n;
    return {
      kind: "swap" as const,
      sellAsset: USDC,
      sellAmount: sellAmount.toString(),
      buyAsset: WETH,
      minBuyAmount: (floor / 2n).toString(),
      recipient: SWAP_RECIP,
    };
  });

const paymentBodyArb = fc
  .bigInt({ min: 1_000_000n, max: 100_000_000n })
  .map((maxAmount) => ({
    kind: "payment" as const,
    asset: USDC,
    maxAmount: maxAmount.toString(),
    merchant: MERCHANT,
    resource: "https://api.example.com/r",
    extra: { vcGate: OPERATOR_POLICY },
  }));

const FAST_CHECK_RUNS = { numRuns: 30 };
const VALID_OUTCOME_KINDS = [
  "fulfilled",
  "no-quotes",
  "settlement-failed",
  "payment-gated",
] as const;

async function execIntent(
  h: Harness,
  body: Intent["body"],
): Promise<{ result: IntentExecutionResult; intent: Intent }> {
  const intent = await createSignedIntent({
    body,
    creator: h.signer.address,
    chainId: CHAIN_ID,
    deadlineMs: Date.now() + 60_000,
    signer: h.signer,
  });
  const result = await h.router.execute(intent);
  return { result, intent };
}

// ─── Happy-path properties ──────────────────────────

describe("IntentRouter.execute property invariants — happy path", () => {
  let harness: Harness;
  beforeAll(() => {
    harness = makeHarness();
  });

  it("outcome.kind is always in the closed set for transfer intents", async () => {
    await fc.assert(
      fc.asyncProperty(transferBodyArb, async (body) => {
        const { result } = await execIntent(harness, body);
        expect(VALID_OUTCOME_KINDS as readonly string[]).toContain(
          result.outcome.kind,
        );
      }),
      FAST_CHECK_RUNS,
    );
  });

  it("outcome.kind is always in the closed set for swap intents", async () => {
    await fc.assert(
      fc.asyncProperty(swapBodyArb, async (body) => {
        const { result } = await execIntent(harness, body);
        expect(VALID_OUTCOME_KINDS as readonly string[]).toContain(
          result.outcome.kind,
        );
      }),
      FAST_CHECK_RUNS,
    );
  });

  it("outcome.kind is always in the closed set for payment intents", async () => {
    await fc.assert(
      fc.asyncProperty(paymentBodyArb, async (body) => {
        const { result } = await execIntent(harness, body);
        expect(VALID_OUTCOME_KINDS as readonly string[]).toContain(
          result.outcome.kind,
        );
      }),
      FAST_CHECK_RUNS,
    );
  });

  it("transfer: actualAmount === quoteCommitment whenever fulfilled", async () => {
    await fc.assert(
      fc.asyncProperty(transferBodyArb, async (body) => {
        const { result } = await execIntent(harness, body);
        if (result.outcome.kind !== "fulfilled") return;
        const fill = result.outcome.fill;
        expect(BigInt(fill.actualAmount)).toBe(BigInt(fill.quoteCommitment));
      }),
      FAST_CHECK_RUNS,
    );
  });

  it("swap: actualAmount >= quoteCommitment whenever fulfilled", async () => {
    await fc.assert(
      fc.asyncProperty(swapBodyArb, async (body) => {
        const { result } = await execIntent(harness, body);
        if (result.outcome.kind !== "fulfilled") return;
        const fill = result.outcome.fill;
        expect(BigInt(fill.actualAmount)).toBeGreaterThanOrEqual(
          BigInt(fill.quoteCommitment),
        );
      }),
      FAST_CHECK_RUNS,
    );
  });

  it("payment: actualAmount <= quoteCommitment whenever fulfilled", async () => {
    await fc.assert(
      fc.asyncProperty(paymentBodyArb, async (body) => {
        const { result } = await execIntent(harness, body);
        if (result.outcome.kind !== "fulfilled") return;
        const fill = result.outcome.fill;
        expect(BigInt(fill.actualAmount)).toBeLessThanOrEqual(
          BigInt(fill.quoteCommitment),
        );
      }),
      FAST_CHECK_RUNS,
    );
  });

  it("transfer fills are always served by the transfer solver", async () => {
    await fc.assert(
      fc.asyncProperty(transferBodyArb, async (body) => {
        const { result } = await execIntent(harness, body);
        if (result.outcome.kind !== "fulfilled") return;
        expect(result.outcome.fill.solverId).toBe(TRANSFER_SOLVER_ID);
      }),
      FAST_CHECK_RUNS,
    );
  });

  it("swap fills are always served by the swap solver", async () => {
    await fc.assert(
      fc.asyncProperty(swapBodyArb, async (body) => {
        const { result } = await execIntent(harness, body);
        if (result.outcome.kind !== "fulfilled") return;
        expect(result.outcome.fill.solverId).toBe(SWAP_SOLVER_ID);
      }),
      FAST_CHECK_RUNS,
    );
  });

  it("payment fills are always served by the x402 solver", async () => {
    await fc.assert(
      fc.asyncProperty(paymentBodyArb, async (body) => {
        const { result } = await execIntent(harness, body);
        if (result.outcome.kind !== "fulfilled") return;
        expect(result.outcome.fill.solverId).toBe(X402_SOLVER_ID);
      }),
      FAST_CHECK_RUNS,
    );
  });

  it("fulfilled outcomes emit the 5-event audit chain", async () => {
    await fc.assert(
      fc.asyncProperty(transferBodyArb, async (body) => {
        const startIdx = harness.auditEvents.length;
        const { result } = await execIntent(harness, body);
        if (result.outcome.kind !== "fulfilled") return;
        const newEvents = harness.auditEvents.slice(startIdx);
        const types = new Set(newEvents.map((e) => e.type));
        expect(types).toContain("intent-submitted");
        expect(types).toContain("quotes-solicited");
        expect(types).toContain("quote-received");
        expect(types).toContain("quote-chosen");
        expect(types).toContain("settlement-succeeded");
      }),
      FAST_CHECK_RUNS,
    );
  });
});

// ─── Deny-path properties ───────────────────────────

describe("IntentRouter.execute property invariants — gate-denied path", () => {
  let denyHarness: Harness;
  beforeAll(() => {
    denyHarness = makeHarness({ skipAgentRegistration: true });
  });

  it("gate denies → outcome is payment-gated for ANY intent kind", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(transferBodyArb, swapBodyArb, paymentBodyArb),
        async (body) => {
          const { result } = await execIntent(denyHarness, body);
          expect(result.outcome.kind).toBe("payment-gated");
        },
      ),
      FAST_CHECK_RUNS,
    );
  });

  it("gate denies → no fill emitted, evaluation has failedRuleIds", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(transferBodyArb, swapBodyArb, paymentBodyArb),
        async (body) => {
          const { result } = await execIntent(denyHarness, body);
          if (result.outcome.kind !== "payment-gated") {
            throw new Error(
              `expected payment-gated, got ${result.outcome.kind}`,
            );
          }
          expect(result.outcome.evaluation.allowed).toBe(false);
          expect(
            result.outcome.evaluation.failedRuleIds.length,
          ).toBeGreaterThan(0);
        },
      ),
      FAST_CHECK_RUNS,
    );
  });
});
