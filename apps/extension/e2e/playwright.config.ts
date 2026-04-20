/**
 * Playwright configuration for Aethelred Wallet E2E tests.
 * ──────────────────────────────────────────────────────────
 *
 * Loads the built Chrome extension from `apps/extension/dist` as an
 * unpacked extension so tests exercise the real manifest, content
 * scripts, background service worker, and popup HTML. No "test build"
 * or "test harness" layer — what runs in CI is exactly what ships.
 *
 * Headed locally (CI env variable unset), headless in CI. Each test
 * runs in a persistent browser context so chrome.storage can be seeded
 * via the `approvedPage` fixture without races.
 *
 * Why `chromium` channel only: the wallet ships as a Chrome extension
 * first. Firefox WebExtensions and Safari Web Extensions will come in
 * later phases; we'll add matrix channels then.
 */

import { defineConfig, devices } from "@playwright/test";
import * as path from "node:path";

const extensionPath = path.resolve(__dirname, "..", "dist");
const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.e2e\.ts$/,
  /* Max per-test wall-clock. Keeps flakes from hanging the job. */
  timeout: 15_000,
  /* Fail the whole run if a test runs longer than 2× timeout. */
  globalTimeout: 15 * 60_000,
  /* Hard-fail on `test.only` committed to main. */
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  /* Deterministic worker count — extension contexts are heavyweight. */
  workers: isCi ? 2 : 1,
  reporter: isCi
    ? [["github"], ["html", { open: "never" }], ["json", { outputFile: "e2e-results.json" }]]
    : [["list"]],
  use: {
    /* Extension tests always run in the context created by the fixture. */
    headless: isCi,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chrome-extension",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        launchOptions: {
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
            "--no-first-run",
            "--no-default-browser-check",
          ],
        },
      },
    },
  ],
});
