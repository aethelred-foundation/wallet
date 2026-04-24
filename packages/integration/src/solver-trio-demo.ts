/**
 * `runSolverTrioDemo` — proves the `Solver` contract AND the
 * reputation-gate trio compose across all three intent kinds.
 *
 *   ONE `IntentRouter`
 *     ├─ ONE `InMemorySolverRegistry` with THREE concrete solvers
 *     └─ ONE composed `paymentGate` with THREE reputation gates
 *           (dispatch is kind-indexed via `composeGatesByIntentKind`)
 *
 *                                          ┌─ commitment rule ──┐
 *     transfer intent  ──▶ TransferGate ──▶ TransferSolver (===)
 *     swap intent      ──▶ SwapGate      ──▶ SwapSolver      (>=)
 *     payment intent   ──▶ PaymentGate   ──▶ X402 Solver     (<=)
 *
 * Returns a structured result capturing, for each intent:
 *   - Which solver served it (id)
 *   - The commitment rule that applied
 *   - actualAmount vs quote commitment (both as bigint strings)
 *   - The fill's settlementRef
 *   - The PaymentGateResult captured during router.execute — so the
 *     CLI can surface both pass and fail paths (the router otherwise
 *     only exposes evaluation on denial).
 *   - All intent-router audit events emitted during the run
 *
 * Sibling artifact to `runEndToEndDemo()`: where that exercises
 * compliance DEPTH (one intent, every gate), this exercises
 * composition BREADTH (three intents, THREE solvers, THREE gates,
 * one dispatch surface) — all through one router.
 *
 * Design calls:
 *
 *   - **Single LocalKey signer, not Nitro.** The trio demo is about
 *     solver/gate dispatch. LocalKey keeps the narrative uncluttered.
 *     The moat demo covers the Nitro story.
 *
 *   - **One operator policy reused across transfer + swap + payment.**
 *     The transfer and swap gates read their policy from config; the
 *     payment gate reads it from `intent.body.extra.vcGate`. To show
 *     the payment gate evaluating non-trivially, the payment intent
 *     carries the SAME serialised policy in its `extra` — mirroring
 *     what an x402 client does when it copies `PaymentRequirement.
 *     extra.vcGate` into the intent body.
 *
 *   - **Gate capture via wrapper spy.** The router exposes gate
 *     evaluations only on DENIAL outcomes; fulfilled outcomes omit
 *     them. We wrap the composed gate in a tiny spy that records
 *     `intentId → PaymentGateResult` so the demo's CLI can show
 *     evaluations for both pass and fail paths uniformly.
 *
 *   - **Shared chain provider across transfer + swap.** Both submit
 *     txs via the same `AnchorChainProvider` instance.
 *
 *   - **In-line simulated chain + fetch.** Kept local to the demo file
 *     so the demo reads as one self-contained story.
 */

