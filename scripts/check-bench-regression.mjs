#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * check-bench-regression.mjs — stub regression detector
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Status: STUB. This script is intentionally not wired into CI yet.
 *
 * Why a stub now
 * --------------
 * Regression detection needs a rolling baseline to compare against.
 * On day one we have ZERO history, so any real check would either:
 *   - always pass (baseline = current run → no delta), or
 *   - always fail if the first run was abnormally fast.
 *
 * The right design is to gate on a 7-day p50 once enough data exists.
 * We're shipping the data-collection path today (`append-bench-history.mjs`
 * writes to `docs/perf/bench-history.jsonl` on every push to main), and
 * this script stays as an unwired stub until the history has at least
 * one week of records.
 *
 * When to enable
 * --------------
 * After `docs/perf/bench-history.jsonl` has ≥ 7 days of records (1 push
 * per day → ≥ 7 records in the file), flip the feature flag at the top
 * of this file and add a call in `.github/workflows/perf.yml` between
 * the "Run vitest bench" and "Append to rolling history" steps.
 *
 * Algorithm (when enabled)
 * ------------------------
 *   1. Load `docs/perf/bench-history.jsonl`.
 *   2. Filter records where `ts` is within the last 7 * 24 * 3600 * 1000 ms.
 *   3. For each `{file, name}` pair, compute p50 of `hz` over that window.
 *   4. Compare the latest run's `hz` to the p50.
 *   5. Fail if `latest.hz < p50 * 0.8` — that's a >20% throughput drop.
 *
 * Owner: wallet-perf team. See docs/perf/BENCHMARKING.md §4.
 * ═══════════════════════════════════════════════════════════════════════
 */

const ENABLED = false;

if (!ENABLED) {
  console.log(
    "check-bench-regression: stub mode — regression gate is not yet active.",
  );
  console.log(
    "Flip ENABLED=true after ≥7 days of bench-history.jsonl records exist.",
  );
  process.exit(0);
}

// Placeholder: real implementation lives here once enabled.
console.error("check-bench-regression: real implementation not yet shipped.");
process.exit(1);
