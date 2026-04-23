/**
 * Reputation-bridge tests.
 *
 * Coverage targets:
 *
 *   1. ERC-8004 resolver: InMemory seed + CachingERC8004Resolver
 *      cache behaviour (hit, miss, TTL expiry, LRU eviction,
 *      revocation bypass).
 *   2. Reputation aggregator: deterministic ordering, weight
 *      application, payment-success cap, clamping to floor/ceiling,
 *      transparency trace reconstruction.
 *   3. Gate rules: each built-in rule against a pass/fail scenario.
 *   4. VcGate combinators: `all` vs `any`, short-circuit behaviour,
 *      rule-threw-exception handling, duplicate-id detection.
 *   5. x402 bridge: extract gate from requirement, evaluatePayment()
 *      happy path, fail-closed on unregistered agent, implicit
 *      accept when no gate, VC signals auto-contributed.
 *
 * All tests use the InMemory resolver; no network I/O.
 */

import { describe, expect, it } from "vitest";

import {
  // types
  type AgentIdentity,
  type ReputationSignal,
  type VerifiableCredential,
  type Issuer,
  type SerializedVcGate,
  DEFAULT_REPUTATION_WEIGHTS,
  defaultTierForScore,
  // resolver
  InMemoryERC8004Resolver,
  CachingERC8004Resolver,
  // aggregator
  ReputationAggregator,
  aggregateReputation,
  canonicalOrder,
  // gate + rules
  VcGate,
  requireRegisteredAgent,
  requireNotRevoked,
  requireVcOfSchema,
  requireFreshVc,
  requireMinReputation,
  requireMinTier,
  customRule,
  // bridge
  evaluatePayment,
  extractGate,
  ruleFromDirective,
  // errors
  ReputationError,
  VcGateDeniedError,
  type EvaluatePaymentOptions,
} from "@aethelred/wallet-reputation";

// ─── Fixtures ────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    agentId: ("0x" + "aa".repeat(32)) as `0x${string}`,
    controlAddress: ("0x" + "11".repeat(20)) as `0x${string}`,
    operatorAddress: ("0x" + "22".repeat(20)) as `0x${string}`,
    policyRoot: ("0x" + "33".repeat(32)) as `0x${string}`,
    reputationRoot: ("0x" + "44".repeat(32)) as `0x${string}`,
    registeredAt: 1_700_000_000_000,
    revoked: false,
    ...overrides,
  };
}

function makeIssuer(overrides: Partial<Issuer> = {}): Issuer {
  return {
    id: "test-kyc-co",
    name: "Test KYC Co",
    role: "kyc-provider",
    publicKeyHex: ("0x" + "aa".repeat(33)) as `0x${string}`,
    jurisdiction: "US",
    attestationSchemaUIDs: ["aethel/kyc-status/v1"],
    ...overrides,
  };
}

function makeVc(overrides: {
  schemaId?: string;
  issuer?: Issuer;
  issuedAt?: number;
  expiresAt?: number;
  revokedAt?: number;
} = {}): VerifiableCredential {
  const issuer = overrides.issuer ?? makeIssuer();
  const issuedAt = overrides.issuedAt ?? 1_700_000_000_000;
  return {
    attestation: {
      uid: ("0x" + Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64)) as `0x${string}`,
      schemaId: (overrides.schemaId ?? "aethel/kyc-status/v1") as "aethel/kyc-status/v1",
      issuer,
      subject: ("0x" + "cc".repeat(32)) as `0x${string}`,
      claim: { schemaId: "aethel/kyc-status/v1", value: {} },
      issuedAt,
      expiresAt: overrides.expiresAt,
      revocable: true,
      revokedAt: overrides.revokedAt,
      signature: ("0x" + "dd".repeat(64)) as `0x${string}`,
      nonce: ("0x" + "ee".repeat(32)) as `0x${string}`,
    },
  };
}

// ─── Resolver: InMemory ─────────────────────────────────────────

