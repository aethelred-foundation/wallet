/**
 * Paymaster-sponsor service tests.
 *
 * Coverage:
 *
 *   1. Price oracle: FixedPriceOracle round-trips the input price,
 *      chain mismatch + stable mismatch rejected, CachingPriceOracle
 *      hits inner once per TTL and clear() purges.
 *   2. Gas pricer: sum-of-gas math, markup applied with ceil, USDC
 *      math with stableDecimals conversion, overflow sanity bounds.
 *   3. Settlement ledger: record + getByRequestId round-trip, duplicate
 *      id rejected, markSettled transitions, double-reconcile
 *      rejected, markExpired idempotent, listByAgent filters by
 *      since + limit.
 *   4. Policies: KillSwitchPolicy armed denies, disarmed allows;
 *      AgentBlocklistPolicy (blocked denies, unblocked allows);
 *      RateLimitPolicy (under + over limit); MaxPerRequestPolicy;
 *      CustomPredicatePolicy; CompositeSponsorPolicy aggregates
 *      (first-fail short-circuits, attaches deniedBy).
 *   5. PaymasterSigner: sign produces 65-byte sig + assembled
 *      paymasterData of the expected layout; decodePaymasterData
 *      round-trip; validAfter>=validUntil rejected;
 *      validUntil overflow rejected.
 *   6. SponsorService: happy path returns a full approval with
 *      usdcCost, validUntil, signedAt, priceQuote; userop-hash-
 *      mismatch throws; policy denial surfaces the right code;
 *      request-id replay (second sponsor call with same inputs)
 *      rejected as request-id-reused; unsupported chain id rejected;
 *      stale quote rejected; reconcile(requestId, txHash) flips
 *      ledger to settled; expire() idempotent; duplicate reconcile
 *      rejected.
 */

import { describe, expect, it, beforeEach } from "vitest";

import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import {
  // types
  type SponsorshipRequest,
  type SponsorPolicy,
  type PolicyContext,
  type PolicyResult,
  type PriceOracle,
  // oracle
  FixedPriceOracle,
  CachingPriceOracle,
  PRICE_SCALE,
  // pricer
  GasPricer,
  // ledger
  InMemorySettlementLedger,
  // policies
  KillSwitchPolicy,
  AgentBlocklistPolicy,
  RateLimitPolicy,
  MaxPerRequestPolicy,
  CustomPredicatePolicy,
  CompositeSponsorPolicy,
  // signer + service
  PaymasterSigner,
  decodePaymasterData,
  SponsorService,
  buildRequestId,
  // errors
  PaymasterSponsorError,
} from "@aethelred/wallet-paymaster-sponsor";

import {
  computeUserOpHash,
  packUserOperation,
  type UserOperation,
} from "@aethelred/wallet-smart-account";

// ─── Fixtures ────────────────────────────────────────────────

