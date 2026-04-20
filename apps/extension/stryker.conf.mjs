/**
 * ═══════════════════════════════════════════════════════════════════════
 * Stryker mutation-testing configuration (apps/extension mirror)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Thin wrapper around the root-level Stryker config. The only
 * difference is that `mutate` paths are rewritten relative to this
 * workspace so `cd apps/extension && npx stryker run` works for
 * developers who prefer to drive the suite from inside the extension
 * workspace.
 *
 * When changing thresholds, target files, or performance knobs, edit
 * the root `/stryker.conf.mjs` — the cross-reference below mirrors it
 * mechanically. The CI pipeline (`.github/workflows/mutation.yml`)
 * runs the root config, so that is the source of truth; this file is
 * a developer convenience only.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  packageManager: "npm",
  testRunner: "vitest",
  mutator: {
    name: "typescript",
    excludedMutations: [],
  },
  reporters: ["progress", "clear-text", "html", "json"],
  htmlReporter: {
    fileName: "../../reports/mutation/index.html",
  },
  jsonReporter: {
    fileName: "../../reports/mutation/mutation-report.json",
  },
  coverageAnalysis: "perTest",
  timeoutMS: 60_000,
  concurrency: 4,
  incremental: true,
  incrementalFile: "../../reports/mutation/stryker-incremental.json",
  mutate: [
    "../../packages/audit/src/event-capture.ts",
    "../../packages/audit/src/merkle-batch.ts",
    "../../packages/policy/src/engine.ts",
    "../../packages/policy/src/velocity-tracker.ts",
    "../../packages/approval/src/workflow-engine.ts",
    "../../packages/core/src/transaction.ts",
    "../../packages/core/src/rlp.ts",
    "../../packages/chain/src/pending-tx-tracker.ts",
    "../../packages/credentials/src/verifier.ts",
    "../../packages/compliance/src/attestation-verifier.ts",
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
    configFile: "./vitest.config.mts",
  },
  disableTypeChecks: "{test,src,lib}/**/*.{js,ts,jsx,tsx,html,vue}",
};