describe("InMemoryERC8004Resolver", () => {
  it("resolves by control address and by agent id", async () => {
    const agent = makeAgent();
    const resolver = new InMemoryERC8004Resolver([{ identity: agent }]);
    expect(await resolver.resolveByControlAddress(agent.controlAddress)).toEqual(agent);
    expect(await resolver.resolveByAgentId(agent.agentId)).toEqual(agent);
  });

  it("returns null for unknown addresses", async () => {
    const resolver = new InMemoryERC8004Resolver();
    expect(
      await resolver.resolveByControlAddress(("0x" + "99".repeat(20)) as `0x${string}`),
    ).toBeNull();
  });

  it("lists attestation UIDs seeded with the agent", async () => {
    const agent = makeAgent();
    const uids: `0x${string}`[] = [
      ("0x" + "01".repeat(32)) as `0x${string}`,
      ("0x" + "02".repeat(32)) as `0x${string}`,
    ];
    const resolver = new InMemoryERC8004Resolver([{ identity: agent, attestationUids: uids }]);
    expect(await resolver.listAttestationUids(agent.agentId)).toEqual(uids);
  });

  it("isRevoked throws for unknown agents", async () => {
    const resolver = new InMemoryERC8004Resolver();
    await expect(
      resolver.isRevoked(("0x" + "99".repeat(32)) as `0x${string}`),
    ).rejects.toBeInstanceOf(ReputationError);
  });
});

// ─── Resolver: caching wrapper ─────────────────────────────────

describe("CachingERC8004Resolver", () => {
  it("hits cache on second lookup within TTL", async () => {
    const agent = makeAgent();
    let calls = 0;
    const inner = {
      async resolveByControlAddress(addr: `0x${string}`) {
        calls += 1;
        if (addr === agent.controlAddress) return agent;
        return null;
      },
      async resolveByAgentId() {
        return null;
      },
      async listAttestationUids() {
        return [];
      },
      async isRevoked() {
        return false;
      },
    };
    const cached = new CachingERC8004Resolver(inner, { ttlMs: 1_000 });
    expect(await cached.resolveByControlAddress(agent.controlAddress)).toEqual(agent);
    expect(await cached.resolveByControlAddress(agent.controlAddress)).toEqual(agent);
    expect(calls).toBe(1);
  });

  it("evicts expired entries", async () => {
    const agent = makeAgent();
    let calls = 0;
    let nowMs = 0;
    const inner = {
      async resolveByControlAddress() {
        calls += 1;
        return agent;
      },
      async resolveByAgentId() {
        return null;
      },
      async listAttestationUids() {
        return [];
      },
      async isRevoked() {
        return false;
      },
    };
    const cached = new CachingERC8004Resolver(inner, {
      ttlMs: 1_000,
      now: () => nowMs,
    });
    await cached.resolveByControlAddress(agent.controlAddress);
    nowMs = 2_000;
    await cached.resolveByControlAddress(agent.controlAddress);
    expect(calls).toBe(2);
  });

  it("bypasses cache on isRevoked to avoid stale-safety", async () => {
    let calls = 0;
    const inner = {
      async resolveByControlAddress() {
        return makeAgent();
      },
      async resolveByAgentId() {
        return null;
      },
      async listAttestationUids() {
        return [];
      },
      async isRevoked() {
        calls += 1;
        return false;
      },
    };
    const cached = new CachingERC8004Resolver(inner, { ttlMs: 60_000 });
    const id = ("0x" + "aa".repeat(32)) as `0x${string}`;
    await cached.isRevoked(id);
    await cached.isRevoked(id);
    expect(calls).toBe(2);
  });

  it("LRU evicts oldest beyond maxEntries", async () => {
    const inner = {
      async resolveByControlAddress(addr: `0x${string}`) {
        return makeAgent({ controlAddress: addr });
      },
      async resolveByAgentId() {
        return null;
      },
      async listAttestationUids() {
        return [];
      },
      async isRevoked() {
        return false;
      },
    };
    const cached = new CachingERC8004Resolver(inner, { ttlMs: 60_000, maxEntries: 2 });
    await cached.resolveByControlAddress(("0x" + "01".repeat(20)) as `0x${string}`);
    await cached.resolveByControlAddress(("0x" + "02".repeat(20)) as `0x${string}`);
    await cached.resolveByControlAddress(("0x" + "03".repeat(20)) as `0x${string}`);
    // Cache internal state isn't observable, but the next call to 01
    // should miss. We verify by counting inner calls.
    let calls = 0;
    const inner2 = {
      async resolveByControlAddress(addr: `0x${string}`) {
        calls += 1;
        return makeAgent({ controlAddress: addr });
      },
      async resolveByAgentId() {
        return null;
      },
      async listAttestationUids() {
        return [];
      },
      async isRevoked() {
        return false;
      },
    };
    const cached2 = new CachingERC8004Resolver(inner2, { ttlMs: 60_000, maxEntries: 2 });
    await cached2.resolveByControlAddress(("0x" + "01".repeat(20)) as `0x${string}`);
    await cached2.resolveByControlAddress(("0x" + "02".repeat(20)) as `0x${string}`);
    await cached2.resolveByControlAddress(("0x" + "03".repeat(20)) as `0x${string}`);
    calls = 0;
    await cached2.resolveByControlAddress(("0x" + "01".repeat(20)) as `0x${string}`);
    expect(calls).toBe(1); // 01 was evicted, so this is a miss
  });
});

