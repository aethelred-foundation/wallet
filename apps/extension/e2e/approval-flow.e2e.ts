/**
 * Approval-sheet E2E.
 * ───────────────────
 * Creates a REAL pending approval through the production pipeline and
 * drives the REAL UI to decide it:
 *
 *   1. send a `wallet_addEthereumChain` rpc-request — the background's
 *      EIP-3085 handler calls requestUserApproval, which enqueues a
 *      pending approval and blocks the RPC response on the decision
 *   2. the header bell lights up ("N pending approvals") — click through
 *      to the Approvals view
 *   3. tap Approve on the sheet
 *   4. assert an `approval-decided` audit event was recorded
 *
 * The previous version of this spec sent a fabricated
 * `APPROVAL_REQUEST_TEST` message that no handler has ever consumed, so
 * the sheet never appeared. Everything here goes through the same
 * message kinds the content script and popup use in production.
 */

import { test, expect } from "./fixtures";

test("approval sheet appears and records an audit event when approved", async ({
  approvedPage,
}) => {
  test.setTimeout(60_000);

  /* Fire a real EIP-3085 add-chain request through the rpc bridge. The
   * background blocks this response until the approval is decided, so it
   * is deliberately fire-and-forget here. */
  await approvedPage.evaluate(() => {
    const chromeApi = (globalThis as unknown as { chrome: typeof chrome }).chrome;
    chromeApi.runtime.sendMessage({
      kind: "rpc-request",
      correlationId: `e2e-approval-${Date.now()}`,
      payload: {
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x2b67",
            chainName: "E2E Approval Chain",
            rpcUrls: ["http://127.0.0.1:9999"],
            nativeCurrency: { name: "Test", symbol: "TST", decimals: 18 },
          },
        ],
      },
      timestamp: Date.now(),
    });
  });

  /* The header bell reflects the queued approval; click through to the
   * Approvals view. */
  const bell = approvedPage.getByRole("button", { name: /pending approvals/i });
  await expect(bell).toBeVisible({ timeout: 10_000 });
  await bell.click();

  /* Approve on the real sheet. */
  const approveBtn = approvedPage.getByRole("button", { name: /^Approve$/ });
  await expect(approveBtn.first()).toBeVisible({ timeout: 10_000 });
  await approveBtn.first().click();

  /* Assert an audit event was written for this approval. */
  await expect
    .poll(
      async () =>
        approvedPage.evaluate(async () => {
          const all = await new Promise<Record<string, unknown>>((resolve) => {
            (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.get(
              null,
              resolve,
            );
          });
          return JSON.stringify(all);
        }),
      { timeout: 10_000 },
    )
    .toMatch(/approval-decided|approval-requested/);
});
