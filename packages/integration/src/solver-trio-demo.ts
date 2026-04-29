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
  fillToGasSample,
  SolverGasHistogram,
  type PerSolverGasStats,
} from "@aethelred/wallet-observability";
export type { SolverGasHistogram } from "@aethelred/wallet-observability";
import {
  InMemoryERC8004Resolver,
  type AgentIdentity,
  type GateCredentialSource,
  type Issuer,
  type SerializedVcGate,
  type VerifiableCredential,
} from "@aethelred/wallet-reputation";
import { StubSwapVenue, SwapSolver } from "@aethelred/wallet-swap-solver";
import {
  SELECTOR_EXACT_INPUT_SINGLE,
  TOPIC_SWAP_V3,
  UniswapV3SwapVenue,
  UNISWAP_V3_FEE_TIERS,
  type Eth_RpcTransport,
} from "@aethelred/wallet-swap-venue-uniswap-v3";
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

  /**
   * How many times to run each intent kind through the router.
   * Default `1` (single run; the histogram won't have meaningful
   * percentile spread). Set to e.g. `10` to see how the
   * `SolverGasHistogram` aggregates across many fills — the
   * cross-intent observability view that complements PR #80's
   * per-intent gas signal.
   *
   * In allow mode, all `samples` runs of each kind are submitted
   * (3 × samples intents total). In deny mode, the first run of
   * each kind is enough to prove the denial — no statistical
   * spread possible there since no fills exist.
   */
  readonly samples?: number;

  /**
   * When `true` AND `swapVenue: "uniswap-v3"`, configures the
   * venue with `skipApproveWhenSufficient: true` AND wires the
   * stubbed transport to return `MAX_UINT256` from
   * `allowance()`. Result: the swap fill is a SINGLE-tx
   * sequence (`[swap]`) instead of the default two-tx
   * (`[approve, swap]`). Demonstrates the production-mode
   * behavior of "agent has pre-approved the router for
   * unlimited spend" — a common deployment pattern that halves
   * on-chain operations per swap.
   *
   * No effect when `swapVenue: "stub"` (StubSwapVenue ignores
   * allowance — it always emits a single-tx swap).
   *
   * Powers the `--preflight-allowance` CLI flag.
   */
  readonly preflightAllowance?: boolean;

  /**
   * Which `SwapVenue` implementation the swap-solver uses.
   *
   *   - `"stub"` (default): `StubSwapVenue` — deterministic,
   *     in-memory, single-tx swap (no approve). Original demo
   *     behaviour; stable test values.
   *   - `"uniswap-v3"`: `UniswapV3SwapVenue` — the real
   *     production-shape venue from PR #94, exercised through
   *     a stubbed `eth_call` transport that returns a canned
   *     QuoterV2 result matching the stub's price ratio.
   *     Two-tx swap sequence ([approve, swap]). Demonstrates the
   *     production path end-to-end.
   *
   * Powers the `--venue` CLI flag.
   */
  readonly swapVenue?: "stub" | "uniswap-v3";
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
  /** Which SwapVenue ran the swap intents. Display-only. */
  readonly swapVenueId: "stub" | "uniswap-v3";
  /**
   * The first run's results, one per intent kind — preserves the
   * "show me one transfer + one swap + one payment" narrative the
   * matrix table renders. When `samples > 1` the additional runs
   * feed the histogram below but aren't surfaced as separate rows.
   */
  readonly results: ReadonlyArray<SolverTrioIntentResult>;
  readonly auditEvents: ReadonlyArray<IntentRouterAuditEvent>;
  /**
   * Per-solver gas histogram aggregated across ALL fills (across
   * all `samples` runs). Empty when `samples === 1` and only one
   * fill exists per solver — the histogram structure is still
   * present, but p50/p95/p99 collapse to a single value.
   *
   * Foundation for production observability: an SRE pipeline
   * would feed every `Fill` from the audit stream into a
   * long-lived `SolverGasHistogram` and read percentiles at SLO
   * boundaries; the demo runs this loop in-process to make the
   * abstraction concrete.
   */
  readonly gasHistogram: ReadonlyMap<string, PerSolverGasStats>;
  /**
   * The live histogram instance that fed `gasHistogram`. Exposed
   * so callers (the demo CLI under `--prom`, or any consumer
   * needing the OTLP/Prometheus bridge) can call
   * `exportToMeter(meter)` directly without rebuilding state.
   *
   * Mutating this from outside the orchestrator is unsupported —
   * the snapshot above is already a correct read view.
   */
  readonly gasHistogramInstance: SolverGasHistogram;
}

// ─── Fixtures (demo-local) ───────────────────────────────