// ─── Aggregator ─────────────────────────────────────────────────

describe("ReputationAggregator", () => {
  const agentId = ("0x" + "ff".repeat(32)) as `0x${string}`;

  it("baseline score when no signals", () => {
    const score = aggregateReputation(agentId, []);
    expect(score.score).toBe(DEFAULT_REPUTATION_WEIGHTS.baseline);
    expect(score.tier).toBe(defaultTierForScore(DEFAULT_REPUTATION_WEIGHTS.baseline));
    expect(score.transparency).toHaveLength(0);
  });

  it("applies KYC VC weight", () => {
    const score = aggregateReputation(agentId, [
      {
        kind: "vc-attestation",
        schemaId: "aethel/kyc-status/v1",
        issuerRole: "kyc-provider",
        issuerId: "test-kyc",
        weight: 0,
      },
    ]);
    expect(score.score).toBe(
      DEFAULT_REPUTATION_WEIGHTS.baseline + DEFAULT_REPUTATION_WEIGHTS.kycVc,
    );
  });

  it("caps payment-success contribution", () => {
    // 200 payments at 2 weight each = 400, but cap is 100.
    const score = aggregateReputation(agentId, [
      {
        kind: "payment-success",
        count: 200,
        weight: 400,
      },
    ]);
    expect(score.score).toBe(
      DEFAULT_REPUTATION_WEIGHTS.baseline + DEFAULT_REPUTATION_WEIGHTS.successPaymentCap,
    );
  });

  it("clamps to floor when fraud reports pile up", () => {
    const signals: ReputationSignal[] = Array.from({ length: 10 }, (_, i) => ({
      kind: "fraud-report" as const,
      sourceId: `src-${i}`,
      weight: 0,
      reportedAt: 1_000_000_000 + i,
    }));
    const score = aggregateReputation(agentId, signals);
    expect(score.score).toBe(DEFAULT_REPUTATION_WEIGHTS.floor);
  });

  it("clamps to ceiling when VCs overflow", () => {
    const signals: ReputationSignal[] = [
      { kind: "vc-attestation", schemaId: "aethel/vasp-license/v1", issuerRole: "vasp-registrar", issuerId: "a", weight: 0 },
      { kind: "vc-attestation", schemaId: "aethel/vasp-license/v1", issuerRole: "vasp-registrar", issuerId: "b", weight: 0 },
      { kind: "vc-attestation", schemaId: "aethel/vasp-license/v1", issuerRole: "vasp-registrar", issuerId: "c", weight: 0 },
      { kind: "vc-attestation", schemaId: "aethel/vasp-license/v1", issuerRole: "vasp-registrar", issuerId: "d", weight: 0 },
    ];
    const score = aggregateReputation(agentId, signals);
    expect(score.score).toBe(DEFAULT_REPUTATION_WEIGHTS.ceiling);
  });

  it("transparency trace enumerates every signal in order", () => {
    const signals: ReputationSignal[] = [
      { kind: "payment-success", count: 5, weight: 0 },
      { kind: "vc-attestation", schemaId: "aethel/kyc-status/v1", issuerRole: "kyc-provider", issuerId: "k", weight: 0 },
    ];
    const score = aggregateReputation(agentId, signals);
    expect(score.transparency).toHaveLength(2);
    // VC should come BEFORE payment in canonical order.
    expect(score.transparency[0].signal.kind).toBe("vc-attestation");
    expect(score.transparency[1].signal.kind).toBe("payment-success");
  });

  it("canonicalOrder is stable: VC → payment → revocation → fraud → drift", () => {
    const signals: ReputationSignal[] = [
      { kind: "fraud-report", sourceId: "f", weight: 0, reportedAt: 0 },
      { kind: "tee-attestation-drift", codeHash: "0x00" as `0x${string}`, weight: 0, observedAt: 0 },
      { kind: "payment-success", count: 1, weight: 0 },
      { kind: "vc-attestation", schemaId: "aethel/kyc-status/v1", issuerRole: "kyc-provider", issuerId: "k", weight: 0 },
      { kind: "revocation", attestationUid: "0x00" as `0x${string}`, weight: 0, revokedAt: 0 },
    ];
    const ordered = canonicalOrder(signals);
    expect(ordered.map((s) => s.kind)).toEqual([
      "vc-attestation",
      "payment-success",
      "revocation",
      "fraud-report",
      "tee-attestation-drift",
    ]);
  });

  it("honours tuned weights", () => {
    const agg = new ReputationAggregator({ weights: { baseline: 100, kycVc: 50 } });
    const score = agg.aggregate(agentId, [
      { kind: "vc-attestation", schemaId: "aethel/kyc-status/v1", issuerRole: "kyc-provider", issuerId: "k", weight: 0 },
    ]);
    expect(score.score).toBe(150);
  });
});

