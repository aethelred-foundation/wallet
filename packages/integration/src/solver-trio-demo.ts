/**
 * `runSolverTrioDemo` — proves the `Solver` contract composes across
 * all three intent kinds.
 *
 * One `IntentRouter`, one `InMemorySolverRegistry`, three concrete
 * solvers, three intents:
 *
 *     transfer intent  ──▶ TransferSolver       ──▶ actualAmount === commitment
 *     swap intent      ──▶ SwapSolver            ──▶ actualAmount ≥ commitment
 *     payment intent   ──▶ X402FacilitatorSolver ──▶ actualAmount ≤ commitment
 *
 * Returns a structured result capturing, for each intent:
 *   - Which solver served it (id)
 *   - The commitment rule that applied
 *   - actualAmount vs quote commitment (both as bigint strings)
 *   - The fill's settlementRef
 *   - All intent-router audit events emitted during the run
 *
 * This is the sibling artifact to `runEndToEndDemo()`: where that
 * exercises compliance depth (one intent, every gate), this
 * exercises dispatch breadth (three intents, one dispatch surface).
 *
 * Design calls:
 *
 *   - **Single LocalKey signer, not Nitro.** The trio demo is about
 *     solver dispatch, not custody depth. LocalKey keeps the
 *     narrative uncluttered — swap Nitro back in for a production
 *     deployment. The moat demo covers the Nitro story.
 *
 *   - **Shared chain provider across transfer + swap.** Both submit
 *     chain txs via the same `AnchorChainProvider` instance so the
 *     demo proves chain-provider pluggability at the composition
 *     level. x402-solver uses a stubbed `fetch` — it doesn't touch
 *     the chain in v0.1.
 *
 *   - **Deterministic `StubSwapVenue`.** No real DEX; the stub's
 *     price ratio is configured so the mid-price is comfortably
 *     above the user's `minBuyAmount`.
 *
 *   - **In-line simulated chain.** Not shared with
 *     `runEndToEndDemo`'s `SimulatedAnchorChain` — that one decodes
 *     anchor-specific calldata. This one is generic enough to
 *     accept any tx, which is the correct shape for a solver-
 *     dispatch demo.
 */

import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import {
  createSignedIntent,
  InMemorySolverRegistry,
  IntentRouter,
  type Fill,
  type Intent,
  type IntentExecutionResult,
  type IntentRouterAuditEvent,
  type Solver,
} from "@aethelred/wallet-intent-router";
import type {
  AnchorChainProvider,
  TxReceipt,
} from "@aethelred/wallet-notarization";
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
}

