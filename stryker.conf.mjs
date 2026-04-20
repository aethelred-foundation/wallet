/**
 * ═══════════════════════════════════════════════════════════════════════
 * Stryker mutation-testing configuration (repo root)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Mutation testing tells us whether our 822-test suite would actually
 * catch a regression. A passing unit test that asserts `toBeDefined()`
 * instead of the real invariant silently pads coverage; mutation
 * testing substitutes a boolean flip or off-by-one into the source and
 * re-runs the suite. If no test fails, the mutant survives — a gap in
 * our test oracle, not our line coverage.
 *
 * Targets: core business logic whose mis-mutation would silently erode
 * the wallet's safety guarantees (off-by-one in velocity caps, boolean
 * flips in policy evaluation, range-boundary tweaks in workflow
 * decisions). We deliberately skip React views — mutation testing UI
 * code is noisy because props changes rarely bubble to assertions.
 *
 * Thresholds:
 *   - break: 70 %  (below → CI fails the mutation workflow)
 *   - low:  75 %  (below → HTML report flags file as weak)
 *   - high: 85 %  (above → file marked strong)
 *
 * If the measured baseline on a file drops below 70 %, lower the break
 * threshold to `measured - 5` and open a follow-up ticket to restore
 * the target. Don't silently weaken the gate. Baseline captured in
 * `docs/testing/TEST_QUALITY.md`.
 *
 * Performance:
 *   - concurrency: 4            (parallelise across cores)
 *   - incremental: true         (cache unchanged mutants between runs)
 *   - timeoutMS: 60 000         (per-mutant ceiling — unit tests are fast,
 *                                but integration tests can spike)
 *   - coverageAnalysis: perTest (only rerun tests that touched the mutated line)
 *
 * Stryker is slow (every mutant is a full test run). It runs weekly in
 * CI (`.github/workflows/mutation.yml`), not on every PR.
 *
 * The `apps/extension/stryker.conf.mjs` mirror exists so that
 * `cd apps/extension && npx stryker run` works for developers who prefer
 * to work inside the extension workspace. Both configs must stay in sync.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  packageManager: "npm",
  testRunner: "vitest",
  mutator: {
    // TypeScript mutator — understands types and skips mutants that
    // would fail the compiler, which keeps the run fast on a strict
    // TS codebase.
    name: "typescript",
    excludedMutations: [],
  },
  reporters: ["progress", "clear-text", "html", "json"],
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  jsonReporter: {
    fileName: "reports/mutation/mutation-report.json",
  },
  coverageAnalysis: "perTest",
  timeoutMS: 60_000,
  concurrency: 4,
  incremental: true,
  incrementalFile: "reports/mutation/stryker-incremental.json",
  mutate: [
    // Audit — merkle batching + event capture guarantee the append-only
    // audit log. A flipped comparison here is catastrophic.
    "packages/audit/src/event-capture.ts",
    "packages/audit/src/merkle-batch.ts",
    // Policy — the rule engine decides whether a transaction is allowed.
    "packages/policy/src/engine.ts",
    "packages/policy/src/velocity-tracker.ts",
    // Approval — workflow decisions (approve vs require co-sign vs block).
    "packages/approval/src/workflow-engine.ts",
    // Core — transaction encoding + RLP serialisation (on-wire format).
    "packages/core/src/transaction.ts",
    "packages/core/src/rlp.ts",
    // Chain — pending-tx tracker drives the user-visible confirmation
    // state machine.
    "packages/chain/src/pending-tx-tracker.ts",
    // Credentials — any mutation here silently accepts forged attestations.
    "packages/credentials/src/verifier.ts",
    // Compliance — attestation verifier gates regulated flows.
    "packages/compliance/src/attestation-verifier.ts",
    // Exclude fixtures, types-only files, and the tests themselves —
    // nothing meaningful to mutate.
    "!**/*.test.ts",
    "!**/*.test.tsx",
    "!**/__fixtures__/**",
    "!**/types.ts",
    "!**/*.d.ts",
  ],
  thresholds: {
    high: 85,
    low: 75,
    break: 70,
  },
  vitest: {
    configFile: "apps/extension/vitest.config.mts",
  },
  disableTypeChecks: "{test,src,lib}/**/*.{js,ts,jsx,tsx,html,vue}",
};
