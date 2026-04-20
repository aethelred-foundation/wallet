/**
 * Shared fixtures for Aethelred Wallet Playwright E2E tests.
 * ───────────────────────────────────────────────────────────
 *
 * Three fixtures are exposed:
 *
 *   - `context`       — a `BrowserContext` launched with the built
 *                        extension loaded as an unpacked MV3 extension.
 *   - `extensionId`   — the auto-discovered extension ID, found by
 *                        inspecting the background service worker URL.
 *   - `popupPage`     — a `Page` opened directly at `chrome-extension://<id>/popup.html`.
 *   - `approvedPage`  — like `popupPage`, but with a pre-onboarded
 *                        wallet state seeded into chrome.storage before
 *                        the popup renders. Tests that start past
 *                        onboarding (Home, Send, Approvals) should use
 *                        this fixture.
 *
 * The fixture wiring uses `chromium.launchPersistentContext` which is
 * Playwright's only supported entry point for MV3 extensions — MV3
 * service workers don't spin up in an ephemeral context.
 */

import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

const extensionPath = path.resolve(__dirname, "..", "dist");

interface WalletFixtures {
  context: BrowserContext;
  extensionId: string;
  popupPage: Page;
  approvedPage: Page;
}

/**
 * Base Playwright fixtures extended with wallet-specific helpers.
 */
export const test = base.extend<WalletFixtures>({
  context: async ({}, run) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aethelred-e2e-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: Boolean(process.env.CI),
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    await run(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  extensionId: async ({ context }, run) => {
    /*
     * MV3 background service worker URL looks like:
     *   chrome-extension://<32-char-id>/background.js
     * We wait for it to register then extract the id.
     */
    let [worker] = context.serviceWorkers();
    if (!worker) {
      worker = await context.waitForEvent("serviceworker");
    }
    const url = worker.url();
    const match = url.match(/chrome-extension:\/\/([^/]+)\//);
    if (!match) throw new Error(`Could not parse extension id from ${url}`);
    await run(match[1]);
  },

  popupPage: async ({ context, extensionId }, run) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await run(page);
    await page.close();
  },

  approvedPage: async ({ context, extensionId }, run) => {
    const page = await context.newPage();
    /*
     * Seed chrome.storage.local with a minimal onboarded state BEFORE
     * popup.html renders, so the router lands on Home directly instead
     * of the Welcome view. `addInitScript` runs before any of the
     * extension's own scripts. We seed:
     *   - onboardingComplete: true
     *   - passkeyEnrolled: true
     *   - sessionUnlocked: true
     * Exact shape matches StatePersistence.load().
     */
    await page.addInitScript(() => {
      (globalThis as unknown as { chrome?: typeof chrome }).chrome?.storage?.local?.set({
        aethelredState: {
          onboardingComplete: true,
          passkeyEnrolled: true,
          sessionUnlocked: true,
          activeWorkspace: "personal",
          activeAccount: "acc-test-0",
          theme: "dark",
        },
      });
    });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await run(page);
    await page.close();
  },
});

export { expect } from "@playwright/test";
