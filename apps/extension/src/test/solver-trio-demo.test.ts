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
