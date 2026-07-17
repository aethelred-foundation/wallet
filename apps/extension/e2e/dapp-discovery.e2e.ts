/**
 * dApp discovery E2E.
 * ───────────────────
 * Home → Hub tab → first-party dApp tiles → open the app catalog.
 *
 * Verifies the hub's dApp registry renders the first-party protocols and
 * that a tile navigates into the catalog, which lists the same protocol.
 *
 * The previous version of this spec looked for `.dapp-tile` elements and a
 * "connection sheet" with an Accept button. Neither has ever existed in the
 * hub: tiles carry `.hub-card`, and clicking one navigates to the app
 * catalog. Per-origin connection CONSENT is a different surface entirely —
 * it is raised by a dApp calling `eth_requestAccounts`, and it is covered
 * end-to-end by zeroid-integration.e2e.ts (the "connect" approval).
 */

import { test, expect } from "./fixtures";

test("hub lists first-party dApps and a tile opens the app catalog", async ({
  approvedPage,
}) => {
  test.setTimeout(60_000);

  /* Home → Hub tab (bottom nav). */
  await approvedPage.getByRole("tab", { name: /Hub/i }).click();

  /* The hub's dApps sub-tab is the default; Cruzible is the featured
   * first-party protocol and is the only one marked Live. */
  const cruzible = approvedPage.getByText("Cruzible").first();
  await expect(cruzible).toBeVisible({ timeout: 10_000 });

  /* A tile navigates into the catalog. */
  await cruzible.click();

  /* Catalog view renders and still carries the protocol. */
  await expect(approvedPage.getByText("Cruzible").first()).toBeVisible({
    timeout: 10_000,
  });
});
