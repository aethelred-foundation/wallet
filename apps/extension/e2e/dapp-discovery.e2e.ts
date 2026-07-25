/**
 * dApp discovery E2E.
 * ───────────────────
 * Home → Hub tab → authoritative website-connection guidance → review the
 * connected-site session list.
 *
 * Production intentionally does not publish an unaudited, hard-coded dApp
 * catalog. Per-origin consent is raised by a dApp calling
 * `eth_requestAccounts` and is covered by zeroid-integration.e2e.ts.
 */

import { test, expect } from "./fixtures";

test("hub exposes the production dApp connection and session-review flow", async ({
  approvedPage,
}) => {
  test.setTimeout(60_000);

  /* Home → Hub tab (bottom nav). */
  await approvedPage.getByRole("tab", { name: /Hub/i }).click();

  await expect(
    approvedPage.getByRole("heading", { name: /Connect dApps from their websites/i }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(approvedPage.getByText("Cruzible")).toHaveCount(0);

  await approvedPage.getByRole("button", { name: /Review Connected Sites/i }).click();

  await expect(approvedPage.getByText(/Manage dApp sessions/i)).toBeVisible({
    timeout: 10_000,
  });
  await expect(approvedPage.getByText(/No connected apps/i)).toBeVisible();
});