import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import {
  composeGatesByIntentKind,
  createSignedIntent,
  InMemorySolverRegistry,
  IntentRouter,
  ReputationPaymentGate,
  ReputationSwapGate,
  ReputationTransferGate,
  type Fill,
  type Intent,
  type IntentExecutionResult,
  type IntentRouterAuditEvent,
  type PaymentGate,
  type PaymentGateResult,
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
import {
  X402FacilitatorSolver,
} from "@aethelred/wallet-x402-solver";
import type {
  PaymentReceipt,
  PaymentRequirement,
  TypedDataSigner,
} from "@aethelred/wallet-x402";

// ─── Demo inputs + outputs ───────────────────────────────

export interface SolverTrioDemoConfig {
  /** Override clock for deterministic tests. */
  readonly now?: () => number;

  /**
   * When `true`, DON'T seed the ERC-8004 resolver with the agent
   * identity. The three reputation gates then fail-closed (the
   * synthesised placeholder's `revoked: true` trips
   * `require-not-revoked`) and every intent's outcome is
   * `payment-gated`.
   *
   * Powers the `--deny` CLI flag — the deny-path narrative proves
   * the gate rejection logic renders correctly end-to-end, which
   * is what customers ask to see after "show me the happy path."
   */
  readonly skipAgentRegistration?: boolean;
}

export interface SolverTrioIntentResult {
  /** "transfer" | "swap" | "payment" — the intent kind submitted. */
  readonly kind: "transfer" | "swap" | "payment";
  /** Human label for pretty output. */
  readonly label: string;
  /** Commitment-rule that applied. */
  readonly rule: "=== commitment" | ">= commitment" | "<= commitment";
  readonly solverId: string;
  readonly intent: Intent;
  readonly executionResult: IntentExecutionResult;
  readonly fill?: Fill;
  /** `commitment == actualAmount` per the rule? */
  readonly commitmentRuleHeld: boolean;
  /**
   * Gate evaluation captured during `router.execute`. Always
   * present (the demo wires a paymentGate that runs on every
   * kind); absent only if the router short-circuited before the
   * gate ran (e.g. signature invalid) — in which case the intent
   * wouldn't reach the solver either.
   */
  readonly gateResult?: PaymentGateResult;
}

export interface SolverTrioDemoResult {
  readonly agentAddress: `0x${string}`;
  readonly chainId: number;
  /** The operator policy applied to all three gates. Display-only. */
  readonly operatorPolicy: SerializedVcGate;
  /**
   * `true` when `skipAgentRegistration` was set — lets the CLI
   * (and tests) distinguish expected-denial from unexpected-denial
   * without peeking at orchestrator internals.
   */
  readonly denyModeExpected: boolean;
  readonly results: ReadonlyArray<SolverTrioIntentResult>;
  readonly auditEvents: ReadonlyArray<IntentRouterAuditEvent>;
}

// ─── Fixtures (demo-local) ───────────────────────────────

const CHAIN_ID = 8453; // Base mainnet
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`;
const WETH = "0x4200000000000000000000000000000000000006" as `0x${string}`;
const MERCHANT_RECIPIENT = ("0x" + "aa".repeat(20)) as `0x${string}`;
const SWAP_RECIPIENT = ("0x" + "bb".repeat(20)) as `0x${string}`;
const STUB_ROUTER = ("0x" + "cc".repeat(20)) as `0x${string}`;

/** Deterministic private key for the agent. */
const AGENT_PK = ("0x" + "01".repeat(32)) as `0x${string}`;

/**
 * The operator policy applied to all three gates. Keeps the demo
 * narrative tight: one policy → gates everywhere.
 *
 * In production, payment gates typically read their policy from
 * counterparty-declared `extra.vcGate`; here we put the SAME policy
 * in the payment intent's `body.extra.vcGate` so all three gates
 * evaluate against the same directives.
 */
const OPERATOR_POLICY: SerializedVcGate = {
  combinator: "all",
  directives: [
    { type: "require-registered-agent" },
    { type: "require-not-revoked" },
  ],
};

/**
 * Generic in-memory `AnchorChainProvider`. Accepts any tx, returns
 * a success receipt immediately. Used by transfer-solver +
 * swap-solver in the demo.
 */
class DemoChainProvider implements AnchorChainProvider {
  readonly chainId: number;
  readonly calls: Array<{
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
  }> = [];
  private nextIdx = 0;
  private readonly receipts = new Map<string, TxReceipt>();

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  async sendTransaction(request: {
    readonly to: `0x${string}`;
    readonly data: `0x${string}`;
    readonly value?: bigint;
  }): Promise<`0x${string}`> {
    const txHash = ("0x" +
      "de".repeat(28) +
      this.nextIdx.toString(16).padStart(8, "0")) as `0x${string}`;
    this.nextIdx += 1;
    this.calls.push({ ...request });
    this.receipts.set(txHash.toLowerCase(), {
      transactionHash: txHash,
      blockNumber: 2_000_000n + BigInt(this.nextIdx),
      status: "success",
      logs: [],
    });
    return txHash;
  }

  async getTransactionReceipt(txHash: `0x${string}`): Promise<TxReceipt | null> {
    return this.receipts.get(txHash.toLowerCase()) ?? null;
  }
}

/**
 * Empty credential source — no VCs needed for the demo's simple
 * policy (registered + not revoked). Realistic deployments plug in
 * a credentials-store adapter.
 */
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

/**
 * Build the ERC-8004 identity record for the agent. Stable ids keep
 * the demo deterministic (audit event bodies line up across runs).
 */
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
 * Stub `fetch` that simulates the x402 two-request handshake. First
 * call returns 402 + requirement; second returns 200 + receipt.
 */
function stubX402Fetch(opts: {
  readonly resource: string;
  readonly payTo: `0x${string}`;
  readonly asset: `0x${string}`;
  readonly maxAmountRequired: string;
}): typeof fetch {
  let call = 0;
  return (async (_input: RequestInfo | URL): Promise<Response> => {
    call += 1;
    if (call === 1) {
      const requirement: PaymentRequirement = {
        scheme: "exact",
        network: "base-mainnet",
        maxAmountRequired: opts.maxAmountRequired,
        resource: opts.resource,
        description: "solver-trio demo resource",
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
    const headerVal = Buffer.from(JSON.stringify(receipt)).toString("base64");
    return new Response("paid", {
      status: 200,
      headers: { "X-PAYMENT-RESPONSE": headerVal },
    });
  }) as typeof fetch;
}

/**
 * Wrap a `PaymentGate` in a spy that records each evaluation keyed
 * by intent id. The router's `paymentGate` contract exposes
 * evaluations only on denial; we capture them uniformly for both
 * pass and fail outcomes so the CLI can surface them.
 */
function capturePaymentGate(inner: PaymentGate): {
  readonly gate: PaymentGate;
  readonly captures: Map<`0x${string}`, PaymentGateResult>;
} {
  const captures = new Map<`0x${string}`, PaymentGateResult>();
  const gate: PaymentGate = {
    async evaluate(intent: Intent): Promise<PaymentGateResult> {
      const result = await inner.evaluate(intent);
      captures.set(intent.envelope.id, result);
      return result;
    },
  };
  return { gate, captures };
}

// ─── Orchestrator ────────────────────────────────────────

export async function runSolverTrioDemo(
  config: SolverTrioDemoConfig = {},
): Promise<SolverTrioDemoResult> {
  const now = config.now ?? (() => Date.now());

  // ─── 1. Agent signer + identity (LocalKey + ERC-8004) ──
  const custody = new LocalKeyAdapter({ privateKey: AGENT_PK });
  const signer: TypedDataSigner = custody.asTypedDataSigner();
  const agentAddress = signer.address;

  // Happy path seeds the resolver with the agent identity; deny
  // path leaves it empty so the gates fail-closed.
  const resolver = new InMemoryERC8004Resolver(
    config.skipAgentRegistration
      ? []
      : [{ identity: makeAgentIdentity(agentAddress) }],
  );
  const credentialSource = emptyCredentialSource();

  // ─── 2. Shared chain provider for transfer + swap ──
  const chainProvider = new DemoChainProvider(CHAIN_ID);

  // ─── 3. Solver: transfer ───────────────────────────
  const transferSolver = new TransferSolver({
    id: "transfer:base-mainnet",
    name: "Aethelred Transfer Solver (Base)",
    from: agentAddress,
    provider: chainProvider,
    now,
    sleep: async () => {},
  });

  // ─── 4. Solver: swap, backed by StubSwapVenue ──────
  const swapVenue = new StubSwapVenue({
    id: "stub-swap-venue",
    chainId: CHAIN_ID,
    router: STUB_ROUTER,
    priceNumerator: 270_000_000_000_000n,
    priceDenominator: 1_000_000n,
  });
  const swapSolver = new SwapSolver({
    id: "swap:stub:base-mainnet",
    name: "Aethelred Swap Solver (Stub / Base)",
    from: agentAddress,
    provider: chainProvider,
    venue: swapVenue,
    internalSlippageBps: 50,
    now,
    sleep: async () => {},
  });

  // ─── 5. Solver: x402 facilitator ───────────────────
  const paymentResource = "https://api.example.com/premium-data";
  const paymentMax = "1000000";
  const x402Solver = new X402FacilitatorSolver({
    id: "x402-facilitator:base-mainnet",
    name: "Aethelred x402 Facilitator (Base)",
    signer,
    supportedNetworks: ["base-mainnet"],
    fetch: stubX402Fetch({
      resource: paymentResource,
      payTo: MERCHANT_RECIPIENT,
      asset: USDC,
      maxAmountRequired: "950000",
    }),
    now,
  });

  // ─── 6. Reputation gates ───────────────────────────
  const composedGate = composeGatesByIntentKind({
    transfer: new ReputationTransferGate({
      gate: OPERATOR_POLICY,
      resolver,
      credentialSource,
      now,
    }),
    swap: new ReputationSwapGate({
      gate: OPERATOR_POLICY,
      resolver,
      credentialSource,
      now,
    }),
    payment: new ReputationPaymentGate({
      resolver,
      credentialSource,
      now,
    }),
  });
  const { gate: capturedGate, captures: gateCaptures } =
    capturePaymentGate(composedGate);

  // ─── 7. Router with registry AND paymentGate ───────
  const auditEvents: IntentRouterAuditEvent[] = [];
  const registry = new InMemorySolverRegistry([
    transferSolver as unknown as Solver,
    swapSolver as unknown as Solver,
    x402Solver as unknown as Solver,
  ]);
  const router = new IntentRouter({
    registry,
    paymentGate: capturedGate,
    now,
    auditSink: {
      emit(event: IntentRouterAuditEvent) {
        auditEvents.push(event);
      },
    },
  });

  // ─── 8. Intents ────────────────────────────────────
  const deadlineMs = now() + 5 * 60_000;

  const transferIntent = await createSignedIntent({
    body: {
      kind: "transfer",
      asset: USDC,
      amount: "1000000",
      recipient: MERCHANT_RECIPIENT,
    },
    creator: agentAddress,
    chainId: CHAIN_ID,
    deadlineMs,
    signer,
  });

  const swapIntent = await createSignedIntent({
    body: {
      kind: "swap",
      sellAsset: USDC,
      sellAmount: "1000000",
      buyAsset: WETH,
      minBuyAmount: "260000000000000",
      recipient: SWAP_RECIPIENT,
    },
    creator: agentAddress,
    chainId: CHAIN_ID,
    deadlineMs,
    signer,
  });

  const paymentIntent = await createSignedIntent({
    body: {
      kind: "payment",
      asset: USDC,
      maxAmount: paymentMax,
      merchant: MERCHANT_RECIPIENT,
      resource: paymentResource,
      // Carry the operator policy in the intent body so the
      // ReputationPaymentGate evaluates it non-trivially. Mirrors
      // what an x402 client does when copying
      // PaymentRequirement.extra.vcGate into the intent.
      extra: { vcGate: OPERATOR_POLICY },
    },
    creator: agentAddress,
    chainId: CHAIN_ID,
    deadlineMs,
    signer,
  });

  // ─── 9. Execute all three through the SAME router ──
  const transferResult = await router.execute(transferIntent);
  const swapResult = await router.execute(swapIntent);
  const paymentResult = await router.execute(paymentIntent);

  const results: SolverTrioIntentResult[] = [
    classifyResult({
      kind: "transfer",
      label: "Send 1 USDC to merchant",
      rule: "=== commitment",
      intent: transferIntent,
      execution: transferResult,
      gateResult: gateCaptures.get(transferIntent.envelope.id),
      expectedSolverId: transferSolver.id,
      check: (fill) =>
        BigInt(fill.actualAmount) === BigInt(fill.quoteCommitment),
    }),
    classifyResult({
      kind: "swap",
      label: "Swap 1 USDC for WETH",
      rule: ">= commitment",
      intent: swapIntent,
      execution: swapResult,
      gateResult: gateCaptures.get(swapIntent.envelope.id),
      expectedSolverId: swapSolver.id,
      check: (fill) =>
        BigInt(fill.actualAmount) >= BigInt(fill.quoteCommitment),
    }),
    classifyResult({
      kind: "payment",
      label: "Pay 1 USDC (x402 facilitator)",
      rule: "<= commitment",
      intent: paymentIntent,
      execution: paymentResult,
      gateResult: gateCaptures.get(paymentIntent.envelope.id),
      expectedSolverId: x402Solver.id,
      check: (fill) =>
        BigInt(fill.actualAmount) <= BigInt(fill.quoteCommitment),
    }),
  ];

  return {
    agentAddress,
    chainId: CHAIN_ID,
    operatorPolicy: OPERATOR_POLICY,
    denyModeExpected: config.skipAgentRegistration === true,
    results,
    auditEvents,
  };
}

// ─── Helpers ─────────────────────────────────────────────

function classifyResult(params: {
  readonly kind: "transfer" | "swap" | "payment";
  readonly label: string;
  readonly rule: SolverTrioIntentResult["rule"];
  readonly intent: Intent;
  readonly execution: IntentExecutionResult;
  readonly gateResult?: PaymentGateResult;
  readonly expectedSolverId: string;
  readonly check: (fill: Fill) => boolean;
}): SolverTrioIntentResult {
  const outcome = params.execution.outcome;
  if (outcome.kind !== "fulfilled") {
    return {
      kind: params.kind,
      label: params.label,
      rule: params.rule,
      solverId: params.expectedSolverId,
      intent: params.intent,
      executionResult: params.execution,
      commitmentRuleHeld: false,
      gateResult: params.gateResult,
    };
  }
  const held = params.check(outcome.fill);
  return {
    kind: params.kind,
    label: params.label,
    rule: params.rule,
    solverId: outcome.fill.solverId,
    intent: params.intent,
    executionResult: params.execution,
    fill: outcome.fill,
    commitmentRuleHeld: held,
    gateResult: params.gateResult,
  };
}
