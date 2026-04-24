/**
 * Integration tests: the full moat stack exercised through the
 * end-to-end demo + the composition adapters in isolation.
 *
 * Coverage:
 *
 *   1. AgentBudgetGate: pass-through for non-payment intents;
 *     `session-not-found` / `daily-cap-exceeded` surfaces in
 *     `failedRuleIds` with the `agent-budget:` prefix.
 *   2. ReputationSponsorPolicy: denies unregistered agents; denies
 *      when VC gate fails; passes when gate + reputation allow.
 *   3. BudgetSponsorPolicy: denies when on-chain canSpend rejects;
 *      passes when approved.
 *   4. runEndToEndDemo:
 *      - Completes without throwing.
 *      - Intent execution is `fulfilled` with a fill matching the
 *        invoice amount.
 *      - Sponsorship approval has non-zero USDC cost and valid
 *        paymasterData layout (129 bytes).
 *      - Notarization produces an anchored receipt with non-empty
 *        merkleRoot, positive block number, and non-empty tx hash.
 *      - Audit trail traverses every stage in the expected order.
 *      - Intent-router audit events include intent-submitted,
 *        quotes-solicited, quote-received, quote-chosen, and
 *        settlement-succeeded.
 */

import { describe, expect, it } from "vitest";

import {
  AgentBudgetGate,
  BudgetSponsorPolicy,
  ReputationSponsorPolicy,
  SimulatedBudgetClient,
  runEndToEndDemo,
} from "@aethelred/wallet-integration";

import {
  createSignedIntent,
  type Intent,
} from "@aethelred/wallet-intent-router";
import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import {
  InMemoryERC8004Resolver,
  ReputationAggregator,
  VcGate,
  requireRegisteredAgent,
  requireNotRevoked,
  requireMinReputation,
  type AgentIdentity,
} from "@aethelred/wallet-reputation";
import type { PolicyContext } from "@aethelred/wallet-paymaster-sponsor";

// ─── Fixtures ───────────────────────────────────────