// ─── Gate rules ─────────────────────────────────────────────────

describe("Gate rules", () => {
  const baseContext = {
    agent: makeAgent(),
    credentials: [] as VerifiableCredential[],
    trustedIssuers: [] as Issuer[],
    reputation: aggregateReputation(makeAgent().agentId, []),
    now: 1_700_000_000_000,
  };

  it("requireRegisteredAgent passes with a resolved agent", async () => {
    const result = await requireRegisteredAgent().evaluate(baseContext);
    expect(result.passed).toBe(true);
  });

  it("requireNotRevoked fails when revoked", async () => {
    const ctx = { ...baseContext, agent: makeAgent({ revoked: true, revocationReason: "policy-violation" }) };
    const result = await requireNotRevoked().evaluate(ctx);
    expect(result.passed).toBe(false);
    expect(result.explanation).toMatch(/revoked/i);
  });

  it("requireVcOfSchema with issuerRole finds matching VC", async () => {
    const vc = makeVc({ schemaId: "aethel/kyc-status/v1" });
    const rule = requireVcOfSchema("aethel/kyc-status/v1", { issuerRole: "kyc-provider" });
    const ctx = { ...baseContext, credentials: [vc] };
    const result = await rule.evaluate(ctx);
    expect(result.passed).toBe(true);
  });

  it("requireVcOfSchema rejects VCs from wrong issuer role", async () => {
    const vc = makeVc({
      schemaId: "aethel/kyc-status/v1",
      issuer: makeIssuer({ role: "chain-analytics" }),
    });
    const rule = requireVcOfSchema("aethel/kyc-status/v1", { issuerRole: "kyc-provider" });
    const result = await rule.evaluate({ ...baseContext, credentials: [vc] });
    expect(result.passed).toBe(false);
  });

  it("requireVcOfSchema rejects revoked VCs", async () => {
    const vc = makeVc({ schemaId: "aethel/kyc-status/v1", revokedAt: 1_000_000_000 });
    const rule = requireVcOfSchema("aethel/kyc-status/v1");
    const result = await rule.evaluate({ ...baseContext, credentials: [vc] });
    expect(result.passed).toBe(false);
  });

  it("requireVcOfSchema rejects expired VCs", async () => {
    const vc = makeVc({ schemaId: "aethel/kyc-status/v1", expiresAt: 1_000_000_000 });
    const rule = requireVcOfSchema("aethel/kyc-status/v1");
    const result = await rule.evaluate({ ...baseContext, credentials: [vc], now: 2_000_000_000 });
    expect(result.passed).toBe(false);
  });

  it("requireFreshVc passes when issued within maxAge", async () => {
    const vc = makeVc({ schemaId: "aethel/kyc-status/v1", issuedAt: 1_000_000_000 });
    const rule = requireFreshVc("aethel/kyc-status/v1", 10_000);
    const result = await rule.evaluate({ ...baseContext, credentials: [vc], now: 1_000_005_000 });
    expect(result.passed).toBe(true);
  });

  it("requireFreshVc fails when VC too old", async () => {
    const vc = makeVc({ schemaId: "aethel/kyc-status/v1", issuedAt: 0 });
    const rule = requireFreshVc("aethel/kyc-status/v1", 1_000);
    const result = await rule.evaluate({ ...baseContext, credentials: [vc], now: 10_000 });
    expect(result.passed).toBe(false);
  });

  it("requireMinReputation passes when score meets threshold", async () => {
    const result = await requireMinReputation(500).evaluate(baseContext);
    expect(result.passed).toBe(true);
  });

  it("requireMinReputation fails when below threshold", async () => {
    const result = await requireMinReputation(800).evaluate(baseContext);
    expect(result.passed).toBe(false);
  });

  it("requireMinTier passes when tier meets threshold", async () => {
    const result = await requireMinTier("basic").evaluate(baseContext);
    expect(result.passed).toBe(true);
  });

  it("customRule evaluates user-supplied predicate", async () => {
    const allow = customRule(
      "custom-allow",
      "Always passes in this test",
      () => true,
      () => "should not reach",
    );
    const deny = customRule(
      "custom-deny",
      "Always fails in this test",
      () => false,
      () => "explicitly denied",
    );
    expect((await allow.evaluate(baseContext)).passed).toBe(true);
    expect((await deny.evaluate(baseContext)).passed).toBe(false);
  });
});

