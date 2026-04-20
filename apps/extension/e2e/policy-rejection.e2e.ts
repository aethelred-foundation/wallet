/**
 * Policy-rejection E2E.
 * ─────────────────────
 * Sets a low spend-limit → attempts a send > limit → asserts the
 * approval surfaces a policy denial, not a plain "confirm" button.
 */

import { test, expect } from "./fixtures";

test("policy engine denies a tx that exceeds the configured spend limit", async ({
  approvedPage,
}) => {
  /* Seed a low spend-limit policy through storage. */
  await approvedPage.evaluate(async () => {
    (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.set({
      policyOverride: {
        spendLimitUsd: 100,
      },
    });
  });

  /* Trigger a tx that blows past the limit. */
  await approvedPage.getByRole("button", { name: /^Send$/i }).first().click();
  const recipient = approvedPage.getByRole("textbox").first();
  await recipient.fill("0xcafebabecafebabecafebabecafebabecafebabe");
  const amount = approvedPage.getByRole("textbox").nth(1);
  await amount.fill("999999");

  await approvedPage
    .getByRole("button", { name: /Continue|Review|Next/i })
    .first()
    .click();

  /* Expect the policy denial affordance — wording varies but must not
   * be the happy-path Confirm button. */
  await expect(
    approvedPage.getByText(/(Denied|Blocked|Exceeds.*limit|Policy.*deny)/i).first()
  ).toBeVisible({ timeout: 5_000 });
});
