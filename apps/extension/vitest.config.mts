import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * Aethelred Wallet Extension — Vitest configuration
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The extension workspace hosts the entire 822-test unit + integration
 * suite. This config also owns coverage enforcement for the whole
 * monorepo because every workspace package compiles into the extension
 * bundle and is exercised by these tests (the extension is our
 * top-of-tree entry point).
 *
 * Coverage thresholds
 * ───────────────────
 * Set slightly below the measured baseline on 2026-04-20 so CI starts
 * green. Long-term targets: lines / statements / functions ≥ 85 %,
 * branches ≥ 75 %. See docs/testing/TEST_QUALITY.md for the ratchet
 * policy.
 *
 * Exclusions
 * ──────────
 * - `src/popup/views/**` — view skeletons are UI composition, covered
 *   by a11y + integration suites rather than line coverage.
 * - `src/popup/components/{header,nav-bar,…}.tsx` — UI chrome whose
 *   logic surface is already covered by the screens that render them.
 * - `src/options/**` — minimal options-page shell.
 * - `src/{background,content,content-bridge,inpage}.ts` — run inside
 *   Chrome, not Node/jsdom, so lines cannot be covered here.
 * - Generated files, test scaffolding, and `src/services/walletconnect-manager.ts`
 *   (exercised end-to-end by the e2e + integration suites).
 *
 * Reporters: text-summary (console), html (drill-down), json-summary
 * (consumed by `scripts/coverage-audit.mjs`).
 * ═══════════════════════════════════════════════════════════════════════
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "./coverage",
      // Still emit the report even when some tests fail. Otherwise
      // the audit script can't see the numbers and CI debugging drops
      // a level of detail every time a flaky test blocks the run.
      reportOnFailure: true,
      include: [
        "src/**/*.ts",
        "src/**/*.tsx",
        "../../packages/*/src/**/*.ts",
      ],
      exclude: [
        "node_modules/**",
        "dist/**",
        "coverage/**",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.d.ts",
        "src/test/**",
        // View skeletons — pure UI composition, tested via a11y +
        // integration harnesses rather than line coverage.
        "src/popup/views/**",
        "src/popup/App.tsx",
        "src/popup/main.tsx",
        "src/popup/router.tsx",
        // Non-interactive UI chrome whose logic surface is already
        // covered by the screens that render them.
        "src/popup/components/header.tsx",
        "src/popup/components/nav-bar.tsx",
        "src/popup/components/profile-menu.tsx",
        "src/popup/components/command-palette.tsx",
        "src/popup/components/confirm-modal.tsx",
        "src/popup/components/error-boundary.tsx",
        "src/popup/components/loading.tsx",
        "src/popup/components/page-transition.tsx",
        "src/popup/components/hero-transition.tsx",
        "src/popup/components/gradient-mesh-bg.tsx",
        "src/popup/components/live-sparkline.tsx",
        "src/popup/components/sparkline.tsx",
        "src/popup/components/qr-code.tsx",
        "src/popup/components/tooltip.tsx",
        "src/popup/components/segmented-control.tsx",
        "src/popup/components/animated-icon.tsx",
        "src/popup/components/dapp-logo.tsx",
        "src/popup/components/token-logo.tsx",
        "src/popup/components/stories/**",
        "src/popup/components/micro/**",
        "src/popup/hooks/use-keyboard-shortcuts.ts",
        "src/popup/hooks/use-scroll-timeline.ts",
        "src/popup/i18n/i18n-provider.tsx",
        "src/popup/constants/version.ts",
        // Minimal options-page shell.
        "src/options/**",
        // Chrome extension entry points — run in the extension
        // runtime, not in Node/jsdom.
        "src/background.ts",
        "src/content.ts",
        "src/content-bridge.ts",
        "src/inpage.ts",
        // WalletConnect session coordinator — e2e coverage.
        "src/services/walletconnect-manager.ts",
        "**/__generated__/**",
        "**/types.ts",
      ],
      // Thresholds sit ~2 pp below the measured baseline on 2026-04-20
      // (lines 87.54 %, statements 87.54 %, branches 72.06 %, functions
      // 79.72 % — with 3 known-flaky tests fenced off; see TEST_QUALITY.md).
      // CI starts green while every PR must meet this floor. Long-term
      // targets live in docs/testing/TEST_QUALITY.md; ratchet policy
      // is that thresholds may only go up, never down.
      thresholds: {
        lines: 85,
        branches: 70,
        functions: 77,
        statements: 85,
      },
    },
  },
});