export interface SolverTrioDemoResult {
  readonly agentAddress: `0x${string}`;
  readonly chainId: number;
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

/**
 * Deterministic private key for the agent. The demo shows the
 * dispatch surface — custody depth is the moat demo's concern.
 */
const AGENT_PK = ("0x" + "01".repeat(32)) as `0x${string}`;

/**
 * Generic in-memory `AnchorChainProvider`. Accepts any tx, returns
 * a success receipt immediately. Used by transfer-solver + swap-
 * solver in the demo. Keeps the demo self-contained (one file, one
 * story, no hidden fixtures).
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
 * Stub `fetch` that simulates the x402 two-request handshake. First
 * call returns a 402 Payment Required with a payment requirement;
 * second call returns 200 with an `X-PAYMENT-RESPONSE` header
 * carrying a base64-encoded `PaymentReceipt`.
 *
 * Same shape as the one in `apps/extension/src/test/x402-solver.test.ts`
 * — kept in-file for demo clarity.
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

// ─── Orchestrator ────────────────────────────────────────

export async function runSolverTrioDemo(
  config: SolverTrioDemoConfig = {},
): Promise<SolverTrioDemoResult> {
  const now = config.now ?? (() => Date.now());

  // ─── 1. Agent signer (LocalKey — dispatch-focused) ──
  const custody = new LocalKeyAdapter({ privateKey: AGENT_PK });
  const signer: TypedDataSigner = custody.asTypedDataSigner();
  const agentAddress = signer.address;

  // ─── 2. Shared chain provider for transfer + swap ──
  const chainProvider = new DemoChainProvider(CHAIN_ID);

  // ─── 3. Solver: transfer ───────────────────────────
  const transferSolver = new TransferSolver({
    id: "transfer:base-mainnet",
    name: "Aethelred Transfer Solver (Base)",
    from: agentAddress,
    provider: chainProvider,
    now,
    sleep: async () => {}, // demo is instant
  });

  // ─── 4. Solver: swap, backed by StubSwapVenue ──────
  // Price: 1 USDC = 0.00027 WETH (a plausible mid-price for demo).
  // Numerator/denominator scaled so integer math stays exact.
  const swapVenue = new StubSwapVenue({
    id: "stub-swap-venue",
    chainId: CHAIN_ID,
    router: STUB_ROUTER,
    priceNumerator: 270_000_000_000_000n, // 0.00027 WETH per USDC
    priceDenominator: 1_000_000n,         // 1 USDC in its smallest unit
  });
  const swapSolver = new SwapSolver({
    id: "swap:stub:base-mainnet",
    name: "Aethelred Swap Solver (Stub / Base)",
    from: agentAddress,
    provider: chainProvider,
    venue: swapVenue,
    internalSlippageBps: 50, // 0.5% buffer
    now,
    sleep: async () => {},
  });

  // ─── 5. Solver: x402 facilitator ───────────────────
  const paymentResource = "https://api.example.com/premium-data";
  const paymentMax = "1000000"; // 1 USDC
  const x402Solver = new X402FacilitatorSolver({
    id: "x402-facilitator:base-mainnet",
    name: "Aethelred x402 Facilitator (Base)",
    signer,
    supportedNetworks: ["base-mainnet"],
    fetch: stubX402Fetch({
      resource: paymentResource,
      payTo: MERCHANT_RECIPIENT,
      asset: USDC,
      maxAmountRequired: "950000", // facilitator settles for less than max
    }),
    now,
  });

  // ─── 6. Router with one registry holding all three ─
  const auditEvents: IntentRouterAuditEvent[] = [];
  const registry = new InMemorySolverRegistry([
    transferSolver as unknown as Solver,
    swapSolver as unknown as Solver,
    x402Solver as unknown as Solver,
  ]);
  const router = new IntentRouter({
    registry,
    now,
    auditSink: {
      emit(event: IntentRouterAuditEvent) {
        auditEvents.push(event);
      },
    },
  });

  // ─── 7. Intents ────────────────────────────────────
  const deadlineMs = now() + 5 * 60_000;

  const transferIntent = await createSignedIntent({
    body: {
      kind: "transfer",
      asset: USDC,
      amount: "1000000", // 1 USDC
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
      sellAmount: "1000000", // 1 USDC in
      buyAsset: WETH,
      // Ask for a floor comfortably below the stub's mid-price floor.
      // Mid = 270_000_000_000_000; 50-bps floor = 268_650_000_000_000.
      // minBuyAmount below the floor → solver can commit.
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
      maxAmount: paymentMax, // 1 USDC ceiling
      merchant: MERCHANT_RECIPIENT,
      resource: paymentResource,
    },
    creator: agentAddress,
    chainId: CHAIN_ID,
    deadlineMs,
    signer,
  });

  // ─── 8. Execute all three through the SAME router ──
  const [transferResult, swapResult, paymentResult] = [
    await router.execute(transferIntent),
    await router.execute(swapIntent),
    await router.execute(paymentIntent),
  ];

  const results: SolverTrioIntentResult[] = [
    classifyResult({
      kind: "transfer",
      label: "Send 1 USDC to merchant",
      rule: "=== commitment",
      intent: transferIntent,
      execution: transferResult,
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
      expectedSolverId: x402Solver.id,
      check: (fill) =>
        BigInt(fill.actualAmount) <= BigInt(fill.quoteCommitment),
    }),
  ];

  return {
    agentAddress,
    chainId: CHAIN_ID,
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
  };
}
