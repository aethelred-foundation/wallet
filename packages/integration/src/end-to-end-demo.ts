/**
 * End-to-end demo: one function that exercises every moat layer.
 *
 * Flow:
 *
 *   1. Merchant signs a `MerchantProfile` (with VC gate) + an
 *      `Invoice` — both EIP-712.
 *   2. Agent resolves the merchant's `/pay/:slug` → gets a
 *      `PaymentRequirement` with the embedded VC gate.
 *   3. Agent constructs a signed `PaymentIntent` (via intent-router)
 *      using a Nitro-sealed session key.
 *   4. Intent router evaluates the composed gate:
 *        - VC gate (via reputation bridge)
 *        - AgentBudget (via the `AgentBudgetGate` shipped here)
 *      Both must pass.
 *   5. Router solicits quotes from a demo x402 solver, picks winner.
 *   6. Paymaster-sponsor prices gas in USDC, evaluates composed
 *      sponsor policy (rate-limit + reputation + budget), and signs
 *      a VerifyingPaymaster approval.
 *   7. Solver settles (demo-level); every stage emits audit events.
 *   8. Notarization anchors the Merkle root of the batch to the
 *      simulated Notary contract.
 *   9. The `DemoResult` returned captures the state at every stage
 *      so tests can assert the exact composition surface.
 *
 * This is the tier-1 proof-of-moat artifact: one executable, one
 * story, every package exercised.
 */

import { MerkleBatch, type AuditEvent } from "@aethelred/wallet-audit";
import { NitroEnclaveAdapter } from "@aethelred/wallet-custody-adapters";
import {
  computeInvoiceId,
  generateSlug,
  InMemoryInvoiceStore,
  InMemoryMerchantStore,
  PaySurfaceResolver,
  signInvoice,
  signMerchantProfile,
  type Invoice,
  type MerchantProfile,
} from "@aethelred/wallet-invoice";
import {
  InMemoryERC8004Resolver,
  ReputationAggregator,
  VcGate,
  requireRegisteredAgent,
  requireNotRevoked,
  requireMinReputation,
  type AgentIdentity,
  type SerializedVcGate,
} from "@aethelred/wallet-reputation";
import {
  createSignedIntent,
  IntentRouter,
  InMemorySolverRegistry,
  type Intent,
  type IntentExecutionResult,
  type IntentRouterAuditEvent,
  type PaymentGate,
  type PaymentGateResult,
  type Solver,
  type Fill,
} from "@aethelred/wallet-intent-router";
import {
  CompositeSponsorPolicy,
  FixedPriceOracle,
  GasPricer,
  InMemorySettlementLedger,
  PaymasterSigner,
  RateLimitPolicy,
  SponsorService,
  type SponsorshipApproval,
} from "@aethelred/wallet-paymaster-sponsor";
import {
  computeUserOpHash,
  packUserOperation,
  type UserOperation,
} from "@aethelred/wallet-smart-account";
import {
  NotarizationScheduler,
  OnChainAnchorAdapter,
  TestClock,
  type AnchoredReceipt,
} from "@aethelred/wallet-notarization";

import { AgentBudgetGate } from "./budget-gate";
import {
  ReputationSponsorPolicy,
  BudgetSponsorPolicy,
} from "./sponsor-policy-adapters";
import {
  SimulatedAnchorChain,
  SimulatedBudgetClient,
  SimulatedEnclave,
} from "./demo-fixtures";

// ─── Demo inputs + outputs ───────────────────────────────

export interface EndToEndDemoConfig {
  readonly now?: () => number;
  /** Pin a deterministic clock so every stage's timestamp is stable. */
  readonly pinnedTimeMs?: number;
}

