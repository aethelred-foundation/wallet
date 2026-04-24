/**
 * Tests for the three reputation-backed PaymentGate adapters and
 * the `composeGatesByIntentKind` helper.
 *
 * Coverage (by class):
 *
 *   - ReputationTransferGate
 *     * Rejects non-transfer intents with intent-unsupported-kind.
 *     * Denies unregistered agents (requireRegisteredAgent fails closed).
 *     * Allows registered agents that satisfy the configured gate.
 *     * Denies registered agents that miss the min-reputation rule.
 *     * Passes evaluation.failedRuleIds + evaluation through verbatim.
 *
 *   - ReputationSwapGate
 *     * Rejects non-swap intents.
 *     * Denies on revoked agent.
 *     * Allows on happy path.
 *     * Evaluates against the same agentControlAddress = intent.envelope.creator.
 *
 *   - composeGatesByIntentKind
 *     * Dispatches to the transfer gate for transfer intents.
 *     * Dispatches to the swap gate for swap intents.
 *     * Dispatches to the payment gate for payment intents.
 *     * Returns `allowed: true` (no-op) when no gate is registered
 *       for the intent's kind.
 *     * Each wrapped gate only sees its own intent kind (no
 *       cross-kind leakage — the wrong gate would throw
 *       intent-unsupported-kind on receipt).
 */

import { describe, expect, it } from "vitest";

import {
  createSignedIntent,
  ReputationPaymentGate,
  ReputationSwapGate,
  ReputationTransferGate,
  composeGatesByIntentKind,
  type Intent,
  type PaymentGate,
} from "@aethelred/wallet-intent-router";
import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import {
  InMemoryERC8004Resolver,
  type AgentIdentity,
  type GateCredentialSource,
  type Issuer,
  type SerializedVcGate,
  type VerifiableCredential,
} from "@aethelred/wallet-reputation";

// ─── Fixtures ───────────────────────────────────────