// ─── VcGate combinators ────────────────────────────────────────

describe("VcGate", () => {
  const baseContext = {
    agent: makeAgent(),
    credentials: [] as VerifiableCredential[],
    trustedIssuers: [] as Issuer[],
    reputation: aggregateReputation(makeAgent().agentId, []),
    now: 1_700_000_000_000,
  };

  it("rejects empty rule set", () => {
    expect(() => VcGate.all([])).toThrow(/at least one rule/);
  });

  it("rejects duplicate rule ids", () => {
    const r = customRule("dup", "", () => true, () => "");
    expect(() => VcGate.all([r, r])).toThrow(/duplicate/i);
  });

  it("`all` combinator: all pass → allowed", async () => {
    const gate = VcGate.all([requireRegisteredAgent(), requireNotRevoked()]);
    const evaluation = await gate.evaluate(baseContext);
    expect(evaluation.allowed).toBe(true);
    expect(evaluation.failedRuleIds).toHaveLength(0);
  });

  it("`all` combinator: first failure short-circuits", async () => {
    const ctx = { ...baseContext, agent: makeAgent({ revoked: true }) };
    const touched: string[] = [];
    const gate = VcGate.all([
      customRule("a", "", () => { touched.push("a"); return true; }, () => ""),
      customRule("b", "", () => { touched.push("b"); return false; }, () => "no"),
      customRule("c", "", () => { touched.push("c"); return true; }, () => ""),
    ]);
    const evaluation = await gate.evaluate(ctx);
    expect(evaluation.allowed).toBe(false);
    expect(evaluation.failedRuleIds).toEqual(["b"]);
    expect(touched).toEqual(["a", "b"]);
  });

  it("`any` combinator: first pass short-circuits", async () => {
    const touched: string[] = [];
    const gate = VcGate.any([
      customRule("a", "", () => { touched.push("a"); return false; }, () => "no"),
      customRule("b", "", () => { touched.push("b"); return true; }, () => ""),
      customRule("c", "", () => { touched.push("c"); return true; }, () => ""),
    ]);
    const evaluation = await gate.evaluate(baseContext);
    expect(evaluation.allowed).toBe(true);
    expect(touched).toEqual(["a", "b"]);
  });

  it("rule that throws is captured as a failed result, never bypasses", async () => {
    const gate = VcGate.all([
      customRule("bad", "", () => { throw new Error("boom"); }, () => ""),
    ]);
    const evaluation = await gate.evaluate(baseContext);
    expect(evaluation.allowed).toBe(false);
    expect(evaluation.results[0].details).toMatchObject({ thrown: true });
  });

  it("assertAllowed throws VcGateDeniedError on denial", async () => {
    const gate = VcGate.all([requireMinReputation(9999)]);
    await expect(gate.assertAllowed(baseContext)).rejects.toBeInstanceOf(VcGateDeniedError);
  });
});

