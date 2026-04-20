/**
 * Stryker mutation-testing configuration.
 * ───────────────────────────────────────
 * Targets the ten most-critical files — the ones whose mis-mutations
 * (off-by-one, Boolean flips, range-boundary tweaks) would silently
 * degrade the wallet's safety guarantees.
 *
 * The threshold is 70% mutation-score: at least 70% of injected
 * mutants must be killed by the existing test suite. A lower bar
 * would let a single Boolean-flip mutant slip through; a higher bar
 * would block PRs on cosmetic mutants that are semantically
 * equivalent (e.g. `x > 0` vs `x >= 0` when x is always > 0).
 *
 * Runs via the vitest-runner so the mutants execute against the same
 * unit-test surface as `npm test` — no duplicate test scaffolding.
 *
 * Stryker is slow (every mutant is a full test run). We run it
 * weekly in CI (`.github/workflows/mutation.yml`), not on every PR.
 */

/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  packageManager: "npm",
  testRunner: "vitest",
  reporters: ["progress", "clear-text", "html", "json"],
  coverageAnalysis: "perTest",
  timeoutMS: 60_000,
  concurrency: 2,
  mutate: [
    "packages/audit/src/event-capture.ts",
    "packages/audit/src/merkle-batch.ts",
    "packages/policy/src/engine.ts",
    "packages/policy/src/velocity-tracker.ts",
    "packages/approval/src/workflow-engine.ts",
    "packages/core/src/transaction.ts",
    "packages/core/src/rlp.ts",
    "packages/chain/src/pending-tx-tracker.ts",
    "packages/credentials/src/verifier.ts",
    "packages/compliance/src/attestation-verifier.ts",
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