const PK_AGENT = "0x" + "01".repeat(32);
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`;
const WETH = "0x4200000000000000000000000000000000000006" as `0x${string}`;
const RECIPIENT = ("0x" + "bb".repeat(20)) as `0x${string}`;
const CHAIN_ID = 8453;

function agentSigner() {
  return new LocalKeyAdapter({ privateKey: PK_AGENT }).asTypedDataSigner();
}

/** Build an ERC-8004 identity whose controlAddress matches the signer. */
function makeAgentIdentity(
  controlAddress: `0x${string}`,
  overrides: Partial<AgentIdentity> = {},
): AgentIdentity {
  return {
    agentId: ("0x" + "aa".repeat(32)) as `0x${string}`,
    controlAddress,
    operatorAddress: ("0x" + "22".repeat(20)) as `0x${string}`,
    policyRoot: ("0x" + "33".repeat(32)) as `0x${string}`,
    reputationRoot: ("0x" + "44".repeat(32)) as `0x${string}`,
    registeredAt: 1_700_000_000_000,
    revoked: false,
    ...overrides,
  };
}

function emptyCredentialSource(issuers: Issuer[] = []): GateCredentialSource {
  return {
    async listVerifiedCredentials(): Promise<ReadonlyArray<VerifiableCredential>> {
      return [];
    },
    listTrustedIssuers(): ReadonlyArray<Issuer> {
      return issuers;
    },
  };
}

/** Operator-declared "only registered, non-revoked" gate. */
const BASIC_OPERATOR_GATE: SerializedVcGate = {
  combinator: "all",
  directives: [
    { type: "require-registered-agent" },
    { type: "require-not-revoked" },
  ],
};

/**
 * Operator-declared gate with a min-reputation threshold ABOVE the
 * default baseline (500). A registered agent with no signals gets
 * score 500 — below 800 — so this gate denies on reputation.
 */
const REP_800_GATE: SerializedVcGate = {
  combinator: "all",
  directives: [
    { type: "require-registered-agent" },
    { type: "require-not-revoked" },
    { type: "require-min-reputation", minScore: 800 },
  ],
};

async function makeTransferIntent(): Promise<Intent> {
  const signer = agentSigner();
  return createSignedIntent({
    body: {
      kind: "transfer",
      asset: USDC,
      amount: "1000000",
      recipient: RECIPIENT,
    },
    creator: signer.address,
    chainId: CHAIN_ID,
    deadlineMs: Date.now() + 60_000,
    signer,
  });
}

async function makeSwapIntent(): Promise<Intent> {
  const signer = agentSigner();
  return createSignedIntent({
    body: {
      kind: "swap",
      sellAsset: USDC,
      sellAmount: "1000000",
      buyAsset: WETH,
      minBuyAmount: "100000",
      recipient: RECIPIENT,
    },
    creator: signer.address,
    chainId: CHAIN_ID,
    deadlineMs: Date.now() + 60_000,
    signer,
  });
}

async function makePaymentIntent(): Promise<Intent> {
  const signer = agentSigner();
  return createSignedIntent({
    body: {
      kind: "payment",
      asset: USDC,
      maxAmount: "1000000",
      merchant: RECIPIENT,
      resource: "https://example.com/x",
    },
    creator: signer.address,
    chainId: CHAIN_ID,
    deadlineMs: Date.now() + 60_000,
    signer,
  });
}

// ─── ReputationTransferGate ─────────────────────────

describe("ReputationTransferGate", () => {
  it("rejects non-transfer intents with intent-unsupported-kind", async () => {
    const gate = new ReputationTransferGate({
      gate: BASIC_OPERATOR_GATE,
      resolver: new InMemoryERC8004Resolver(),
      credentialSource: emptyCredentialSource(),
    });
    const intent = await makeSwapIntent();
    await expect(gate.evaluate(intent)).rejects.toMatchObject({
      code: "intent-unsupported-kind",
    });
  });

  it("denies unregistered agents (fails closed via synthesised revoked placeholder)", async () => {
    // Semantics mirror evaluatePayment's fail-closed path: when the
    // resolver returns no agent, the gate helper synthesises a
    // placeholder with revoked=true + revocationReason="agent not
    // registered in ERC-8004". The `all` combinator short-circuits
    // on the first failure, so `require-not-revoked` appears in
    // failedRuleIds — `require-registered-agent` technically passes
    // (placeholder has a non-null agentId). Same convention the
    // existing payment gate follows.
    const gate = new ReputationTransferGate({
      gate: BASIC_OPERATOR_GATE,
      resolver: new InMemoryERC8004Resolver(), // empty — no agent
      credentialSource: emptyCredentialSource(),
    });
    const intent = await makeTransferIntent();
    const result = await gate.evaluate(intent);
    expect(result.allowed).toBe(false);
    expect(result.failedRuleIds).toEqual(
      expect.arrayContaining(["require-not-revoked"]),
    );
    expect(result.evaluation).not.toBeNull();
  });

  it("allows registered, non-revoked agents against a basic gate", async () => {
    const intent = await makeTransferIntent();
    const agentId = makeAgentIdentity(intent.envelope.creator);
    const gate = new ReputationTransferGate({
      gate: BASIC_OPERATOR_GATE,
      resolver: new InMemoryERC8004Resolver([{ identity: agentId }]),
      credentialSource: emptyCredentialSource(),
    });
    const result = await gate.evaluate(intent);
    expect(result.allowed).toBe(true);
    expect(result.failedRuleIds ?? []).toEqual([]);
    expect(result.evaluation?.combinator).toBe("all");
  });

  it("denies when agent is below the min-reputation threshold", async () => {
    const intent = await makeTransferIntent();
    const agentId = makeAgentIdentity(intent.envelope.creator);
    const gate = new ReputationTransferGate({
      // No VCs, no signals → score = baseline 500. Threshold 800 →
      // require-min-reputation fails.
      gate: REP_800_GATE,
      resolver: new InMemoryERC8004Resolver([{ identity: agentId }]),
      credentialSource: emptyCredentialSource(),
    });
    const result = await gate.evaluate(intent);
    expect(result.allowed).toBe(false);
    // The built-in rule appends the threshold to its id so audit
    // logs disambiguate gates with different min-reputation values.
    expect(result.failedRuleIds).toEqual(
      expect.arrayContaining(["require-min-reputation:800"]),
    );
  });

  it("denies revoked agents on require-not-revoked", async () => {
    const intent = await makeTransferIntent();
    const agentId = makeAgentIdentity(intent.envelope.creator, {
      revoked: true,
      revocationReason: "kyc-expired",
    });
    const gate = new ReputationTransferGate({
      gate: BASIC_OPERATOR_GATE,
      resolver: new InMemoryERC8004Resolver([{ identity: agentId }]),
      credentialSource: emptyCredentialSource(),
    });
    const result = await gate.evaluate(intent);
    expect(result.allowed).toBe(false);
    expect(result.failedRuleIds).toEqual(
      expect.arrayContaining(["require-not-revoked"]),
    );
  });
});

// ─── ReputationSwapGate ─────────────────────────────

describe("ReputationSwapGate", () => {
  it("rejects non-swap intents with intent-unsupported-kind", async () => {
    const gate = new ReputationSwapGate({
      gate: BASIC_OPERATOR_GATE,
      resolver: new InMemoryERC8004Resolver(),
      credentialSource: emptyCredentialSource(),
    });
    const intent = await makeTransferIntent();
    await expect(gate.evaluate(intent)).rejects.toMatchObject({
      code: "intent-unsupported-kind",
    });
  });

  it("denies revoked agents", async () => {
    const intent = await makeSwapIntent();
    const agentId = makeAgentIdentity(intent.envelope.creator, {
      revoked: true,
    });
    const gate = new ReputationSwapGate({
      gate: BASIC_OPERATOR_GATE,
      resolver: new InMemoryERC8004Resolver([{ identity: agentId }]),
      credentialSource: emptyCredentialSource(),
    });
    const result = await gate.evaluate(intent);
    expect(result.allowed).toBe(false);
    expect(result.failedRuleIds).toEqual(
      expect.arrayContaining(["require-not-revoked"]),
    );
  });

  it("allows swaps from registered, non-revoked agents", async () => {
    const intent = await makeSwapIntent();
    const agentId = makeAgentIdentity(intent.envelope.creator);
    const gate = new ReputationSwapGate({
      gate: BASIC_OPERATOR_GATE,
      resolver: new InMemoryERC8004Resolver([{ identity: agentId }]),
      credentialSource: emptyCredentialSource(),
    });
    const result = await gate.evaluate(intent);
    expect(result.allowed).toBe(true);
  });

  it("uses intent.envelope.creator (not a body field) as the agent control address", async () => {
    const intent = await makeSwapIntent();
    // Seed an identity whose controlAddress matches the creator —
    // if the gate were checking against body.recipient instead, the
    // resolver would miss and the gate would fail-closed.
    const agentId = makeAgentIdentity(intent.envelope.creator);
    const gate = new ReputationSwapGate({
      gate: BASIC_OPERATOR_GATE,
      resolver: new InMemoryERC8004Resolver([{ identity: agentId }]),
      credentialSource: emptyCredentialSource(),
    });
    const result = await gate.evaluate(intent);
    expect(result.allowed).toBe(true);
  });
});

// ─── composeGatesByIntentKind ──────────────────────

describe("composeGatesByIntentKind", () => {
  async function setupAllThreeGates(): Promise<{
    composite: PaymentGate;
    transferIntent: Intent;
    swapIntent: Intent;
    paymentIntent: Intent;
  }> {
    const transferIntent = await makeTransferIntent();
    const swapIntent = await makeSwapIntent();
    const paymentIntent = await makePaymentIntent();

    // All three intents share the same creator (same key), so a
    // single identity covers all three gates' resolves.
    const agentId = makeAgentIdentity(transferIntent.envelope.creator);
    const resolver = new InMemoryERC8004Resolver([{ identity: agentId }]);
    const credentialSource = emptyCredentialSource();

    const composite = composeGatesByIntentKind({
      transfer: new ReputationTransferGate({
        gate: BASIC_OPERATOR_GATE,
        resolver,
        credentialSource,
      }),
      swap: new ReputationSwapGate({
        gate: BASIC_OPERATOR_GATE,
        resolver,
        credentialSource,
      }),
      payment: new ReputationPaymentGate({
        resolver,
        credentialSource,
      }),
    });

    return { composite, transferIntent, swapIntent, paymentIntent };
  }

  it("dispatches transfer intents to the transfer gate", async () => {
    const { composite, transferIntent } = await setupAllThreeGates();
    const result = await composite.evaluate(transferIntent);
    // Allowed means dispatch landed on the transfer gate, which
    // evaluated the basic operator policy against a registered
    // identity successfully. If it had dispatched to swap or
    // payment, those would THROW intent-unsupported-kind.
    expect(result.allowed).toBe(true);
  });

  it("dispatches swap intents to the swap gate", async () => {
    const { composite, swapIntent } = await setupAllThreeGates();
    const result = await composite.evaluate(swapIntent);
    expect(result.allowed).toBe(true);
  });

  it("dispatches payment intents to the payment gate", async () => {
    const { composite, paymentIntent } = await setupAllThreeGates();
    // Payment intent has no .extra.vcGate, so the payment gate's
    // underlying evaluatePayment returns allowed=true with null
    // evaluation (no gate configured on the counterparty side).
    const result = await composite.evaluate(paymentIntent);
    expect(result.allowed).toBe(true);
  });

  it("returns allowed=true with null evaluation when no gate is registered for the kind", async () => {
    const intent = await makeSwapIntent();
    const composite = composeGatesByIntentKind({
      // Only transfer gate wired — swap intents fall through.
      transfer: new ReputationTransferGate({
        gate: BASIC_OPERATOR_GATE,
        resolver: new InMemoryERC8004Resolver(),
        credentialSource: emptyCredentialSource(),
      }),
    });
    const result = await composite.evaluate(intent);
    expect(result.allowed).toBe(true);
    expect(result.evaluation).toBeNull();
  });

  it("each wrapped gate only sees its own intent kind (no cross-kind leakage)", async () => {
    // Spy gate that throws if it receives the wrong kind. If
    // dispatch is correct, each kind-specific spy only sees its
    // matching intent.
    const seenKinds: string[] = [];
    const makeSpyGate = (expected: string): PaymentGate => ({
      async evaluate(intent) {
        seenKinds.push(`${expected}:${intent.body.kind}`);
        if (intent.body.kind !== expected) {
          throw new Error(`wrong kind leaked to ${expected} gate`);
        }
        return { allowed: true, evaluation: null };
      },
    });

    const composite = composeGatesByIntentKind({
      transfer: makeSpyGate("transfer"),
      swap: makeSpyGate("swap"),
      payment: makeSpyGate("payment"),
    });

    const { transferIntent, swapIntent, paymentIntent } =
      await setupAllThreeGates();

    await composite.evaluate(transferIntent);
    await composite.evaluate(swapIntent);
    await composite.evaluate(paymentIntent);

    expect(seenKinds).toEqual([
      "transfer:transfer",
      "swap:swap",
      "payment:payment",
    ]);
  });
});