// ─── ruleFromDirective + extractGate ───────────────────────────

describe("ruleFromDirective + extractGate", () => {
  it("translates every directive type", () => {
    expect(ruleFromDirective({ type: "require-registered-agent" }).id).toBe("require-registered-agent");
    expect(ruleFromDirective({ type: "require-not-revoked" }).id).toBe("require-not-revoked");
    expect(
      ruleFromDirective({
        type: "require-vc",
        schemaId: "aethel/kyc-status/v1",
        issuerRole: "kyc-provider",
      }).id,
    ).toMatch(/require-vc:/);
    expect(
      ruleFromDirective({ type: "require-min-reputation", minScore: 500 }).id,
    ).toBe("require-min-reputation:500");
    expect(
      ruleFromDirective({ type: "require-min-tier", minTier: "trusted" }).id,
    ).toBe("require-min-tier:trusted");
    expect(
      ruleFromDirective({
        type: "require-fresh-vc",
        schemaId: "aethel/kyc-status/v1",
        maxAgeMs: 1000,
      }).id,
    ).toMatch(/require-fresh-vc:/);
  });

  it("extractGate returns null when no gate present", () => {
    const requirement: any = { extra: {} };
    expect(extractGate(requirement)).toBeNull();
  });

  it("extractGate throws on malformed gate", () => {
    const requirement: any = { extra: { vcGate: { directives: "not-an-array" } } };
    expect(() => extractGate(requirement)).toThrow(/SerializedVcGate/);
  });

  it("extractGate builds a functional VcGate", async () => {
    const serialized: SerializedVcGate = {
      directives: [{ type: "require-registered-agent" }],
    };
    const requirement: any = { extra: { vcGate: serialized } };
    const gate = extractGate(requirement);
    expect(gate).not.toBeNull();
    expect(gate!.ruleIds).toEqual(["require-registered-agent"]);
  });
});

// ─── evaluatePayment: full bridge ──────────────────────────────