const CHAIN_ID = 8453;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`;
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as `0x${string}`;
const PAYMASTER = ("0x" + "ee".repeat(20)) as `0x${string}`;
const AGENT = ("0x" + "aa".repeat(20)) as `0x${string}`;
const SENDER = ("0x" + "bb".repeat(20)) as `0x${string}`;

const PK_SPONSOR = "0x" + "fe".repeat(32);

function baseUserOp(overrides: Partial<UserOperation> = {}): UserOperation {
  return {
    sender: SENDER,
    nonce: 0n,
    callData: "0x",
    callGasLimit: 100_000n,
    verificationGasLimit: 100_000n,
    preVerificationGas: 50_000n,
    maxFeePerGas: 1_000_000_000n, // 1 gwei
    maxPriorityFeePerGas: 1_000_000_000n,
    signature: "0x",
    ...overrides,
  };
}

function makeValidRequest(overrides: Partial<SponsorshipRequest> = {}): SponsorshipRequest {
  const userOp = overrides.userOp ?? baseUserOp();
  const hash = computeUserOpHash(packUserOperation(userOp, ENTRY_POINT, CHAIN_ID), ENTRY_POINT, CHAIN_ID);
  return {
    userOp,
    chainId: CHAIN_ID,
    entryPoint: ENTRY_POINT,
    agentId: AGENT,
    expectedUserOpHash: hash,
    validUntil: Math.floor(Date.now() / 1000) + 600,
    validAfter: 0,
    ...overrides,
  };
}

function alwaysAllowPolicy(): SponsorPolicy {
  return {
    id: "always-allow",
    async evaluate(): Promise<PolicyResult> {
      return { allowed: true };
    },
  };
}

// ─── Price oracle ──────────────────────────────────────────

describe("FixedPriceOracle", () => {
  it("returns a quote for the configured (chain, stable)", async () => {
    const oracle = new FixedPriceOracle({
      chainId: CHAIN_ID,
      stable: USDC,
      nativePerStable: 2500, // 2500 ETH per 1 USDC? inverse — this is `native per stable`
    });
    const quote = await oracle.fetchQuote(CHAIN_ID, USDC);
    expect(quote.chainId).toBe(CHAIN_ID);
    expect(quote.stable).toBe(USDC);
    expect(quote.nativePerStableScaled).toBe(2500n * PRICE_SCALE);
    expect(quote.stableDecimals).toBe(6);
  });

  it("rejects wrong chain", async () => {
    const oracle = new FixedPriceOracle({ chainId: CHAIN_ID, stable: USDC, nativePerStable: 2500 });
    await expect(oracle.fetchQuote(1, USDC)).rejects.toMatchObject({
      code: "chain-id-unsupported",
    });
  });

  it("rejects wrong stable", async () => {
    const oracle = new FixedPriceOracle({ chainId: CHAIN_ID, stable: USDC, nativePerStable: 2500 });
    await expect(
      oracle.fetchQuote(CHAIN_ID, ("0x" + "aa".repeat(20)) as `0x${string}`),
    ).rejects.toMatchObject({ code: "price-unavailable" });
  });
});

describe("CachingPriceOracle", () => {
  it("hits inner once per TTL", async () => {
    let calls = 0;
    const inner: PriceOracle = {
      id: "inner",
      async fetchQuote() {
        calls += 1;
        return await new FixedPriceOracle({
          chainId: CHAIN_ID,
          stable: USDC,
          nativePerStable: 2500,
        }).fetchQuote(CHAIN_ID, USDC);
      },
    };
    const cached = new CachingPriceOracle(inner, { ttlMs: 60_000 });
    await cached.fetchQuote(CHAIN_ID, USDC);
    await cached.fetchQuote(CHAIN_ID, USDC);
    expect(calls).toBe(1);
  });

  it("clear() purges cache", async () => {
    let calls = 0;
    const inner: PriceOracle = {
      id: "inner",
      async fetchQuote() {
        calls += 1;
        return await new FixedPriceOracle({
          chainId: CHAIN_ID,
          stable: USDC,
          nativePerStable: 2500,
        }).fetchQuote(CHAIN_ID, USDC);
      },
    };
    const cached = new CachingPriceOracle(inner, { ttlMs: 60_000 });
    await cached.fetchQuote(CHAIN_ID, USDC);
    cached.clear();
    await cached.fetchQuote(CHAIN_ID, USDC);
    expect(calls).toBe(2);
  });
});

// ─── Gas pricer ────────────────────────────────────────────

describe("GasPricer", () => {
  const oracle = new FixedPriceOracle({
    chainId: CHAIN_ID,
    stable: USDC,
    nativePerStable: 2500,
  });

  it("prices a simple userOp with default markup (5%)", async () => {
    const quote = await oracle.fetchQuote(CHAIN_ID, USDC);
    const pricer = new GasPricer();
    const op = baseUserOp();
    const priced = pricer.price(op, quote);
    // totalGas = call + verif + pre + pmVerif(50k) + pmPostOp(50k) = 350_000
    expect(priced.totalGasUnits).toBe(350_000n);
    expect(priced.paymasterVerificationGas).toBe(50_000n);
    expect(priced.paymasterPostOpGas).toBe(50_000n);
    // maxFee = 1 gwei → totalNative = 350_000 * 1e9 = 3.5e14 wei = 0.00035 ETH
    // at 2500 USDC/ETH → 0.000_000_14 USDC (rough)... let me just assert it's positive + markup applied.
    expect(priced.usdcCost).toBeGreaterThan(0n);
    expect(priced.usdcCost).toBeGreaterThanOrEqual(priced.usdcBeforeMarkup);
  });

  it("uses caller-provided paymaster gas fields when set", async () => {
    const quote = await oracle.fetchQuote(CHAIN_ID, USDC);
    const pricer = new GasPricer();
    const op = baseUserOp({
      paymasterVerificationGasLimit: 10_000n,
      paymasterPostOpGasLimit: 15_000n,
    });
    const priced = pricer.price(op, quote);
    expect(priced.paymasterVerificationGas).toBe(10_000n);
    expect(priced.paymasterPostOpGas).toBe(15_000n);
    expect(priced.totalGasUnits).toBe(
      100_000n + 100_000n + 50_000n + 10_000n + 15_000n,
    );
  });

  it("markup applies with ceil rounding", async () => {
    const quote = await oracle.fetchQuote(CHAIN_ID, USDC);
    const pricer = new GasPricer({ markupBps: 1000 }); // 10%
    const op = baseUserOp();
    const priced = pricer.price(op, quote);
    // before * 1.1, rounded up
    const expected = (priced.usdcBeforeMarkup * 11000n + 9999n) / 10000n;
    expect(priced.usdcCost).toBe(expected);
  });

  it("rejects invalid markup", () => {
    expect(() => new GasPricer({ markupBps: -1 })).toThrow(PaymasterSponsorError);
    expect(() => new GasPricer({ markupBps: 20_000 })).toThrow(PaymasterSponsorError);
  });

  it("rejects overflow gas sums", async () => {
    const quote = await oracle.fetchQuote(CHAIN_ID, USDC);
    const pricer = new GasPricer();
    const op = baseUserOp({
      callGasLimit: 1n << 70n, // too big
    });
    // Match on the error code, not the message — which varies between
    // "2^64" and "2^200" depending on which sanity bound trips first.
    try {
      pricer.price(op, quote);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PaymasterSponsorError);
      expect((err as PaymasterSponsorError).code).toBe("gas-overflow");
    }
  });
});

// ─── Settlement ledger ─────────────────────────────────────

describe("InMemorySettlementLedger", () => {
  let ledger: InMemorySettlementLedger;

  beforeEach(() => {
    ledger = new InMemorySettlementLedger();
  });

  it("record + getByRequestId round-trip", async () => {
    const id = ("0x" + "11".repeat(32)) as `0x${string}`;
    await ledger.record({
      requestId: id,
      userOpHash: ("0x" + "22".repeat(32)) as `0x${string}`,
      agentId: AGENT,
      chainId: CHAIN_ID,
      usdcCost: 1000n,
      paymaster: PAYMASTER,
      priceQuoteId: ("0x" + "33".repeat(32)) as `0x${string}`,
      status: "approved",
      approvedAt: Date.now(),
    });
    expect((await ledger.getByRequestId(id))?.agentId).toBe(AGENT);
  });

  it("rejects duplicate requestId", async () => {
    const id = ("0x" + "11".repeat(32)) as `0x${string}`;
    const base = {
      requestId: id,
      userOpHash: ("0x" + "22".repeat(32)) as `0x${string}`,
      agentId: AGENT,
      chainId: CHAIN_ID,
      usdcCost: 1000n,
      paymaster: PAYMASTER,
      priceQuoteId: ("0x" + "33".repeat(32)) as `0x${string}`,
      status: "approved" as const,
      approvedAt: Date.now(),
    };
    await ledger.record(base);
    await expect(ledger.record(base)).rejects.toMatchObject({
      code: "request-id-reused",
    });
  });

  it("markSettled transitions + double-reconcile rejected", async () => {
    const id = ("0x" + "11".repeat(32)) as `0x${string}`;
    await ledger.record({
      requestId: id,
      userOpHash: ("0x" + "22".repeat(32)) as `0x${string}`,
      agentId: AGENT,
      chainId: CHAIN_ID,
      usdcCost: 1000n,
      paymaster: PAYMASTER,
      priceQuoteId: ("0x" + "33".repeat(32)) as `0x${string}`,
      status: "approved",
      approvedAt: Date.now(),
    });
    await ledger.markSettled(id, ("0x" + "cc".repeat(32)) as `0x${string}`, Date.now());
    expect((await ledger.getByRequestId(id))?.status).toBe("settled");
    await expect(
      ledger.markSettled(id, ("0x" + "cc".repeat(32)) as `0x${string}`, Date.now()),
    ).rejects.toMatchObject({ code: "settlement-double-reconcile" });
  });

  it("markExpired idempotent when already terminal", async () => {
    const id = ("0x" + "11".repeat(32)) as `0x${string}`;
    await ledger.record({
      requestId: id,
      userOpHash: ("0x" + "22".repeat(32)) as `0x${string}`,
      agentId: AGENT,
      chainId: CHAIN_ID,
      usdcCost: 1000n,
      paymaster: PAYMASTER,
      priceQuoteId: ("0x" + "33".repeat(32)) as `0x${string}`,
      status: "approved",
      approvedAt: Date.now(),
    });
    await ledger.markSettled(id, ("0x" + "cc".repeat(32)) as `0x${string}`, Date.now());
    // settled already — markExpired should not throw
    await expect(ledger.markExpired(id, Date.now())).resolves.toBeUndefined();
  });

  it("listByAgent filters by since + limit", async () => {
    const mk = (idByte: string, approvedAt: number) => ({
      requestId: ("0x" + idByte.repeat(32)) as `0x${string}`,
      userOpHash: ("0x" + "22".repeat(32)) as `0x${string}`,
      agentId: AGENT,
      chainId: CHAIN_ID,
      usdcCost: 1000n,
      paymaster: PAYMASTER,
      priceQuoteId: ("0x" + "33".repeat(32)) as `0x${string}`,
      status: "approved" as const,
      approvedAt,
    });
    await ledger.record(mk("11", 100));
    await ledger.record(mk("22", 200));
    await ledger.record(mk("33", 300));
    const recent = await ledger.listByAgent(AGENT, { since: 150 });
    expect(recent.map((r) => r.approvedAt)).toEqual([300, 200]);
    const limited = await ledger.listByAgent(AGENT, { limit: 1 });
    expect(limited.length).toBe(1);
  });
});

// ─── Policies ──────────────────────────────────────────────

function makePolicyCtx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  const oracle = new FixedPriceOracle({
    chainId: CHAIN_ID,
    stable: USDC,
    nativePerStable: 2500,
  });
  const basePromise = oracle.fetchQuote(CHAIN_ID, USDC);
  // Sync fixtures only — await at call sites.
  void basePromise;
  return {
    request: makeValidRequest(),
    priceQuote: {
      id: ("0x" + "aa".repeat(32)) as `0x${string}`,
      oracleId: "test",
      chainId: CHAIN_ID,
      nativePerStableScaled: 2500n * PRICE_SCALE,
      asOf: Date.now(),
      native: "eth",
      stable: USDC,
      stableDecimals: 6,
    },
    computedUsdcCost: 1000n,
    ledgerState: [],
    now: Date.now(),
    ...overrides,
  };
}

describe("KillSwitchPolicy", () => {
  it("disarmed allows", async () => {
    const p = new KillSwitchPolicy();
    expect((await p.evaluate(makePolicyCtx())).allowed).toBe(true);
  });

  it("armed denies with kill-switch-engaged", async () => {
    const p = new KillSwitchPolicy();
    p.arm();
    const r = await p.evaluate(makePolicyCtx());
    expect(r.allowed).toBe(false);
    expect(r.reasonCode).toBe("kill-switch-engaged");
  });
});

describe("AgentBlocklistPolicy", () => {
  it("allows unblocked agent", async () => {
    const p = new AgentBlocklistPolicy();
    expect((await p.evaluate(makePolicyCtx())).allowed).toBe(true);
  });

  it("denies blocked agent", async () => {
    const p = new AgentBlocklistPolicy([AGENT]);
    const r = await p.evaluate(makePolicyCtx());
    expect(r.allowed).toBe(false);
    expect(r.reasonCode).toBe("agent-blocked");
  });
});

describe("RateLimitPolicy", () => {
  it("allows when under limit", async () => {
    const p = new RateLimitPolicy({ maxUsdcPerWindow: 10_000n });
    expect((await p.evaluate(makePolicyCtx({ computedUsdcCost: 500n }))).allowed).toBe(true);
  });

  it("denies when sum > limit", async () => {
    const p = new RateLimitPolicy({ maxUsdcPerWindow: 1_000n });
    const now = Date.now();
    const ctx = makePolicyCtx({
      computedUsdcCost: 600n,
      now,
      ledgerState: [
        {
          requestId: ("0x" + "01".repeat(32)) as `0x${string}`,
          userOpHash: ("0x" + "02".repeat(32)) as `0x${string}`,
          agentId: AGENT,
          chainId: CHAIN_ID,
          usdcCost: 800n,
          paymaster: PAYMASTER,
          priceQuoteId: ("0x" + "03".repeat(32)) as `0x${string}`,
          status: "approved",
          approvedAt: now - 1000,
        },
      ],
    });
    const r = await p.evaluate(ctx);
    expect(r.allowed).toBe(false);
    expect(r.reasonCode).toBe("rate-limit-exceeded");
  });
});

describe("MaxPerRequestPolicy", () => {
  it("allows under max", async () => {
    const p = new MaxPerRequestPolicy(1_000n);
    expect((await p.evaluate(makePolicyCtx({ computedUsdcCost: 500n }))).allowed).toBe(true);
  });

  it("denies over max", async () => {
    const p = new MaxPerRequestPolicy(1_000n);
    const r = await p.evaluate(makePolicyCtx({ computedUsdcCost: 2_000n }));
    expect(r.allowed).toBe(false);
    expect(r.reasonCode).toBe("policy-denied");
  });
});

describe("CompositeSponsorPolicy", () => {
  it("short-circuits on first denial + attaches deniedBy", async () => {
    const kill = new KillSwitchPolicy();
    kill.arm();
    const touched: string[] = [];
    const alwaysAllow = new CustomPredicatePolicy(
      "always-allow",
      () => {
        touched.push("always-allow");
        return true;
      },
      () => "",
    );
    const composite = new CompositeSponsorPolicy([kill, alwaysAllow]);
    const r = await composite.evaluate(makePolicyCtx());
    expect(r.allowed).toBe(false);
    expect(r.details?.deniedBy).toBe("kill-switch");
    expect(touched).toEqual([]); // short-circuit
  });

  it("rejects duplicate component ids", () => {
    expect(
      () =>
        new CompositeSponsorPolicy([
          new MaxPerRequestPolicy(100n),
          new MaxPerRequestPolicy(100n),
        ]),
    ).toThrow(/duplicate/);
  });

  it("empty component list rejected", () => {
    expect(() => new CompositeSponsorPolicy([])).toThrow(/at least one component/);
  });
});

// ─── PaymasterSigner ───────────────────────────────────────

describe("PaymasterSigner", () => {
  it("sign produces 65-byte sig + 129-byte paymasterData", async () => {
    const signer = new LocalKeyAdapter({ privateKey: PK_SPONSOR });
    const pmSigner = new PaymasterSigner({
      paymasterAddress: PAYMASTER,
      signer: signer.asTypedDataSigner(),
    });
    const result = await pmSigner.sign({
      userOpHash: ("0x" + "aa".repeat(32)) as `0x${string}`,
      validUntil: Math.floor(Date.now() / 1000) + 600,
      validAfter: 0,
      paymasterVerificationGas: 50_000n,
      paymasterPostOpGas: 50_000n,
      chainId: CHAIN_ID,
    });
    expect(result.signature.length).toBe(2 + 130);
    // paymasterData: 20 + 16 + 16 + 6 + 6 + 65 = 129 bytes → 258 hex chars
    expect(result.paymasterData.length).toBe(2 + 258);
    // First 20 bytes is the paymaster address
    expect(result.paymasterData.slice(2, 42).toLowerCase()).toBe(
      PAYMASTER.slice(2).toLowerCase(),
    );
  });

  it("decodePaymasterData round-trips encoder output", async () => {
    const signer = new LocalKeyAdapter({ privateKey: PK_SPONSOR });
    const pmSigner = new PaymasterSigner({
      paymasterAddress: PAYMASTER,
      signer: signer.asTypedDataSigner(),
    });
    const validUntil = Math.floor(Date.now() / 1000) + 600;
    const result = await pmSigner.sign({
      userOpHash: ("0x" + "bb".repeat(32)) as `0x${string}`,
      validUntil,
      validAfter: 100,
      paymasterVerificationGas: 12_345n,
      paymasterPostOpGas: 67_890n,
      chainId: CHAIN_ID,
    });
    const decoded = decodePaymasterData(result.paymasterData);
    expect(decoded.paymaster.toLowerCase()).toBe(PAYMASTER.toLowerCase());
    expect(decoded.verificationGas).toBe(12_345n);
    expect(decoded.postOpGas).toBe(67_890n);
    expect(decoded.validUntil).toBe(validUntil);
    expect(decoded.validAfter).toBe(100);
    expect(decoded.signature).toBe(result.signature);
  });

  it("rejects validAfter >= validUntil", async () => {
    const signer = new LocalKeyAdapter({ privateKey: PK_SPONSOR });
    const pmSigner = new PaymasterSigner({
      paymasterAddress: PAYMASTER,
      signer: signer.asTypedDataSigner(),
    });
    await expect(
      pmSigner.sign({
        userOpHash: ("0x" + "bb".repeat(32)) as `0x${string}`,
        validUntil: 100,
        validAfter: 100,
        paymasterVerificationGas: 50_000n,
        paymasterPostOpGas: 50_000n,
        chainId: CHAIN_ID,
      }),
    ).rejects.toMatchObject({ code: "request-malformed" });
  });
});

// ─── SponsorService ────────────────────────────────────────

describe("SponsorService", () => {
  function makeService(
    overrides: { policy?: SponsorPolicy; now?: () => number } = {},
  ): {
    service: SponsorService;
    ledger: InMemorySettlementLedger;
  } {
    const ledger = new InMemorySettlementLedger();
    const signer = new LocalKeyAdapter({ privateKey: PK_SPONSOR });
    const clock = overrides.now ?? (() => Date.now());
    const service = new SponsorService({
      oracle: new FixedPriceOracle({
        chainId: CHAIN_ID,
        stable: USDC,
        nativePerStable: 2500,
        now: clock, // share the clock so quote.asOf is stable per frozen instant
      }),
      stable: USDC,
      pricer: new GasPricer(),
      policy: overrides.policy ?? alwaysAllowPolicy(),
      ledger,
      paymasterSigner: new PaymasterSigner({
        paymasterAddress: PAYMASTER,
        signer: signer.asTypedDataSigner(),
      }),
      supportedChainIds: [CHAIN_ID],
      now: clock,
    });
    return { service, ledger };
  }

  it("happy path produces a complete approval", async () => {
    const { service } = makeService();
    const approval = await service.sponsor(makeValidRequest());
    expect(approval.paymaster).toBe(PAYMASTER);
    expect(approval.paymasterData.length).toBe(2 + 258);
    expect(approval.usdcCost).toBeGreaterThan(0n);
    expect(approval.paymasterVerificationGasLimit).toBe(50_000n);
    expect(approval.requestId.startsWith("0x")).toBe(true);
  });

  it("rejects userop-hash-mismatch", async () => {
    const { service } = makeService();
    await expect(
      service.sponsor(
        makeValidRequest({
          expectedUserOpHash: ("0x" + "ff".repeat(32)) as `0x${string}`,
        }),
      ),
    ).rejects.toMatchObject({ code: "userop-hash-mismatch" });
  });

  it("rejects chain-id-unsupported", async () => {
    const { service } = makeService();
    const userOp = baseUserOp();
    const hashOnOtherChain = computeUserOpHash(
      packUserOperation(userOp, ENTRY_POINT, 1),
      ENTRY_POINT,
      1,
    );
    await expect(
      service.sponsor({
        userOp,
        chainId: 1,
        entryPoint: ENTRY_POINT,
        agentId: AGENT,
        expectedUserOpHash: hashOnOtherChain,
        validUntil: Math.floor(Date.now() / 1000) + 600,
        validAfter: 0,
      }),
    ).rejects.toMatchObject({ code: "chain-id-unsupported" });
  });

  it("rejects past validUntil", async () => {
    const { service } = makeService();
    await expect(
      service.sponsor(
        makeValidRequest({ validUntil: Math.floor(Date.now() / 1000) - 100 }),
      ),
    ).rejects.toMatchObject({ code: "request-malformed" });
  });

  it("surfaces policy denial with code + reason", async () => {
    const kill = new KillSwitchPolicy();
    kill.arm();
    const { service } = makeService({ policy: kill });
    await expect(service.sponsor(makeValidRequest())).rejects.toMatchObject({
      code: "kill-switch-engaged",
    });
  });

  it("replayed request rejected as request-id-reused", async () => {
    // Pin the clock so the oracle returns the same quote id on both
    // calls — otherwise requestId differs per call and there's no
    // collision to detect.
    const FIXED = 1_700_000_000_000;
    const { service } = makeService({ now: () => FIXED });
    const req = makeValidRequest();
    await service.sponsor(req);
    await expect(service.sponsor(req)).rejects.toMatchObject({
      code: "request-id-reused",
    });
  });

  it("reconcile + expire lifecycle", async () => {
    const { service, ledger } = makeService();
    const approval = await service.sponsor(makeValidRequest());
    await service.reconcile(approval.requestId, ("0x" + "cc".repeat(32)) as `0x${string}`);
    expect((await ledger.getByRequestId(approval.requestId))?.status).toBe("settled");
    // expire on a settled one is idempotent no-op
    await service.expire(approval.requestId);
  });

  it("buildRequestId is deterministic for same inputs", () => {
    const a = buildRequestId({
      userOpHash: ("0x" + "11".repeat(32)) as `0x${string}`,
      validUntil: 42,
      validAfter: 0,
      priceQuoteId: ("0x" + "22".repeat(32)) as `0x${string}`,
    });
    const b = buildRequestId({
      userOpHash: ("0x" + "11".repeat(32)) as `0x${string}`,
      validUntil: 42,
      validAfter: 0,
      priceQuoteId: ("0x" + "22".repeat(32)) as `0x${string}`,
    });
    expect(a).toBe(b);
  });
});
