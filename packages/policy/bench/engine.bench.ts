/**
 * ═══════════════════════════════════════════════════════════════════════
 * Policy engine micro-benchmarks — @aethelred/wallet-policy
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The policy engine evaluates every signing intent before it reaches the
 * custody backend. A slow engine directly translates to a slow approval
 * screen, so the budget is tight: the 20-rule personal bundle must
 * evaluate well under 100 µs in the typical case.
 *
 * Four benchmarks:
 *
 *   1. Plain `allow` (rule matches on the first pass) — canonical fast path
 *   2. Warn (late-priority match) — common case for transfers
 *   3. Deny (short-circuit) — defensive rule firing
 *   4. Approval-required (multi-rule collection) — enterprise heavy case
 *
 * Each bench runs the real personalPolicyBundle (20 rules) so regressions
 * in rule count, rule evaluator, or condition matcher are caught. We don't
 * use a custom bundle here because the whole point of benchmarking is to
 * protect the shipping policy templates.
 *
 * Owner: wallet-policy team. See docs/perf/SLO.md §3.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { bench, describe } from "vitest";
import { evaluate } from "../src/engine";
import { personalPolicyBundle } from "../src/templates";
import type { PolicyContext } from "../src/types";

/* ─── Fixtures ────────────────────────────────────────────────────── */

function baseContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    subject: { id: "subj-bench", role: "owner" },
    workspace: { id: "ws-bench", kind: "personal" },
    app: {
      id: "app-bench",
      origin: "https://example.test",
      trustLevel: "first-party",
    },
    intent: {
      kind: "sign-transaction",
      method: "eth_sendTransaction",
    },
    session: {
      exists: true,
      id: "sess-bench",
    },
    account: {
      id: "acct-bench",
      address: "0xcofffee254729296a45a3885639ac7e10f9d54979",
      namespace: "eip155",
    },
    chainId: "eip155:1",
    destination: "0xc0ffee254729296a45a3885639ac7e10f9d54979",
    destinationCategory: "known-contact",
    amount: 1_000_000_000_000_000,
    amountUsd: 5,
    assetId: "eip155:1/slip44:60",
    assetSymbol: "ETH",
    assetCategory: "native",
    requestedOperationCount24h: 3,
    cumulativeValueSpentUsd24h: 120,
    sessionAgeMs: 60_000,
    ...overrides,
  };
}

/** First-party connect — should hit the auto-allow rule first. */
const CTX_ALLOW: PolicyContext = baseContext({
  intent: { kind: "connect", method: "eth_requestAccounts" },
  app: {
    id: "app-first-party",
    origin: "https://first.aethelred.test",
    trustLevel: "first-party",
  },
});

/** Normal small transfer — triggers the generic "warn on all transactions" rule. */
const CTX_WARN: PolicyContext = baseContext();

/** Blacklisted destination — fires the deny rule (if present in bundle). */
const CTX_DENY: PolicyContext = baseContext({
  destinationCategory: "blacklisted",
});

/** Large USD transfer — triggers the 10k spend-per-tx warning + any 24h rules. */
const CTX_APPROVAL: PolicyContext = baseContext({
  amountUsd: 75_000,
  cumulativeValueSpentUsd24h: 60_000,
});

/* ─── Benchmarks ──────────────────────────────────────────────────── */

describe("@aethelred/wallet-policy evaluate", () => {
  /**
   * Target: > 10k evals / sec  (≤ 100 µs) on the 20-rule personal bundle
   * Fail:    < 2k evals / sec  (> 500 µs)
   *
   * This is the baseline "happy path" the engine pays on every approval.
   * Slow regressions here are visible as popup lag during dApp connection.
   */
  bench(
    "evaluate allow path (target ≥ 10k ops/s)",
    () => {
      evaluate(CTX_ALLOW, personalPolicyBundle);
    },
    { time: 1000 },
  );

  /**
   * Target: > 10k evals / sec
   * Fail:    < 2k evals / sec
   *
   * Walk-through-all-rules warn case — the engine doesn't short-circuit,
   * so every condition is exercised. Protects against an accidental
   * worst-case-n² rule matcher.
   */
  bench(
    "evaluate warn path (target ≥ 10k ops/s)",
    () => {
      evaluate(CTX_WARN, personalPolicyBundle);
    },
    { time: 1000 },
  );

  /**
   * Target: > 15k evals / sec (deny short-circuits, so ~faster)
   * Fail:    < 3k evals / sec
   *
   * Deny outcomes stop rule evaluation early. If this bench is only
   * marginally faster than the warn one, the deny short-circuit is broken.
   */
  bench(
    "evaluate deny path (target ≥ 15k ops/s)",
    () => {
      evaluate(CTX_DENY, personalPolicyBundle);
    },
    { time: 1000 },
  );

  /**
   * Target: > 8k evals / sec
   * Fail:    < 1.5k evals / sec
   *
   * Approval-required case collects the most-restrictive approval across
   * all matching rules — this is a multi-allocate path (approvalDetails
   * gets set several times). The cost here is representative of the
   * enterprise workspace flow.
   */
  bench(
    "evaluate approval-required path (target ≥ 8k ops/s)",
    () => {
      evaluate(CTX_APPROVAL, personalPolicyBundle);
    },
    { time: 1000 },
  );

  /**
   * Target: > 5k evals / sec across 100 random contexts
   * Fail:    < 1k evals / sec
   *
   * Mixed-workload sanity check that exercises all four paths in sequence.
   * Prevents a bench that looks green individually but regresses once
   * real traffic mixes branches (branch predictor / inline cache effects).
   */
  const mixedContexts: PolicyContext[] = [];
  for (let i = 0; i < 100; i++) {
    const picks: PolicyContext[] = [CTX_ALLOW, CTX_WARN, CTX_DENY, CTX_APPROVAL];
    mixedContexts.push(picks[i % picks.length]);
  }
  bench(
    "evaluate mixed workload (target ≥ 5k ops/s)",
    () => {
      for (const ctx of mixedContexts) {
        evaluate(ctx, personalPolicyBundle);
      }
    },
    { time: 1000 },
  );
});