describe("evaluatePayment", () => {
  function makeEvaluateOptions(overrides: Partial<EvaluatePaymentOptions>): EvaluatePaymentOptions {
    const agent = makeAgent();
    const issuer = makeIssuer();
    const resolver = new InMemoryERC8004Resolver([{ identity: agent }]);
    return {
      agentControlAddress: agent.controlAddress,
      resolver,
      credentialSource: {
        async listVerifiedCredentials() {
          return [];
        },
        listTrustedIssuers() {
          return [issuer];
        },
      },
      requirement: {
        scheme: "exact",
        network: "base-mainnet",
        maxAmountRequired: "1000000",
        resource: "https://example/api",
        description: "demo",
        payTo: "0x0000000000000000000000000000000000000000",
        maxTimeoutSeconds: 60,
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      } as any,
      ...overrides,
    };
  }

  it("returns allowed=true when no gate configured", async () => {
    const result = await evaluatePayment(makeEvaluateOptions({}));
    expect(result.allowed).toBe(true);
    expect(result.evaluation).toBeNull();
    expect(result.reputation.score).toBe(500);
  });

  it("fails closed when agent is unregistered and gate requires registration", async () => {
    const serialized: SerializedVcGate = {
      directives: [{ type: "require-registered-agent" }, { type: "require-not-revoked" }],
    };
    const result = await evaluatePayment(
      makeEvaluateOptions({
        agentControlAddress: ("0x" + "ee".repeat(20)) as `0x${string}`,
        requirement: {
          ...(makeEvaluateOptions({}).requirement),
          extra: { vcGate: serialized },
        } as any,
      }),
    );
    expect(result.allowed).toBe(false);
    // Both rules fail: no registration → placeholder is revoked.
    expect(result.evaluation!.failedRuleIds).toContain("require-not-revoked");
  });

  it("happy path: registered agent + KYC VC → allowed + reputation boosted", async () => {
    const agent = makeAgent();
    const issuer = makeIssuer();
    const vc = makeVc({ schemaId: "aethel/kyc-status/v1", issuer });
    const resolver = new InMemoryERC8004Resolver([{ identity: agent }]);
    const serialized: SerializedVcGate = {
      directives: [
        { type: "require-registered-agent" },
        {
          type: "require-vc",
          schemaId: "aethel/kyc-status/v1",
          issuerRole: "kyc-provider",
        },
      ],
    };
    const result = await evaluatePayment({
      agentControlAddress: agent.controlAddress,
      resolver,
      credentialSource: {
        async listVerifiedCredentials() {
          return [vc];
        },
        listTrustedIssuers() {
          return [issuer];
        },
      },
      requirement: {
        scheme: "exact",
        network: "base-mainnet",
        maxAmountRequired: "1000000",
        resource: "https://example/api",
        description: "demo",
        payTo: "0x0000000000000000000000000000000000000000",
        maxTimeoutSeconds: 60,
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        extra: { vcGate: serialized },
      } as any,
    });
    expect(result.allowed).toBe(true);
    expect(result.reputation.score).toBeGreaterThan(500);
    expect(result.evaluation!.results).toHaveLength(2);
  });

  it("denies when gate requires higher reputation than agent has", async () => {
    const agent = makeAgent();
    const resolver = new InMemoryERC8004Resolver([{ identity: agent }]);
    const serialized: SerializedVcGate = {
      directives: [{ type: "require-min-tier", minTier: "elite" }],
    };
    const result = await evaluatePayment({
      agentControlAddress: agent.controlAddress,
      resolver,
      credentialSource: {
        async listVerifiedCredentials() {
          return [];
        },
        listTrustedIssuers() {
          return [];
        },
      },
      requirement: {
        scheme: "exact",
        network: "base-mainnet",
        maxAmountRequired: "1000000",
        resource: "https://example/api",
        description: "demo",
        payTo: "0x0000000000000000000000000000000000000000",
        maxTimeoutSeconds: 60,
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        extra: { vcGate: serialized },
      } as any,
    });
    expect(result.allowed).toBe(false);
    expect(result.evaluation!.failedRuleIds).toEqual(["require-min-tier:elite"]);
  });
});
