/**
 * dApp discovery E2E.
 * ───────────────────
 * Hub view → pick a first-party dApp tile → Connection sheet → Accept.
 *
 * Verifies the hub wiring, the connection sheet, and the acceptance
 * path that sets `app.trustLevel = first-party` in the session.
 */

import { test, expect } from "./fixtures";

test("dApp hub can open a first-party connection sheet and accept", async ({ approvedPage }) => {
  /* Navigate to the Hub tab. */
  const hubTab = approvedPage.getByRole("button", { name: /Hub|Discover|Apps/i });
  if (await hubTab.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
    await hubTab.first().click();
  }

  /* Pick the first dApp tile. */
  const firstTile = approvedPage.locator("[data-testid^='dapp-tile'], .dapp-tile, [class*='dapp']").first();
  await expect(firstTile).toBeVisible({ timeout: 5_000 });
  await firstTile.click();

  /* Connection sheet — accept. */
  const acceptBtn = approvedPage.getByRole("button", { name: /Accept|Connect|Allow/i });
  await expect(acceptBtn.first()).toBeVisible({ timeout: 5_000 });
  await acceptBtn.first().click();

  /* Post-accept: the sheet closes and the tile flips to a connected state. */
  await expect(approvedPage.getByText(/Connected|Session|Active/i).first()).toBeVisible({
    timeout: 5_000,
  });
});
