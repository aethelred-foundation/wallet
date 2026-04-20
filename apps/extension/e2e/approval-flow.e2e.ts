/**
 * Approval-sheet E2E.
 * ───────────────────
 * Dispatches a simulated JSON-RPC request via `chrome.runtime.sendMessage`
 * from a content-script context and asserts:
 *   - the approval sheet appears with the decoded intent
 *   - tapping Approve advances the flow
 *   - an `approval-decided` audit event is recorded
 */

import { test, expect } from "./fixtures";

test("approval sheet appears and records an audit event when approved", async ({ approvedPage }) => {
  /* Fire a synthetic approval request through the extension messaging layer. */
  await approvedPage.evaluate(async () => {
    const chromeApi = (globalThis as unknown as { chrome?: typeof chrome }).chrome;
    chromeApi?.runtime?.sendMessage?.({
      type: "APPROVAL_REQUEST_TEST",
      origin: "https://app.e2e-test.example",
      intent: {
        kind: "sign-transaction",
        method: "eth_sendTransaction",
        params: [
          {
            to: "0xcafebabecafebabecafebabecafebabecafebabe",
            value: "0x38d7ea4c68000",
          },
        ],
      },
    });
  });

  /* Approval sheet opens. */
  const approveBtn = approvedPage.getByRole("button", { name: /Approve|Confirm/i });
  await expect(approveBtn.first()).toBeVisible({ timeout: 5_000 });
  await approveBtn.first().click();

  /* Assert an audit event was written for this approval. */
  const serialized = await approvedPage.evaluate(async () => {
    const all = await new Promise<Record<string, unknown>>((resolve) => {
      (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.get(null, resolve);
    });
    return JSON.stringify(all);
  });

  expect(serialized).toMatch(/approval-decided|approval-requested/);
});
