import { defineConfig } from "vitest/config";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * Aethelred Wallet — Benchmark runner config
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Separated from the unit-test config (`apps/extension/vitest.config.mts`)
 * because benchmarks and unit tests want different defaults:
 *
 *   • Environment: unit tests need jsdom for React component work;
 *     benchmarks run pure library code and want Node's faster `node`
 *     environment so the measurement isn't dominated by jsdom setup.
 *
 *   • Globals: benchmarks use `bench`/`describe` from vitest — we leave
 *     globals on so the bench files read like the unit tests.
 *
 *   • Include pattern: only files under `packages/` * /bench matching the
 *     `.bench.ts` suffix. This keeps `vitest run` from picking benchmarks
 *     up as regular tests (they'd time out or fail because their throughput
 *     targets assume they aren't sharing a CPU with React render benches).
 *
 * Run with `npm run bench` from the repo root. Output is plain text on
 * CI; the `perf.yml` workflow additionally appends the summary to
 * `docs/perf/bench-history.jsonl` so we get a rolling baseline.
 * ═══════════════════════════════════════════════════════════════════════
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "packages/core/bench/**/*.bench.ts",
      "packages/audit/bench/**/*.bench.ts",
      "packages/policy/bench/**/*.bench.ts",
    ],
    benchmark: {
      // Benchmarks are inherently sensitive to neighbor workloads, so we
      // keep concurrency at 1 even when the overall vitest runner is
      // configured for parallelism elsewhere.
      reporters: ["default"],
    },
  },
});
