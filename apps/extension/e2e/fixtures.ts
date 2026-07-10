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
      /*
       * `bypassCSP: true` disables Content-Security-Policy enforcement
       * **for this test context only**. It does NOT modify the shipped
       * extension manifest — production users still get the full
       * `script-src 'self'; object-src 'self'; …` lockdown declared in
       * `public/manifest.json`. The flag only changes Chromium's
       * internal behavior within this launched context, letting
       * Playwright's `page.addScriptTag` inject axe-core during a11y
       * audits without `script-src 'self'` rejecting inline content.
       *
       * Without this flag, every a11y-audit test fails with:
       *   `page.addScriptTag: Executing inline script violates the
       *    following Content Security Policy directive 'script-src 'self''`
       *
       * The CSP hardening is a genuine production security feature;
       * the test harness simply has devtools-level privileges that
       * let it coexist with strict CSP. See docs/testing/E2E.md and
       * the Playwright docs on `bypassCSP` for the broader rationale.
       */
      bypassCSP: true,
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
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    /*
     * Onboard through the REAL background pipeline instead of seeding
     * storage. The previous seed wrote an `aethelredState` object that no
     * code has ever read — the persistence layer stores a serialized
     * envelope under "aethelred-wallet-state" — so every spec built on the
     * seed booted to the Welcome view and rotted silently. `init-wallet`
     * runs the exact handler onboarding uses (master-key init, key
     * generation, workspace + subject registration, wallet-initialized
     * audit event, persistence) and leaves the session unlocked; the
     * reload then boots the popup against genuine post-onboarding state,
     * so fixture and product can no longer drift apart.
     */
    await page.evaluate(async () => {
      const chromeApi = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      await new Promise((resolve) =>
        chromeApi.runtime.sendMessage(
          { kind: "init-wallet", payload: { password: "E2E-Fixture-Pass-123", label: "e2e" } },
          resolve,
        ),
      );
    });
    await page.reload();
    await run(page);
    await page.close();
  },
});

export { expect } from "@playwright/test";
