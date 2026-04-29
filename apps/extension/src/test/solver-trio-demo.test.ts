/**
 * Solver-trio demo tests.
 *
 * Covers `runSolverTrioDemo()` — the composition-breadth artifact
 * that threads one IntentRouter + one SolverRegistry through all
 * three concrete solvers (transfer / swap / x402-facilitator) and
 * proves each commitment-rule holds on the resulting Fills.
 *
 * Coverage:
 *
 *   1. runSolverTrioDemo completes without throwing.
 *   2. Returns exactly three intent results, one per kind, in the
 *      expected order.
 *   3. Each intent is fulfilled (no declines / no failures).
 *   4. Each commitment rule holds:
 *        transfer → actualAmount === commitment
 *        swap     → actualAmount >= commitment
 *        payment  → actualAmount <= commitment
 *   5. Dispatch correctness — each intent is served by the expected
 *      solver id (the registry picks the right solver per kind, not
 *      by accident of order).
 *   6. Audit events fire for every intent — 5 event types × 3
 *      intents = 15 events, with the expected distribution.
 *   7. Settlement refs are present (tx hashes / payment ids), so
 *      the audit trail has anchors.
 *   8. Deterministic when `now` is pinned — intent ids differ across
 *      kinds (different bodies) but stable across runs (same inputs).
 */

import { describe, expect, it } from "vitest";

import { runSolverTrioDemo } from "@aethelred/wallet-integration";