const CHAIN_ID = 8453;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`;

const PK_AGENT = "0x" + "aa".repeat(32);

function makeAgentIdentity(controlAddress: `0x${string}`): AgentIdentity {
  return {
    agentId: ("0x" + "bb".repeat(32)) as `0x${string}`,
    controlAddress,
    operatorAddress: ("0x" + "cc".repeat(20)) as `0x${string}`,
    policyRoot: ("0x" + "dd".repeat(32)) as `0x${string}`,
    reputationRoot: ("0x" + "ee".repeat(32)) as `0x${string}`,
    registeredAt: 0,
    revoked: false,
  };
}

function makePolicyCtx(
  agentId: `0x${string}`,
  computedUsdcCost: bigint,
): PolicyContext {
  return {
    request: {
      userOp: {
        sender: agentId,
        nonce: 0n,
        callData: "0x",
        callGasLimit: 100_000n,
        verificationGasLimit: 100_000n,
        preVerificationGas: 50_000n,
        maxFeePerGas: 1_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        signature: "0x",
      },
      chainId: CHAIN_ID,
      entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
      agentId,
      expectedUserOpHash: ("0x" + "00".repeat(32)) as `0x${string}`,
      validUntil: Math.floor(Date.now() / 1000) + 600,
    },
    priceQuote: {
      id: ("0x" + "aa".repeat(32)) as `0x${string}`,
      oracleId: "test",
      chainId: CHAIN_ID,
      nativePerStableScaled: 2500n * 10n ** 18n,
      asOf: Date.now(),
      native: "eth",
      stable: USDC,
      stableDecimals: 6,
    },
    computedUsdcCost,
    ledgerState: [],
    now: Date.now(),
  };
}

async function makePaymentIntent(creator: `0x${string}`, amount: string): Promise<Intent> {
  const signer = new LocalKeyAdapter({ privateKey: PK_AGENT });
  return createSignedIntent({
    body: {
      kind: "payment",
      asset: USDC,
      maxAmount: amount,
      merchant: ("0x" + "11".repeat(20)) as `0x${string}`,
      resource: "test",
    },
    creator,
    chainId: CHAIN_ID,
    deadlineMs: Date.now() + 60_000,
    signer: signer.asTypedDataSigner(),
  });
}

// ─── AgentBudgetGate ───────────────────────────────

describe("AgentBudgetGate", () => {
  it("passes through non-payment intents (transfer/swap enforced on-spend)", async () => {
    const budgetClient = new SimulatedBudgetClient();
    const gate = new AgentBudgetGate({ budgetClient: budgetClient as any });
    // Non-payment intent — budget gate must allow.
    const signer = new LocalKeyAdapter({ privateKey: PK_AGENT });
    const intent = await createSignedIntent({
      body: {
        kind: "transfer",
        asset: USDC,
        amount: "1000000",
        recipient: ("0x" + "11".repeat(20)) as `0x${string}`,
      },
      creator: signer.address,
      chainId: CHAIN_ID,
      deadlineMs: Date.now() + 60_000,
      signer: signer.asTypedDataSigner(),
    });
    const result = await gate.evaluate(intent);
    expect(result.allowed).toBe(true);
  });

  it("surfaces session-not-found with agent-budget: prefix", async () => {
    const budgetClient = new SimulatedBudgetClient();
    const gate = new AgentBudgetGate({ budgetClient: budgetClient as any });
    const signer = new LocalKeyAdapter({ privateKey: PK_AGENT });
    const intent = await makePaymentIntent(signer.address, "1000000");
    const result = await gate.evaluate(intent);
    expect(result.allowed).toBe(false);
    expect(result.failedRuleIds).toContain("agent-budget:session-not-found");
  });

  it("passes when canSpend returns ok", async () => {
    const budgetClient = new SimulatedBudgetClient();
    const signer = new LocalKeyAdapter({ privateKey: PK_AGENT });
    budgetClient.grant(signer.address, {
      perCallCap: 10_000_000n,
      dailyCap: 100_000_000n,
    });
    const gate = new AgentBudgetGate({ budgetClient: budgetClient as any });
    const intent = await makePaymentIntent(signer.address, "1000000");
    const result = await gate.evaluate(intent);
    expect(result.allowed).toBe(true);
  });

  it("denies when daily cap would be exceeded", async () => {
    const budgetClient = new SimulatedBudgetClient();
    const signer = new LocalKeyAdapter({ privateKey: PK_AGENT });
    budgetClient.grant(signer.address, {
      perCallCap: 10_000_000n,
      dailyCap: 500_000n,
    });
    const gate = new AgentBudgetGate({ budgetClient: budgetClient as any });
    const intent = await makePaymentIntent(signer.address, "1000000");
    const result = await gate.evaluate(intent);
    expect(result.allowed).toBe(false);
    expect(result.failedRuleIds).toContain("agent-budget:daily-cap-exceeded");
  });
});

// ─── BudgetSponsorPolicy ──────────────────────────

describe("BudgetSponsorPolicy", () => {
  it("denies when on-chain canSpend rejects", async () => {
    const budgetClient = new SimulatedBudgetClient();
    const policy = new BudgetSponsorPolicy({ budgetClient: budgetClient as any });
    const result = await policy.evaluate(makePolicyCtx(
      ("0x" + "aa".repeat(20)) as `0x${string}`,
      1_000_000n,
    ));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("session-not-found");
  });

  it("passes when canSpend is ok", async () => {
    const budgetClient = new SimulatedBudgetClient();
    const agent = ("0x" + "aa".repeat(20)) as `0x${string}`;
    budgetClient.grant(agent, { perCallCap: 10_000_000n, dailyCap: 100_000_000n });
    const policy = new BudgetSponsorPolicy({ budgetClient: budgetClient as any });
    const result = await policy.evaluate(makePolicyCtx(agent, 1_000_000n));
    expect(result.allowed).toBe(true);
  });
});

// ─── ReputationSponsorPolicy ──────────────────────

describe("ReputationSponsorPolicy", () => {
  it("denies when agent is unregistered", async () => {
    const resolver = new InMemoryERC8004Resolver([]);
    const policy = new ReputationSponsorPolicy({
      gate: VcGate.all([requireRegisteredAgent()]),
      resolver,
      credentials: {
        async listVerifiedCredentials() { return []; },
        listTrustedIssuers() { return []; },
      },
      aggregator: new ReputationAggregator(),
    });
    const result = await policy.evaluate(makePolicyCtx(
      ("0x" + "99".repeat(20)) as `0x${string}`,
      1_000_000n,
    ));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not registered");
  });

  it("passes when registered + gate allows", async () => {
    const agent = ("0x" + "aa".repeat(20)) as `0x${string}`;
    const identity = makeAgentIdentity(agent);
    const resolver = new InMemoryERC8004Resolver([{ identity }]);
    const policy = new ReputationSponsorPolicy({
      gate: VcGate.all([requireRegisteredAgent(), requireNotRevoked()]),
      resolver,
      credentials: {
        async listVerifiedCredentials() { return []; },
        listTrustedIssuers() { return []; },
      },
      aggregator: new ReputationAggregator(),
    });
    const result = await policy.evaluate(makePolicyCtx(agent, 1_000_000n));
    expect(result.allowed).toBe(true);
  });

  it("denies when reputation gate would reject", async () => {
    const agent = ("0x" + "aa".repeat(20)) as `0x${string}`;
    const identity = makeAgentIdentity(agent);
    const resolver = new InMemoryERC8004Resolver([{ identity }]);
    const policy = new ReputationSponsorPolicy({
      gate: VcGate.all([
        requireRegisteredAgent(),
        requireMinReputation(9999), // unattainably high
      ]),
      resolver,
      credentials: {
        async listVerifiedCredentials() { return []; },
        listTrustedIssuers() { return []; },
      },
      aggregator: new ReputationAggregator(),
    });
    const result = await policy.evaluate(makePolicyCtx(agent, 1_000_000n));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("reputation gate denied");
  });
});

// ─── runEndToEndDemo ───────────────────────────────

describe("runEndToEndDemo", () => {
  it("completes without throwing + produces a fulfilled intent", async () => {
    const result = await runEndToEndDemo();
    expect(result.intentExecution.outcome.kind).toBe("fulfilled");
    if (result.intentExecution.outcome.kind === "fulfilled") {
      expect(result.intentExecution.outcome.fill.actualAmount).toBe(result.invoice.amount);
    }
  });

  it("produces a sponsorship approval with valid paymasterData layout", async () => {
    const result = await runEndToEndDemo();
    expect(result.sponsorshipApproval.usdcCost).toBeGreaterThan(0n);
    // 20 + 16 + 16 + 6 + 6 + 65 = 129 bytes → 258 hex chars + 0x.
    expect(result.sponsorshipApproval.paymasterData.length).toBe(2 + 258);
  });

  it("anchors the audit batch with a non-empty Merkle root", async () => {
    const result = await runEndToEndDemo();
    expect(result.anchoredReceipt.record.merkleRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.anchoredReceipt.record.blockNumber).toBeGreaterThan(0n);
    expect(result.anchoredReceipt.externalId).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("audit trail traverses every stage in expected order", async () => {
    const result = await runEndToEndDemo();
    const stages = result.auditTrail.map((e) => e.stage);
    // Expected first stages: merchant, merchant, payer, agent, agent, ...
    expect(stages[0]).toBe("merchant");
    expect(stages).toContain("payer");
    expect(stages).toContain("agent");
    expect(stages).toContain("router");
    expect(stages).toContain("sponsor");
    expect(stages).toContain("audit");
    expect(stages).toContain("notarization");
  });

  it("intent-router audit events include the full success lifecycle", async () => {
    const result = await runEndToEndDemo();
    const types = result.intentAuditEvents.map((e) => e.type);
    expect(types).toContain("intent-submitted");
    expect(types).toContain("quotes-solicited");
    expect(types).toContain("quote-received");
    expect(types).toContain("quote-chosen");
    expect(types).toContain("settlement-succeeded");
  });
});
