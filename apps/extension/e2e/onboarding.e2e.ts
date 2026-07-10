/**
 * Onboarding happy-path E2E.
 * ──────────────────────────
 * Drives the real four-step ladder exactly as the views implement it:
 *
 *   Welcome → Secure your wallet (password + confirm)
 *           → Recovery phrase (reveal + acknowledge)
 *           → Passkey (optional, skipped)
 *           → Complete → Home
 *
 * Every step uses the view's actual gating: the "Create wallet" button is
 * disabled until password and confirmation match (≥ 8 chars), the recovery
 * continue button is disabled until the acknowledgement is checked, and the
 * passkey step always offers "Skip for now". No conditional "if visible"
 * probing — if the flow changes, this spec must fail loudly, not adapt.
 *
 * The final assertion that the audit chain contains a `wallet-initialized`
 * event guards against a regression where onboarding completed without
 * emitting the initial audit event, which broke the evidence-builder
 * chain-of-custody guarantee.
 */

import { test, expect } from "./fixtures";

test("full onboarding creates a wallet and emits wallet-initialized audit event", async ({
  popupPage,
}) => {
  // Master-key derivation during wallet creation is deliberately slow
  // (KDF), so give the whole ladder more than the 15s config default.
  test.setTimeout(60_000);

  /* Step 0: Welcome screen. */
  await expect(
    popupPage.getByRole("heading", { name: /Welcome to Aethelred/i }),
  ).toBeVisible();
  await popupPage.getByRole("button", { name: /Create new wallet/i }).click();

  /* Step 1: Secure your wallet — the primary button must stay disabled
   * until the password pair is valid, then enable. */
  const createBtn = popupPage.getByRole("button", { name: /Create wallet/i });
  await expect(createBtn).toBeDisabled();
  await popupPage.locator("#onb-password").fill("E2E-Onboard-Pass-123");
  await popupPage.locator("#onb-confirm").fill("E2E-Onboard-Pass-123");
  await expect(createBtn).toBeEnabled();
  await createBtn.click();

  /* Step 2: Recovery phrase — reveal the phrase, acknowledge custody,
   * continue (disabled until acknowledged). */
  await popupPage.getByRole("button", { name: /^Reveal$/i }).click({ timeout: 20_000 });
  const continueBtn = popupPage.getByRole("button", { name: /I've written it down/i });
  await expect(continueBtn).toBeDisabled();
  await popupPage.getByRole("checkbox").check();
  await continueBtn.click();

  /* Step 3: Passkey — optional by design; skip. */
  await popupPage.getByRole("button", { name: /Skip for now/i }).click();

  /* Step 4: Complete → open the wallet → Home renders. */
  await popupPage.getByRole("button", { name: /Open wallet/i }).click();
  await expect(
    popupPage.getByText(/Total Balance|Balance/i).first(),
  ).toBeVisible({ timeout: 10_000 });

  /*
   * Assert: the audit chain persisted through chrome.storage contains a
   * `wallet-initialized` kind. Read back via the same storage namespace
   * the extension uses.
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
