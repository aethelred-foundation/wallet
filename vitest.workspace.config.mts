import { defineWorkspace } from "vitest/config";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * Aethelred Wallet — Vitest workspace configuration
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The monorepo currently runs all unit + integration tests from the
 * extension workspace (`apps/extension`). Shared library code under
 * `packages/*` is exercised indirectly via the extension's test
 * surface — we deliberately avoid duplicating a parallel test suite
 * inside every package because the packages are consumed exclusively
 * by the extension today.
 *
 * One entry per project config. Run with:
 *
 *     npx vitest run --coverage --workspace vitest.workspace.config.mts
 *
 * As packages grow their own dedicated test suites (benchmarks already
 * live under `packages/*\/bench`, measured via `vitest.bench.config.mts`),
 * drop the package's own `vitest.config.mts` into place and add it to
 * the array below.
 * ═══════════════════════════════════════════════════════════════════════
 */
export default defineWorkspace([
  "./apps/extension/vitest.config.mts",
]);
