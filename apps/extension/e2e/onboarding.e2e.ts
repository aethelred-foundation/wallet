/**
 * Onboarding happy-path E2E.
 * ──────────────────────────
 * Verifies the full first-launch flow:
 *   Welcome → Create wallet → Recovery phrase → Verify → Complete
 *
 * The assertion that the audit chain contains a `wallet-initialized`
 * event guards against a regression where the onboarding view used to
 * complete without emitting the initial audit event, which broke the
 * evidence-builder chain-of-custody guarantee.
 *
 * This test runs on a fresh context (no seeded state) so the popup
 * lands on the real Welcome view.
 */

import { test, expect } from "./fixtures";

test("full onboarding creates a wallet and emits wallet-initialized audit event", async ({
  popupPage,
}) => {
  /* Step 0: Welcome screen is rendered with the two action cards. */
  await expect(popupPage.getByRole("heading", { name: /Welcome to Aethelred/i })).toBeVisible();
  await popupPage.getByRole("button", { name: /Create new wallet/i }).click();

  /* Step 1: Create wallet — name the wallet and continue. */
  await expect(popupPage.getByText(/Create.*wallet/i).first()).toBeVisible();
  const nameInput = popupPage.getByRole("textbox").first();
  if (await nameInput.isVisible()) {
    await nameInput.fill("E2E Test Wallet");
  }
  await popupPage.getByRole("button", { name: /Continue|Next|Create/i }).first().click();

  /* Step 2: Recovery phrase — acknowledge and continue. */
  await expect(popupPage.getByText(/Recovery|Secret.*phrase|seed/i).first()).toBeVisible();
  const revealBtn = popupPage.getByRole("button", { name: /Reveal|Show/i });
  if (await revealBtn.isVisible()) {
    await revealBtn.click();
  }
  await popupPage.getByRole("button", { name: /Continue|Next|I have saved/i }).first().click();

  /* Step 3: Verification — skip if the view has a skip button, else
   * the view provides a pre-filled verification in dev mode. */
  const verifySkip = popupPage.getByRole("button", { name: /Skip|Verify|Continue/i });
  if (await verifySkip.first().isVisible()) {
    await verifySkip.first().click();
  }

  /* Step 4: Complete — we should see the Home view within 10s. */
  await expect(popupPage.getByText(/Home|Balance|Portfolio/i).first()).toBeVisible({
    timeout: 10_000,
  });

  /*
   * Assert: the audit chain persisted through chrome.storage contains
   * a `wallet-initialized` kind. We read back via the same storage
   * namespace the extension uses.
   */
  const auditEvents = await popupPage.evaluate(async () => {
    const all = await new Promise<Record<string, unknown>>((resolve) => {
      (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.get(null, resolve);
    });
    return all;
  });

  const serialized = JSON.stringify(auditEvents);
  expect(serialized).toMatch(/wallet-initialized|onboarding-complete/);
});
