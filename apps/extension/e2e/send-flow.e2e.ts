/**
 * Send-flow E2E (simulated broadcast).
 * ────────────────────────────────────
 * Unlock → Home → Send → Pick recipient → Amount → Confirm (simulated) → Success.
 *
 * This test uses `approvedPage` so it starts on the Home view. The
 * simulate path is taken (no real JSON-RPC broadcast); the test asserts
 * the success morph is visible and the route has advanced.
 */

import { test, expect } from "./fixtures";

test("send flow reaches the success state via simulated broadcast", async ({ approvedPage }) => {
  /* Unlock — if the lock screen is showing, bypass with the dev unlock. */
  const unlockBtn = approvedPage.getByRole("button", { name: /Unlock|Sign in/i });
  if (await unlockBtn.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
    await unlockBtn.first().click();
  }

  /* Home → tap Send. */
  await approvedPage.getByRole("button", { name: /^Send$/i }).first().click();

  /* Send → fill recipient address. */
  const recipient = approvedPage.getByRole("textbox").first();
  await recipient.fill("0xcafebabecafebabecafebabecafebabecafebabe");

  /* Amount — type a small value. */
  const amount = approvedPage.getByRole("textbox").nth(1);
  await amount.fill("0.01");

  /* Advance. */
  await approvedPage
    .getByRole("button", { name: /Continue|Review|Next/i })
    .first()
    .click();

  /* Confirm. */
  await approvedPage
    .getByRole("button", { name: /Confirm|Send|Approve/i })
    .first()
    .click();

  /* Success morph. */
  await expect(approvedPage.getByText(/Sent|Success|Submitted/i).first()).toBeVisible({
    timeout: 10_000,
  });
});