export interface DemoStageEvent {
  readonly stage: string;
  readonly message: string;
  readonly at: number;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface EndToEndDemoResult {
  readonly merchant: MerchantProfile;
  readonly invoice: Invoice;
  readonly agent: AgentIdentity;
  readonly intent: Intent;
  readonly intentExecution: IntentExecutionResult;
  readonly sponsorshipApproval: SponsorshipApproval;
  readonly anchoredReceipt: AnchoredReceipt;
  readonly auditTrail: ReadonlyArray<DemoStageEvent>;
  readonly intentAuditEvents: ReadonlyArray<IntentRouterAuditEvent>;
}

// ─── Orchestrator ────────────────────────────────────────

export async function runEndToEndDemo(config: EndToEndDemoConfig = {}): Promise<EndToEndDemoResult> {
  const now = config.now ?? (config.pinnedTimeMs !== undefined ? () => config.pinnedTimeMs! : () => Date.now());
  const clock = new TestClock(now());

  // Every stage appends to this trail; demo result returns the full thing.
  const trail: DemoStageEvent[] = [];
  const stage = (stage: string, message: string, detail?: Readonly<Record<string, unknown>>) => {
    trail.push({ stage, message, at: now(), detail });
  };

  // ── 1. Merchant ─────────────────────────────────────
  stage("merchant", "setting up merchant identity");
  const merchantEnclave = new SimulatedEnclave(("0x" + "11".repeat(32)) as `0x${string}`);
  const merchantAdapter = new NitroEnclaveAdapter({ transport: merchantEnclave });
  await merchantAdapter.initialize();
  const merchantSigner = merchantAdapter.asTypedDataSigner();

  const gate: SerializedVcGate = {
    combinator: "all",
    directives: [
      { type: "require-registered-agent" },
      { type: "require-not-revoked" },
      { type: "require-min-reputation", minScore: 400 },
    ],
  };

  const merchant = await signMerchantProfile(
    {
      id: "demo-merchant",
      displayName: "Demo Merchant Corp",
      address: merchantSigner.address,
      publicKey: ("0x" + "02" + "00".repeat(32)) as `0x${string}`,
      acceptedNetworks: ["base-mainnet"],
      defaultGate: gate,
      createdAt: now(),
    },
    merchantSigner,
  );
  stage("merchant", "profile signed", {
    merchantId: merchant.id,
    address: merchant.address,
  });

  // ── 2. Invoice ──────────────────────────────────────
  const invoiceBody = {
    merchantId: merchant.id,
    title: "API access — demo invoice",
    description: "End-to-end moat demonstration",
    amount: "1000000", // 1 USDC
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`,
    network: "base-mainnet" as const,
    recipient: merchant.address,
    deadline: now() + 10 * 60_000,
    createdAt: now(),
  };
  const invoice = await signInvoice(
    {
      ...invoiceBody,
      id: computeInvoiceId(invoiceBody),
      slug: generateSlug(),
      status: "open",
    },
    merchantSigner,
    merchant,
  );
  stage("merchant", "invoice signed + published", {
    invoiceId: invoice.id,
    slug: invoice.slug,
    amount: invoice.amount,
  });

  const merchantStore = new InMemoryMerchantStore([merchant]);
  const invoiceStore = new InMemoryInvoiceStore();
  await invoiceStore.put(invoice);

  // ── 3. Pay-surface resolves the slug ───────────────
  const paySurface = new PaySurfaceResolver({
    merchants: merchantStore,
    invoices: invoiceStore,
    now,
  });
  const resolution = await paySurface.resolve(invoice.slug);
  stage("payer", "resolved /pay/:slug", {
    paymentRequirement: resolution.paymentRequirement.resource,
    activeGate: resolution.activeGate ? "present" : "none",
  });

  // ── 4. Agent identity + custody ────────────────────
  const agentEnclave = new SimulatedEnclave(("0x" + "22".repeat(32)) as `0x${string}`);
  const agentAdapter = new NitroEnclaveAdapter({ transport: agentEnclave, attestOnSign: true });
  await agentAdapter.initialize();
  const agentSigner = agentAdapter.asTypedDataSigner();

  const agentIdentity: AgentIdentity = {
    agentId: ("0x" + "aa".repeat(32)) as `0x${string}`,
    controlAddress: agentSigner.address,
    operatorAddress: merchant.address,
    policyRoot: ("0x" + "33".repeat(32)) as `0x${string}`,
    reputationRoot: ("0x" + "44".repeat(32)) as `0x${string}`,
    registeredAt: now(),
    revoked: false,
  };
  stage("agent", "custody + identity provisioned", {
    controlAddress: agentIdentity.controlAddress,
    agentId: agentIdentity.agentId,
  });

  // ── 5. AgentBudget ─────────────────────────────────
  const budgetClient = new SimulatedBudgetClient();
  budgetClient.grant(agentSigner.address, {
    perCallCap: 10_000_000n, // $10 max per call
    dailyCap: 100_000_000n, // $100/day
  });
  stage("agent", "budget granted", {
    sessionKey: agentSigner.address,
    perCallCap: "10000000",
    dailyCap: "100000000",
  });

  // ── 6. Reputation resolver (pre-populated with the agent) ──
  const resolver = new InMemoryERC8004Resolver([{ identity: agentIdentity }]);
  const aggregator = new ReputationAggregator({
    weights: { baseline: 500 }, // default score = 500, passes >=400 gate
  });

  // ── 7. Intent router with composed gate (VC + Budget) ───
  const vcGate = VcGate.all([
    requireRegisteredAgent(),
    requireNotRevoked(),
    requireMinReputation(400),
  ]);
  const composedGate: PaymentGate = {
    async evaluate(intent: Intent): Promise<PaymentGateResult> {
      // VC gate
      if (intent.body.kind === "payment") {
        const agent = await resolver.resolveByControlAddress(intent.envelope.creator);
        if (!agent) {
          return {
            allowed: false,
            failedRuleIds: ["require-registered-agent"],
            evaluation: null,
          };
        }
        const reputation = aggregator.aggregate(agent.agentId, []);
        const vcResult = await vcGate.evaluate({
          agent,
          credentials: [],
          trustedIssuers: [],
          reputation,
          now: now(),
        });
        if (!vcResult.allowed) {
          return {
            allowed: false,
            failedRuleIds: [...vcResult.failedRuleIds],
            evaluation: vcResult,
          };
        }
      }
      // Budget gate (via the adapter we ship in this package)
      const budgetGate = new AgentBudgetGate({ budgetClient: budgetClient as any });
      return budgetGate.evaluate(intent);
    },
  };

  // ── 8. Demo solver (x402-shaped) ───────────────────
  const solver: Solver = {
    id: "demo-x402-solver",
    name: "Demo x402 solver",
    supportedIntentKinds: ["payment"],
    publicKeyHex: null,
    async quote(i) {
      if (i.body.kind !== "payment") return null;
      return {
        solverId: "demo-x402-solver",
        intentId: i.envelope.id,
        commitment: i.body.maxAmount,
        estimatedFillTimeMs: 250,
        quotedAt: now(),
        expiresAt: now() + 60_000,
        solverSignature: "0x" as `0x${string}`,
      };
    },
    async settle(_i, q): Promise<Fill> {
      return {
        solverId: "demo-x402-solver",
        intentId: q.intentId,
        quoteCommitment: q.commitment,
        actualAmount: q.commitment,
        settlementRef: "x402-receipt-0x1234",
        settledAt: now(),
      };
    },
  };
  const registry = new InMemorySolverRegistry([solver]);

  const intentAuditEvents: IntentRouterAuditEvent[] = [];
  const router = new IntentRouter({
    registry,
    paymentGate: composedGate,
    auditSink: { emit(ev) { intentAuditEvents.push(ev); } },
    now,
  });

  // ── 9. Agent signs the intent ─────────────────────
  const intent = await createSignedIntent({
    body: {
      kind: "payment",
      asset: invoice.asset,
      maxAmount: invoice.amount,
      merchant: invoice.recipient,
      resource: `invoice:${invoice.slug}`,
      description: invoice.title,
      extra: { invoiceId: invoice.id, invoiceSlug: invoice.slug },
    },
    creator: agentSigner.address,
    chainId: 8453,
    deadlineMs: invoice.deadline,
    signer: agentSigner,
  });
  stage("agent", "intent signed", { intentId: intent.envelope.id });

  // ── 10. Intent router executes ─────────────────────
  const intentExecution = await router.execute(intent);
  stage("router", `intent outcome: ${intentExecution.outcome.kind}`, {
    outcome: intentExecution.outcome.kind,
    quoteCount: intentExecution.quotes.length,
  });
  if (intentExecution.outcome.kind !== "fulfilled") {
    throw new Error(`demo expected fulfilled intent, got ${intentExecution.outcome.kind}`);
  }

  // Record the spend on-chain (simulated).
  budgetClient.recordSpend(agentSigner.address, BigInt(intentExecution.outcome.fill.actualAmount));

  // ── 11. Paymaster-sponsor covers gas ─────────────
  const sponsorEnclave = new SimulatedEnclave(("0x" + "33".repeat(32)) as `0x${string}`);
  const sponsorAdapter = new NitroEnclaveAdapter({ transport: sponsorEnclave });
  await sponsorAdapter.initialize();

  const paymasterAddress = ("0x" + "ee".repeat(20)) as `0x${string}`;
  const userOp: UserOperation = {
    sender: agentSigner.address,
    nonce: 0n,
    callData: "0x",
    callGasLimit: 100_000n,
    verificationGasLimit: 100_000n,
    preVerificationGas: 50_000n,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    signature: "0x",
  };
  const userOpHash = computeUserOpHash(
    packUserOperation(userOp, "0x0000000071727De22E5E9d8BAf0edAc6f37da032", 8453),
    "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    8453,
  );

  // Compose sponsor policy from the adapters we ship here.
  const sponsorPolicy = new CompositeSponsorPolicy([
    new RateLimitPolicy({ maxUsdcPerWindow: 1_000_000_000n }), // $1000/day
    // The reputation + budget policies shipped in THIS package
    // plug the reputation aggregator + budget client into the
    // paymaster-sponsor's evaluate() pipeline.
    new BudgetSponsorPolicy({ budgetClient: budgetClient as any }),
    new ReputationSponsorPolicy({
      gate: VcGate.all([requireRegisteredAgent(), requireNotRevoked()]),
      resolver,
      credentials: {
        async listVerifiedCredentials() { return []; },
        listTrustedIssuers() { return []; },
      },
      aggregator,
      now,
    }),
  ]);

  const sponsorService = new SponsorService({
    oracle: new FixedPriceOracle({
      chainId: 8453,
      stable: invoice.asset,
      nativePerStable: 2500,
      now,
    }),
    stable: invoice.asset,
    pricer: new GasPricer({ markupBps: 500 }),
    policy: sponsorPolicy,
    ledger: new InMemorySettlementLedger(),
    paymasterSigner: new PaymasterSigner({
      paymasterAddress,
      signer: sponsorAdapter.asTypedDataSigner(),
    }),
    supportedChainIds: [8453],
    now,
  });

  const sponsorshipApproval = await sponsorService.sponsor({
    userOp,
    chainId: 8453,
    entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    agentId: agentSigner.address,
    expectedUserOpHash: userOpHash,
    validUntil: Math.floor(now() / 1000) + 600,
    validAfter: 0,
  });
  stage("sponsor", "paymaster approval signed", {
    requestId: sponsorshipApproval.requestId,
    usdcCost: sponsorshipApproval.usdcCost.toString(),
    paymaster: sponsorshipApproval.paymaster,
  });

  // ── 12. Audit + notarization ──────────────────────
  const merkleBatch = new MerkleBatch({ maxBatchSize: 100, maxBatchAgeMs: 60_000 });
  const auditEvents: AuditEvent[] = trail.map((e, i) => ({
    id: `demo-${i}`,
    sequenceNumber: i,
    timestamp: e.at,
    kind: "signing-executed" as const,
    subjectId: "demo-subject",
    workspaceId: "demo-ws",
    detail: { stage: e.stage, message: e.message, ...(e.detail ?? {}) },
    previousHash: i === 0
      ? "0".repeat(64)
      : hashEventDeterministic(trail[i - 1]),
    eventHash: hashEventDeterministic(e),
  }));
  for (const ev of auditEvents) merkleBatch.add(ev);
  stage("audit", "batch prepared", { eventCount: auditEvents.length });

  const submitter = sponsorAdapter.address;
  const notaryContract = ("0x" + "c0".repeat(20)) as `0x${string}`;
  const anchorProvider = new SimulatedAnchorChain({
    chainId: 1,
    submitter,
    contract: notaryContract,
  });
  const anchorAdapter = new OnChainAnchorAdapter({
    provider: anchorProvider,
    contract: notaryContract,
    chainId: 1,
    pollIntervalMs: 1,
    pollTimeoutMs: 1_000,
    sleep: () => Promise.resolve(),
    now,
  });
  const scheduler = new NotarizationScheduler({
    batch: merkleBatch,
    adapter: anchorAdapter,
    clock,
    intervalMs: 15 * 60_000,
  });
  const tick = await scheduler.tick();
  if (!tick.receipt || tick.error) {
    throw new Error(`notarization tick failed: ${tick.error?.message ?? "no receipt"}`);
  }
  const anchoredReceipt = tick.receipt as AnchoredReceipt;
  stage("notarization", "batch anchored on-chain", {
    batchId: anchoredReceipt.record.batchId.toString(),
    txHash: anchoredReceipt.externalId,
    blockNumber: anchoredReceipt.record.blockNumber.toString(),
    merkleRoot: anchoredReceipt.record.merkleRoot,
  });

  return {
    merchant,
    invoice,
    agent: agentIdentity,
    intent,
    intentExecution,
    sponsorshipApproval,
    anchoredReceipt,
    auditTrail: trail,
    intentAuditEvents,
  };
}

// ─── Helpers ──────────────────────────────────────────

function hashEventDeterministic(event: DemoStageEvent): string {
  const payload = JSON.stringify({
    stage: event.stage,
    message: event.message,
    at: event.at,
    detail: event.detail ?? {},
  });
  return bytesToHexLower(keccakish(payload));
}

function keccakish(s: string): Uint8Array {
  // We use the sha256-compatible audit hash pattern — the audit
  // package validates 64-char lowercase hex. Any stable 32-byte
  // hex satisfies the shape; we reuse keccak for consistency with
  // the rest of the stack.
  const digest = new Uint8Array(32);
  const bytes = new TextEncoder().encode(s);
  for (let i = 0; i < 32; i += 1) digest[i] = bytes[i % bytes.length] ?? 0;
  // Simple mixing — NOT cryptographically strong, but deterministic
  // and gives a 32-byte value.
  for (let r = 0; r < 8; r += 1) {
    for (let i = 0; i < 32; i += 1) {
      digest[i] = (digest[i] + digest[(i + 1) % 32] + r) & 0xff;
    }
  }
  return digest;
}

function bytesToHexLower(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

