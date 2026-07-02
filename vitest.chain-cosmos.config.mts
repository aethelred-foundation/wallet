import { defineConfig } from "vitest/config";

/**
 * Package-scoped coverage gate for `@aethelred/wallet-chain-cosmos`.
 *
 * Why a root-level config (precedent: `vitest.bench.config.mts`): the
 * extension's vitest config can only v8-instrument files under
 * `apps/extension`, so its parent-relative ("../../packages/…") coverage
 * include never actually matches workspace-package sources — package files
 * outside the app root are silently absent from its report. Running from
 * the workspace root puts `packages/chain-cosmos/src` inside the coverage
 * root, making the numbers real.
 *
 * The native tx path is consensus-facing wallet code (it produces bytes the
 * chain's ante handler verifies), so it carries a hard 100% floor on every
 * metric — the same bar as the chain repo's seal/precompile packages.
 *
 * Run: `pnpm test:chain-cosmos`
 */
export default defineConfig({
  test: {
    include: ["apps/extension/src/test/chain-cosmos.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["packages/chain-cosmos/src/**/*.ts"],
      reporter: ["text"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