describe("runSolverTrioDemo", () => {
  it("completes without throwing", async () => {
    await expect(runSolverTrioDemo()).resolves.toBeDefined();
  });

  it("returns three results in the order: transfer, swap, payment", async () => {
    const result = await runSolverTrioDemo();
    expect(result.results).toHaveLength(3);
    expect(result.results.map((r) => r.kind)).toEqual([
      "transfer",
      "swap",
      "payment",
    ]);
  });

  it("fulfills every intent (no decline / no failure)", async () => {
    const result = await runSolverTrioDemo();
    for (const r of result.results) {
      expect(r.executionResult.outcome.kind).toBe("fulfilled");
      expect(r.fill).toBeDefined();
    }
  });

  it("holds the commitment rule on every intent", async () => {
    const result = await runSolverTrioDemo();
    for (const r of result.results) {
      expect(r.commitmentRuleHeld).toBe(true);
    }
  });

  it("transfer result: actualAmount === commitment (strict equality)", async () => {
    const result = await runSolverTrioDemo();
    const t = result.results.find((r) => r.kind === "transfer")!;
    expect(t.solverId).toBe("transfer:base-mainnet");
    expect(t.rule).toBe("=== commitment");
    expect(BigInt(t.fill!.actualAmount)).toBe(
      BigInt(t.fill!.quoteCommitment),
    );
  });

  it("swap result: actualAmount >= commitment (floor)", async () => {
    const result = await runSolverTrioDemo();
    const s = result.results.find((r) => r.kind === "swap")!;
    expect(s.solverId).toBe("swap:stub:base-mainnet");
    expect(s.rule).toBe(">= commitment");
    expect(BigInt(s.fill!.actualAmount)).toBeGreaterThanOrEqual(
      BigInt(s.fill!.quoteCommitment),
    );
  });

  it("payment result: actualAmount <= commitment (ceiling)", async () => {
    const result = await runSolverTrioDemo();
    const p = result.results.find((r) => r.kind === "payment")!;
    expect(p.solverId).toBe("x402-facilitator:base-mainnet");
    expect(p.rule).toBe("<= commitment");
    expect(BigInt(p.fill!.actualAmount)).toBeLessThanOrEqual(
      BigInt(p.fill!.quoteCommitment),
    );
  });

  it("dispatches each intent to the correct solver (not by accident of order)", async () => {
    const result = await runSolverTrioDemo();
    const byKind = Object.fromEntries(
      result.results.map((r) => [r.kind, r.solverId]),
    );
    expect(byKind.transfer).toBe("transfer:base-mainnet");
    expect(byKind.swap).toBe("swap:stub:base-mainnet");
    expect(byKind.payment).toBe("x402-facilitator:base-mainnet");
  });

  it("fires 15 audit events (5 stages × 3 intents)", async () => {
    const result = await runSolverTrioDemo();
    expect(result.auditEvents).toHaveLength(15);

    const types = new Map<string, number>();
    for (const e of result.auditEvents) {
      types.set(e.type, (types.get(e.type) ?? 0) + 1);
    }
    expect(types.get("intent-submitted")).toBe(3);
    expect(types.get("quotes-solicited")).toBe(3);
    expect(types.get("quote-received")).toBe(3);
    expect(types.get("quote-chosen")).toBe(3);
    expect(types.get("settlement-succeeded")).toBe(3);
  });

  it("every fill has a non-empty settlementRef", async () => {
    const result = await runSolverTrioDemo();
    for (const r of result.results) {
      expect(r.fill?.settlementRef).toBeTruthy();
      expect(r.fill?.settlementRef!.length).toBeGreaterThan(2);
    }
  });

  it("evaluates a reputation gate for every intent (universal spine)", async () => {
    const result = await runSolverTrioDemo();
    // Every intent should have a gate result captured during
    // router.execute. Before the router fix in this PR, only the
    // payment intent would have one — the spy captures gate
    // evaluations, and transfer+swap bypassed the paymentGate.
    for (const r of result.results) {
      expect(r.gateResult).toBeDefined();
      expect(r.gateResult!.allowed).toBe(true);
      expect(r.gateResult!.evaluation).not.toBeNull();
    }
  });

  it("surfaces the operator policy on the result", async () => {
    const result = await runSolverTrioDemo();
    expect(result.operatorPolicy.combinator).toBe("all");
    expect(result.operatorPolicy.directives.length).toBeGreaterThanOrEqual(2);
    const directiveTypes = result.operatorPolicy.directives.map((d) => d.type);
    expect(directiveTypes).toEqual(
      expect.arrayContaining(["require-registered-agent", "require-not-revoked"]),
    );
  });

  it("payment gate evaluates the policy carried in intent.body.extra.vcGate", async () => {
    const result = await runSolverTrioDemo();
    // All three gates now return structured evaluations (not null).
    // The payment gate reads its policy from the intent body's extra
    // field, while transfer + swap read from gate config — all
    // three should surface a non-null evaluation.
    for (const r of result.results) {
      expect(r.gateResult?.evaluation).not.toBeNull();
      // The evaluation's combinator mirrors the operator policy.
      expect(r.gateResult?.evaluation?.combinator).toBe("all");
    }
  });

  // ─── Deny-mode coverage ────────────────────────────

  describe("deny mode (skipAgentRegistration: true)", () => {
    it("sets denyModeExpected: true on the result", async () => {
      const result = await runSolverTrioDemo({ skipAgentRegistration: true });
      expect(result.denyModeExpected).toBe(true);
    });

    it("every intent hits payment-gated (no fills)", async () => {
      const result = await runSolverTrioDemo({ skipAgentRegistration: true });
      for (const r of result.results) {
        expect(r.executionResult.outcome.kind).toBe("payment-gated");
        expect(r.fill).toBeUndefined();
      }
    });

    it("every gate denies with require-not-revoked (synthesised-revoked placeholder)", async () => {
      const result = await runSolverTrioDemo({ skipAgentRegistration: true });
      for (const r of result.results) {
        expect(r.gateResult?.allowed).toBe(false);
        // The require-registered-agent rule passes on the synthesised
        // placeholder (placeholder has a non-null agentId), so the
        // `all` combinator short-circuits on require-not-revoked.
        // Same convention ReputationPaymentGate follows via
        // evaluatePayment's fail-closed path.
        expect(r.gateResult?.failedRuleIds).toEqual(
          expect.arrayContaining(["require-not-revoked"]),
        );
      }
    });

    it("audit events drop from 15 → 6 (2 stages × 3 intents: submit + payment-gated)", async () => {
      const result = await runSolverTrioDemo({ skipAgentRegistration: true });
      expect(result.auditEvents).toHaveLength(6);
      const types = new Map<string, number>();
      for (const e of result.auditEvents) {
        types.set(e.type, (types.get(e.type) ?? 0) + 1);
      }
      expect(types.get("intent-submitted")).toBe(3);
      expect(types.get("payment-gated")).toBe(3);
      // No quote-* events because the router short-circuited at the gate.
      expect(types.get("quotes-solicited")).toBeUndefined();
      expect(types.get("settlement-succeeded")).toBeUndefined();
    });

    it("commitmentRuleHeld is false for denied intents (fill is absent)", async () => {
      const result = await runSolverTrioDemo({ skipAgentRegistration: true });
      for (const r of result.results) {
        expect(r.commitmentRuleHeld).toBe(false);
      }
    });

    it("solver dispatch still records the expected solver id (for operator diagnostics)", async () => {
      // Even though the gate denies before a solver is picked, the
      // classifyResult helper preserves the `expectedSolverId` on
      // the solverId field so operators reading deny-mode output see
      // WHICH solver would have served the intent had the gate allowed.
      const result = await runSolverTrioDemo({ skipAgentRegistration: true });
      const byKind = Object.fromEntries(
        result.results.map((r) => [r.kind, r.solverId]),
      );
      expect(byKind.transfer).toBe("transfer:base-mainnet");
      expect(byKind.swap).toBe("swap:stub:base-mainnet");
      expect(byKind.payment).toBe("x402-facilitator:base-mainnet");
    });

    it("default mode is allow — omitting skipAgentRegistration still returns denyModeExpected: false", async () => {
      const result = await runSolverTrioDemo();
      expect(result.denyModeExpected).toBe(false);
      for (const r of result.results) {
        expect(r.executionResult.outcome.kind).toBe("fulfilled");
      }
    });
  });

  // ─── Gas telemetry ─────────────────────────────────

  describe("gas telemetry", () => {
    it("transfer fill.metadata carries gasUsed + gasCostWei", async () => {
      const result = await runSolverTrioDemo();
      const transfer = result.results.find((r) => r.kind === "transfer")!;
      const meta = transfer.fill!.metadata as {
        gasUsed?: bigint;
        gasCostWei?: bigint;
      };
      // DemoChainProvider applies deterministic ±10% jitter so the
      // histogram has spread under --samples >1. The FIRST tx (idx
      // 0 in the jitter cycle) is at -10%: 60_000 * 0.9 = 54_000.
      // gasPrice for idx 0: 500_000 + 0 = 500_000.
      expect(meta.gasUsed).toBe(54_000n);
      expect(meta.gasCostWei).toBe(54_000n * 500_000n);
    });

    it("swap fill.metadata carries aggregate gasUsed + perTxGasUsed", async () => {
      const result = await runSolverTrioDemo();
      const swap = result.results.find((r) => r.kind === "swap")!;
      const meta = swap.fill!.metadata as {
        gasUsed?: bigint;
        gasCostWei?: bigint;
        perTxGasUsed?: ReadonlyArray<bigint | null>;
      };
      // Second tx in the demo (idx 1 in the jitter cycle): -5%.
      // 180_000 * 0.95 = 171_000. gasPrice: 500_000 + 50_000 = 550_000.
      expect(meta.gasUsed).toBe(171_000n);
      expect(meta.gasCostWei).toBe(171_000n * 550_000n);
      expect(meta.perTxGasUsed).toEqual([171_000n]);
    });

    it("payment fill.metadata does NOT carry on-chain gas fields (x402 pays separately)", async () => {
      const result = await runSolverTrioDemo();
      const payment = result.results.find((r) => r.kind === "payment")!;
      const meta = payment.fill!.metadata as {
        gasUsed?: bigint;
        gasCostWei?: bigint;
        perTxGasUsed?: unknown;
      };
      // x402 facilitator pays gas — not attributed to the agent.
      // The solver's metadata shape deliberately omits these fields.
      expect(meta.gasUsed).toBeUndefined();
      expect(meta.gasCostWei).toBeUndefined();
      expect(meta.perTxGasUsed).toBeUndefined();
    });

    it("deny mode has no fills, so no gas telemetry to check (skip safely)", async () => {
      const result = await runSolverTrioDemo({ skipAgentRegistration: true });
      for (const r of result.results) {
        // No fill → no metadata → no gas fields. Observability
        // pipelines consuming the fill stream should skip denied
        // intents naturally.
        expect(r.fill).toBeUndefined();
      }
    });
  });

  // ─── Histogram (samples > 1) ────────────────────────

  describe("gas histogram with samples > 1", () => {
    it("default samples=1 yields a histogram with single-sample stats per solver", async () => {
      const result = await runSolverTrioDemo();
      // Two solvers feed the histogram (transfer, swap); x402 is
      // skipped because the facilitator pays gas.
      expect(result.gasHistogram.size).toBe(2);
      for (const stats of result.gasHistogram.values()) {
        expect(stats.count).toBe(1);
        // With one sample, all percentiles + min/max collapse.
        expect(stats.p50).toBe(stats.mean);
        expect(stats.p95).toBe(stats.mean);
        expect(stats.p99).toBe(stats.mean);
        expect(stats.min).toBe(stats.mean);
        expect(stats.max).toBe(stats.mean);
      }
    });

    it("samples=10 produces meaningful percentile spread (p50 ≠ p95)", async () => {
      const result = await runSolverTrioDemo({ samples: 10 });
      const transfer = result.gasHistogram.get("transfer:base-mainnet");
      const swap = result.gasHistogram.get("swap:stub:base-mainnet");
      expect(transfer?.count).toBe(10);
      expect(swap?.count).toBe(10);
      // The DemoChainProvider's deterministic ±10% jitter ensures
      // p50 < p95 for both solvers (otherwise the histogram is
      // visually pointless and the demo claim is hollow).
      expect(transfer!.p50).toBeLessThan(transfer!.p95);
      expect(swap!.p50).toBeLessThan(swap!.p95);
      expect(transfer!.min).toBeLessThan(transfer!.max);
      expect(swap!.min).toBeLessThan(swap!.max);
    });

    it("samples=10 emits 30 fills total — 5 audit-event types × 30 intents = 150 events", async () => {
      const result = await runSolverTrioDemo({ samples: 10 });
      expect(result.auditEvents.length).toBe(150);
      const counts = new Map<string, number>();
      for (const e of result.auditEvents) {
        counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
      }
      expect(counts.get("intent-submitted")).toBe(30);
      expect(counts.get("settlement-succeeded")).toBe(30);
    });

    it("x402 (payment) is correctly EXCLUDED from the histogram", async () => {
      const result = await runSolverTrioDemo({ samples: 5 });
      // Transfer + swap appear; payment doesn't (gasUsed undefined
      // on its metadata → fillToGasSample returns null).
      expect(result.gasHistogram.has("transfer:base-mainnet")).toBe(true);
      expect(result.gasHistogram.has("swap:stub:base-mainnet")).toBe(true);
      expect(result.gasHistogram.has("x402-facilitator:base-mainnet")).toBe(
        false,
      );
    });

    it("deny mode produces an empty histogram (no fills exist)", async () => {
      const result = await runSolverTrioDemo({
        skipAgentRegistration: true,
        samples: 5,
      });
      expect(result.gasHistogram.size).toBe(0);
    });

    it("exposes gasHistogramInstance for direct exportToMeter usage", async () => {
      // The orchestrator returns the live SolverGasHistogram so the
      // CLI's --prom flag (and any production consumer) can call
      // exportToMeter() without rebuilding state from snapshots.
      // Importing InMemoryMeter directly here keeps the test
      // self-contained.
      const { InMemoryMeter } = await import("@aethelred/wallet-observability");
      const result = await runSolverTrioDemo({ samples: 5 });
      expect(result.gasHistogramInstance).toBeDefined();

      const meter = new InMemoryMeter();
      result.gasHistogramInstance.exportToMeter(meter);
      // Every distribution gauge populated for both real solvers.
      expect(
        meter.gauge("solver_gas_count").getValue({ solver_id: "transfer:base-mainnet" }),
      ).toBe(5);
      expect(
        meter.gauge("solver_gas_count").getValue({ solver_id: "swap:stub:base-mainnet" }),
      ).toBe(5);
      // Counter has cumulative cost.
      expect(
        meter
          .counter("solver_gas_cost_wei_total")
          .getValue({ solver_id: "transfer:base-mainnet" }),
      ).toBeGreaterThan(0);
      // x402 NOT in the histogram → no series for it on any gauge.
      expect(
        meter
          .gauge("solver_gas_count")
          .getValue({ solver_id: "x402-facilitator:base-mainnet" }),
      ).toBeUndefined();
    });

    it("Prometheus output from the bridge contains every expected metric line", async () => {
      const { InMemoryMeter } = await import("@aethelred/wallet-observability");
      const result = await runSolverTrioDemo({ samples: 5 });
      const meter = new InMemoryMeter();
      result.gasHistogramInstance.exportToMeter(meter);
      const prom = meter.toPrometheus();

      // All 7 distribution gauges + 2 counters declared.
      for (const metric of [
        "solver_gas_count",
        "solver_gas_mean",
        "solver_gas_p50",
        "solver_gas_p95",
        "solver_gas_p99",
        "solver_gas_min",
        "solver_gas_max",
        "solver_gas_cost_wei_total",
        "solver_gas_cost_samples_total",
      ]) {
        expect(prom).toContain(`# TYPE ${metric}`);
      }
      // Both real solvers labelled.
      expect(prom).toContain('solver_id="transfer:base-mainnet"');
      expect(prom).toContain('solver_id="swap:stub:base-mainnet"');
      // x402 omitted from histogram → not in Prometheus output.
      expect(prom).not.toContain('solver_id="x402-facilitator:base-mainnet"');
    });

    // ─── --venue uniswap-v3 path ────────────────────

    describe("with swapVenue: 'uniswap-v3'", () => {
      it("default swapVenueId is 'stub'", async () => {
        const result = await runSolverTrioDemo();
        expect(result.swapVenueId).toBe("stub");
      });

      it("swapVenue: 'uniswap-v3' switches the swap solver id", async () => {
        const result = await runSolverTrioDemo({ swapVenue: "uniswap-v3" });
        expect(result.swapVenueId).toBe("uniswap-v3");
        const swap = result.results.find((r) => r.kind === "swap")!;
        expect(swap.solverId).toBe("swap:uniswap-v3:base-mainnet");
      });

      it("swapVenue: 'uniswap-v3' produces a two-tx swap fill (approve + swap)", async () => {
        const result = await runSolverTrioDemo({ swapVenue: "uniswap-v3" });
        const swap = result.results.find((r) => r.kind === "swap")!;
        expect(swap.executionResult.outcome.kind).toBe("fulfilled");
        const meta = swap.fill!.metadata as {
          receipts: ReadonlyArray<unknown>;
          txLabels: ReadonlyArray<string>;
          perTxGasUsed?: ReadonlyArray<bigint | null>;
        };
        // Two receipts, labelled approve + swap.
        expect(meta.receipts).toHaveLength(2);
        expect(meta.txLabels).toEqual(["approve", "swap"]);
        // Per-tx gas: first 60k (approve, short calldata jittered);
        // second 180k (swap, long calldata jittered). Neither is
        // null — both txs have receipts with gas data.
        expect(meta.perTxGasUsed).toHaveLength(2);
        expect(meta.perTxGasUsed![0]).not.toBeNull();
        expect(meta.perTxGasUsed![1]).not.toBeNull();
      });

      it("swapVenue: 'uniswap-v3' commitment ≥ minBuyAmount holds (production venue path)", async () => {
        const result = await runSolverTrioDemo({ swapVenue: "uniswap-v3" });
        const swap = result.results.find((r) => r.kind === "swap")!;
        expect(swap.commitmentRuleHeld).toBe(true);
        // Same commitment math as stub (both produce the same
        // mid-price since the stubbed transport returns the same
        // amountOut as StubSwapVenue's price ratio).
        expect(BigInt(swap.fill!.actualAmount)).toBeGreaterThanOrEqual(
          BigInt(swap.fill!.quoteCommitment),
        );
      });

      it("swapVenue: 'uniswap-v3' actualAmount is decoded from the Pool Swap event", async () => {
        const result = await runSolverTrioDemo({ swapVenue: "uniswap-v3" });
        const swap = result.results.find((r) => r.kind === "swap")!;
        // The orchestrator's stubbed receipt log encodes
        // amount0 = -270e12 (WETH out). decodeFillAmount should
        // return exactly that magnitude.
        expect(BigInt(swap.fill!.actualAmount)).toBe(270_000_000_000_000n);
      });

      it("swapVenue: 'uniswap-v3' samples=5 produces a histogram under the v3 solver id", async () => {
        const result = await runSolverTrioDemo({
          swapVenue: "uniswap-v3",
          samples: 5,
        });
        const v3Stats = result.gasHistogram.get(
          "swap:uniswap-v3:base-mainnet",
        );
        expect(v3Stats).toBeDefined();
        expect(v3Stats!.count).toBe(5);
        // The stub solver id should NOT appear — only one venue ran.
        expect(result.gasHistogram.has("swap:stub:base-mainnet")).toBe(false);
      });

      it("preflightAllowance reduces v3 swap from 2-tx to 1-tx (single-tx swap)", async () => {
        const result = await runSolverTrioDemo({
          swapVenue: "uniswap-v3",
          preflightAllowance: true,
        });
        const swap = result.results.find((r) => r.kind === "swap")!;
        const meta = swap.fill!.metadata as {
          receipts: ReadonlyArray<unknown>;
          txLabels: ReadonlyArray<string>;
        };
        expect(meta.receipts).toHaveLength(1);
        expect(meta.txLabels).toEqual(["swap"]);
      });

      it("preflightAllowance: false (default) keeps the 2-tx [approve, swap] sequence", async () => {
        const result = await runSolverTrioDemo({
          swapVenue: "uniswap-v3",
          // preflightAllowance NOT set
        });
        const swap = result.results.find((r) => r.kind === "swap")!;
        const meta = swap.fill!.metadata as {
          txLabels: ReadonlyArray<string>;
        };
        expect(meta.txLabels).toEqual(["approve", "swap"]);
      });

      it("preflightAllowance has no effect with stub venue", async () => {
        // Stub ignores the flag — always emits single-tx swap.
        const result = await runSolverTrioDemo({
          swapVenue: "stub",
          preflightAllowance: true,
        });
        const swap = result.results.find((r) => r.kind === "swap")!;
        const meta = swap.fill!.metadata as {
          txLabels: ReadonlyArray<string>;
        };
        expect(meta.txLabels).toEqual(["swap"]);
      });
    });

    it("samples is clamped to ≥ 1 and rounded down for invalid input", async () => {
      // Defensive: treat 0, -1, 0.5 as 1 — same intent count as default.
      const r0 = await runSolverTrioDemo({ samples: 0 });
      const rNeg = await runSolverTrioDemo({ samples: -3 });
      const rFrac = await runSolverTrioDemo({ samples: 1.7 });
      for (const r of [r0, rNeg, rFrac]) {
        expect(r.results).toHaveLength(3);
        for (const s of r.gasHistogram.values()) {
          expect(s.count).toBe(1);
        }
      }
    });
  });

  it("produces the same commitment values across runs (deterministic dispatch + pricing)", async () => {
    // Intent IDs CANNOT be equal across runs — createSignedIntent
    // generates a fresh random nonce for replay prevention, and the
    // router's nonce store would reject a re-submitted identical
    // intent. But dispatch + pricing + commitment values ARE
    // deterministic: the registry picks the same solver per kind,
    // the stub venue quotes the same floor, transfer moves the same
    // amount, x402 settles to the same maxAmountRequired.
    const pinned = 1_700_000_000_000;
    const a = await runSolverTrioDemo({ now: () => pinned });
    const b = await runSolverTrioDemo({ now: () => pinned });
    expect(a.results.map((r) => r.solverId)).toEqual(
      b.results.map((r) => r.solverId),
    );
    expect(a.results.map((r) => r.fill!.quoteCommitment)).toEqual(
      b.results.map((r) => r.fill!.quoteCommitment),
    );
    expect(a.results.map((r) => r.fill!.actualAmount)).toEqual(
      b.results.map((r) => r.fill!.actualAmount),
    );
  });
});