const CHAIN_ID = 8453; // Base mainnet
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`;
const WETH = "0x4200000000000000000000000000000000000006" as `0x${string}`;
const MERCHANT_RECIPIENT = ("0x" + "aa".repeat(20)) as `0x${string}`;
const SWAP_RECIPIENT = ("0x" + "bb".repeat(20)) as `0x${string}`;
const STUB_ROUTER = ("0x" + "cc".repeat(20)) as `0x${string}`;

/**
 * Address of the simulated Uniswap v3 SwapRouter02. In production
 * this would be the canonical Base-mainnet address
 * (0x2626664c2603336E57B271c5C0b26F421741e481); the demo uses a
 * deterministic placeholder so output is reproducible.
 */
const V3_QUOTER_ADDRESS = ("0x" + "11".repeat(20)) as `0x${string}`;
const V3_SWAP_ROUTER_ADDRESS = ("0x" + "12".repeat(20)) as `0x${string}`;
const V3_POOL_ADDRESS = ("0x" + "13".repeat(20)) as `0x${string}`;

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
 * Build a synthetic Swap-event log for a v3 swap-router tx, so
 * the v3 venue's `decodeFillAmount` finds the buyAmount it
 * expects. Called by `DemoChainProvider` when:
 *
 *   - The orchestrator config is `swapVenue: "uniswap-v3"`.
 *   - The submitted tx has the `exactInputSingle` selector.
 *   - The decoded recipient matches `SWAP_RECIPIENT`.
 *
 * Encodes `amount0 = -270e12` (WETH out, since WETH < USDC by
 * address) and `amount1 = +1e6` (USDC in). Single hop, single
 * pool.
 */
function makeV3SwapLog(opts: {
  readonly buyAmount: bigint;
  readonly sellAmount: bigint;
  readonly txHash: `0x${string}`;
  readonly sender: `0x${string}`;
  readonly recipient: `0x${string}`;
}): TxReceipt["logs"][number] {
  const padToSlot = (addr: string) =>
    ("0x" + "00".repeat(12) + addr.slice(2).toLowerCase()) as `0x${string}`;
  const intToHex = (n: bigint) => {
    const u = n < 0n ? n + (1n << 256n) : n;
    return u.toString(16).padStart(64, "0");
  };
  // WETH (0x4200...) < USDC (0x8335...) lexicographically, so
  // WETH = token0. amount0 negative = WETH outflow (recipient gets it).
  const data = ("0x" +
    intToHex(-opts.buyAmount) + // amount0 — WETH out
    intToHex(opts.sellAmount) + // amount1 — USDC in
    "00".repeat(96)) as `0x${string}`; // sqrtPriceX96 + liquidity + tick zeros
  return {
    address: V3_POOL_ADDRESS,
    topics: [TOPIC_SWAP_V3, padToSlot(opts.sender), padToSlot(opts.recipient)],
    data,
    blockNumber: 0n,
    transactionHash: opts.txHash,
    logIndex: 0,
  };
}

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
  /**
   * When `true`, sendTransaction inspects each tx's calldata for the
   * v3 SwapRouter02 `exactInputSingle` selector and synthesises a
   * Pool Swap event into the receipt's `logs`. Lets
   * `UniswapV3SwapVenue.decodeFillAmount()` extract the buyAmount
   * without a real chain. Stub-venue mode never triggers this path
   * (the stub doesn't need event decoding).
   */
  private readonly injectV3SwapEvents: boolean;

  constructor(chainId: number, opts: { injectV3SwapEvents?: boolean } = {}) {
    this.chainId = chainId;
    this.injectV3SwapEvents = opts.injectV3SwapEvents === true;
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
    // Simulated gas: plausible values for a Base-mainnet ERC-20
    // transfer (~60k) and a v3 swap (~180k). Not realistic enough
    // for capacity planning, but enough to prove the telemetry
    // path end-to-end. Differentiated by payload size so ERC-20
    // transfers look lighter than swap-router calls.
    //
    // Add deterministic jitter (±10%) keyed on tx index so when the
    // demo runs the same intent kind multiple times (--samples 10),
    // the histogram has p50 ≠ p95 ≠ p99 — i.e. an actual
    // distribution rather than a single repeated value.
    const baseGas =
      request.data === "0x" || request.data.length < 200
        ? 60_000n
        : 180_000n;
    // Cycle through {-10%, -5%, 0%, +5%, +10%} based on idx mod 5.
    const jitterCycle = [-10n, -5n, 0n, 5n, 10n];
    const jitterPct = jitterCycle[(this.nextIdx - 1) % jitterCycle.length]!;
    const simulatedGas = baseGas + (baseGas * jitterPct) / 100n;
    // Also jitter price slightly so gasCostWei spreads too.
    const simulatedGasPrice = 500_000n + BigInt((this.nextIdx - 1) % 3) * 50_000n;

    // Detect v3 swap-router calls and inject a synthetic Swap
    // event so `UniswapV3SwapVenue.decodeFillAmount` finds the
    // expected log shape. Recognised by selector match — only
    // active when the orchestrator wired this provider with
    // `injectV3SwapEvents: true`.
    const logs: Array<TxReceipt["logs"][number]> = [];
    if (
      this.injectV3SwapEvents &&
      request.data.toLowerCase().startsWith(SELECTOR_EXACT_INPUT_SINGLE)
    ) {
      // The exactInputSingle calldata layout puts `recipient` in
      // the 4th 32-byte slot (after selector + tokenIn + tokenOut + fee).
      // recipient = data[10 + 3*64 .. 10 + 4*64], last 40 chars.
      const recipientHex = request.data.slice(
        10 + 3 * 64 + 24,
        10 + 4 * 64,
      );
      const recipient = ("0x" + recipientHex.toLowerCase()) as `0x${string}`;
      logs.push(
        makeV3SwapLog({
          buyAmount: 270_000_000_000_000n, // 0.00027 WETH per USDC × 1 USDC
          sellAmount: 1_000_000n,
          txHash,
          sender: V3_SWAP_ROUTER_ADDRESS,
          recipient,
        }),
      );
    }

    this.receipts.set(txHash.toLowerCase(), {
      transactionHash: txHash,
      blockNumber: 2_000_000n + BigInt(this.nextIdx),
      status: "success",
      logs,
      gasUsed: simulatedGas,
      effectiveGasPrice: simulatedGasPrice,
    });
    return txHash;
  }

  async getTransactionReceipt(txHash: `0x${string}`): Promise<TxReceipt | null> {
    return this.receipts.get(txHash.toLowerCase()) ?? null;
  }
}

/**
 * Stubbed JSON-RPC transport for the Uniswap v3 venue's
 * `eth_call` lookups.
 *
 * Two distinct calls land here:
 *
 *   - **QuoterV2 quote** — returns canned amountOut=270e12
 *     matching the stub venue's price ratio so commitment math
 *     stays comparable across the two demo paths.
 *
 *   - **ERC-20 `allowance(owner, spender)`** — when
 *     `preflightAllowance` is enabled, returns MAX_UINT256 so
 *     the venue skips the approve tx. Otherwise returns 0
 *     (forces the venue to fall back to the unconditional
 *     two-tx flow).
 *
 * Selector dispatch lets us return the right shape per call
 * without conflating the two.
 */
function makeV3StubTransport(opts: { existingAllowance: bigint }): Eth_RpcTransport {
  return {
    async call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T> {
      if (method !== "eth_call") {
        return "0x" as unknown as T;
      }
      const callObj = params[0] as { data: string };
      const data = callObj.data.toLowerCase();
      // allowance(address,address) selector: 0xdd62ed3e
      if (data.startsWith("0xdd62ed3e")) {
        const padded = opts.existingAllowance
          .toString(16)
          .padStart(64, "0");
        return ("0x" + padded) as unknown as T;
      }
      // Fall through to QuoterV2-shape response for everything else.
      const amountOut = 270_000_000_000_000n;
      const sqrtPriceX96After = 1n << 96n;
      const initializedTicksCrossed = 2n;
      const gasEstimate = 120_000n;
      const result = ("0x" +
        amountOut.toString(16).padStart(64, "0") +
        sqrtPriceX96After.toString(16).padStart(64, "0") +
        initializedTicksCrossed.toString(16).padStart(64, "0") +
        gasEstimate.toString(16).padStart(64, "0")) as `0x${string}`;
      return result as unknown as T;
    },
  };
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
  // x402 flow is exactly 2 HTTP calls per intent: 402 (with
  // requirement) → client signs + retries → 200 (with receipt
  // header). When the demo runs N intents through the same
  // facilitator solver, we alternate [402, 200, 402, 200, ...]
  // by call parity rather than tracking "first call only" —
  // otherwise calls 3, 5, 7, ... would skip the 402 and the
  // x402 client would treat the resource as ungated.
  let call = 0;
  return (async (_input: RequestInfo | URL): Promise<Response> => {
    call += 1;
    const isRequirementCall = call % 2 === 1;
    if (isRequirementCall) {
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

  // Default to stub-venue path so existing behavior + tests
  // remain stable. Opt into the production-shape venue via
  // `swapVenue: "uniswap-v3"` (CLI: --venue uniswap-v3).
  const venueChoice: "stub" | "uniswap-v3" =
    config.swapVenue === "uniswap-v3" ? "uniswap-v3" : "stub";

  // ─── 2. Shared chain provider for transfer + swap ──
  // In v3 mode, the chain provider must inject Swap events into
  // swap-tx receipts so the venue's decoder finds the buyAmount.
  const chainProvider = new DemoChainProvider(CHAIN_ID, {
    injectV3SwapEvents: venueChoice === "uniswap-v3",
  });

  // ─── 3. Solver: transfer ───────────────────────────
  const transferSolver = new TransferSolver({
    id: "transfer:base-mainnet",
    name: "Aethelred Transfer Solver (Base)",
    from: agentAddress,
    provider: chainProvider,
    now,
    sleep: async () => {},
  });

  // ─── 4. Solver: swap, backed by the chosen venue ───
  // When `preflightAllowance` is on, the stubbed transport
  // reports existingAllowance = MAX_UINT256, and the venue
  // skips the approve tx → single-tx swap. Otherwise the
  // transport reports 0 and the venue falls back to [approve,
  // swap]. Demonstrates both production-mode patterns.
  const preflightOn =
    venueChoice === "uniswap-v3" && config.preflightAllowance === true;
  const swapVenue =
    venueChoice === "uniswap-v3"
      ? new UniswapV3SwapVenue({
          id: "uniswap-v3:base-mainnet",
          chainId: CHAIN_ID,
          quoterAddress: V3_QUOTER_ADDRESS,
          swapRouterAddress: V3_SWAP_ROUTER_ADDRESS,
          transport: makeV3StubTransport({
            existingAllowance: preflightOn ? (1n << 256n) - 1n : 0n,
          }),
          defaultFeeTier: UNISWAP_V3_FEE_TIERS.LOW,
          agentAddress: agentAddress,
          skipApproveWhenSufficient: preflightOn,
        })
      : new StubSwapVenue({
          id: "stub-swap-venue",
          chainId: CHAIN_ID,
          router: STUB_ROUTER,
          priceNumerator: 270_000_000_000_000n,
          priceDenominator: 1_000_000n,
        });
  // The solver id surfaces in the audit trail, demo CLI, and
  // histogram. Use a kind-distinguishing id per venue so an
  // operator running both paths in parallel (production scenario)
  // sees them differentiated in observability.
  const swapSolverId =
    venueChoice === "uniswap-v3"
      ? "swap:uniswap-v3:base-mainnet"
      : "swap:stub:base-mainnet";
  const swapSolverName =
    venueChoice === "uniswap-v3"
      ? "Aethelred Swap Solver (Uniswap v3 / Base)"
      : "Aethelred Swap Solver (Stub / Base)";
  const swapSolver = new SwapSolver({
    id: swapSolverId,
    name: swapSolverName,
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
  const samples = Math.max(1, Math.floor(config.samples ?? 1));
  const histogram = new SolverGasHistogram({
    // Generous: every demo fill fits in one window even at large N.
    windowSize: Math.max(1024, samples * 4),
  });

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
  // First run captured for the matrix render. Each subsequent
  // sample re-signs an intent of the same kind (fresh nonce) and
  // routes it — feeds the histogram, doesn't surface separately.
  const transferResult = await router.execute(transferIntent);
  recordFillIfPresent(transferResult, histogram);
  const swapResult = await router.execute(swapIntent);
  recordFillIfPresent(swapResult, histogram);
  const paymentResult = await router.execute(paymentIntent);
  recordFillIfPresent(paymentResult, histogram);

  // Additional samples (samples - 1 of each kind) feed the histogram
  // only. We re-sign rather than reusing the original intent because
  // the router rejects nonce reuse via its replay guard.
  for (let i = 1; i < samples; i++) {
    const t = await createSignedIntent({
      body: transferIntent.body,
      creator: agentAddress,
      chainId: CHAIN_ID,
      deadlineMs,
      signer,
    });
    recordFillIfPresent(await router.execute(t), histogram);

    const s = await createSignedIntent({
      body: swapIntent.body,
      creator: agentAddress,
      chainId: CHAIN_ID,
      deadlineMs,
      signer,
    });
    recordFillIfPresent(await router.execute(s), histogram);

    const p = await createSignedIntent({
      body: paymentIntent.body,
      creator: agentAddress,
      chainId: CHAIN_ID,
      deadlineMs,
      signer,
    });
    recordFillIfPresent(await router.execute(p), histogram);
  }

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
    swapVenueId: venueChoice,
    results,
    auditEvents,
    gasHistogram: histogram.snapshots(),
    gasHistogramInstance: histogram,
  };
}

/**
 * If the router fulfilled the intent and the resulting Fill carries
 * gas data in metadata, feed it to the histogram. Skips x402 fills
 * (no on-chain gas attributed to the agent) and any denied/failed
 * outcomes.
 */
function recordFillIfPresent(
  exec: IntentExecutionResult,
  histogram: SolverGasHistogram,
): void {
  if (exec.outcome.kind !== "fulfilled") return;
  const sample = fillToGasSample(exec.outcome.fill);
  if (sample) histogram.record(sample);
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
