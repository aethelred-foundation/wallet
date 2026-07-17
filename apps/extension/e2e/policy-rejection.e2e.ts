/**
 * Policy-enforcement E2E.
 * ───────────────────────
 * Verifies that the send path feeds real spending context (value,
 * destination, 24h velocity) into the policy engine and that the review
 * screen presents the verdict before the user can confirm.
 *
 * What this asserts, honestly: the extension under test is a PRODUCTION
 * build, and AETHEL has no market price — production pricing fails
 * closed, so value-based rules cannot fire on invented numbers. The
 * enforcement contract for that case is an EXPLICIT policy notice on the
 * review screen ("could not be priced … value-based policy checks did
 * not run") — transparency instead of silent non-enforcement. The
 * priced path (spend-limit, unknown-destination, velocity rules firing
 * through the real engine) is pinned by src/test/spending-context.test.ts.
 *
 * History: until 2026-07-10 the send paths passed NO spending context, so
 * every value/destination/velocity rule in the bundles was dead code, and
 * an earlier version of this spec seeded a `policyOverride` storage key
 * that nothing read. This spec asserts the wiring that closed that gap.
 *
 * Requires a local chain (WALLET_E2E_RPC), like send-flow.e2e.ts, because
 * the Review button is gated on a real balance.
 */

import { test, expect } from "./fixtures";

const RPC_URL = process.env.WALLET_E2E_RPC;

test("the review screen surfaces the policy verdict for an over-limit send", async ({
  approvedPage,
}) => {
  test.skip(!RPC_URL, "set WALLET_E2E_RPC to a funded local chain (anvil)");
  test.setTimeout(60_000);

  async function rpc(method: string, params: unknown[]): Promise<string> {
    const res = await fetch(RPC_URL as string, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const json = (await res.json()) as { result?: string; error?: { message: string } };
    if (json.error) throw new Error(`${method}: ${json.error.message}`);
    return json.result as string;
  }

  await approvedPage.evaluate(async (rpcUrl) => {
    const chromeApi = (globalThis as unknown as { chrome: typeof chrome }).chrome;
    await new Promise((resolve) =>
      chromeApi.runtime.sendMessage(
        { kind: "update-network-rpc", payload: { chainId: "0x1ca4", rpcUrl } },
        resolve,
      ),
    );
  }, RPC_URL);

  const state = await approvedPage.evaluate(async () => {
    const chromeApi = (globalThis as unknown as { chrome: typeof chrome }).chrome;
    return await new Promise<any>((resolve) =>
      chromeApi.runtime.sendMessage({ kind: "get-state" }, resolve),
    );
  });
  const from: string =
    state?.payload?.result?.accounts?.[0]?.address ?? state?.result?.accounts?.[0]?.address;
  // Fund well past any sane spend limit.
  await rpc("anvil_setBalance", [from, "0x152d02c7e14af6800000"]); // 100k AETHEL
  await approvedPage.reload();

  await approvedPage.getByRole("button", { name: /^Send$/ }).first().click();
  await approvedPage.locator("#to").fill("0xcafebabecafebabecafebabecafebabecafebabe");
  await approvedPage.locator("#amount").fill("99999");
  await approvedPage.getByRole("button", { name: /Review transaction/i }).click();

  /* The review screen must present the policy verdict, not a clean
   * confirm. On this unpriced chain the deterministic verdict is the
   * explicit unpriced-value notice inside the Policy banner. */
  const banner = approvedPage.getByRole("note", { name: /Policy notices/i });
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText(/could not be priced/i);
  await expect(banner).toContainText(/value-based policy checks did not run/i);

  /* Confirm stays available — the personal bundle warns rather than
   * hard-blocks — but the decision is now made with the verdict in view. */
  await expect(
    approvedPage.getByRole("button", { name: /Confirm & sign/i }),
  ).toBeVisible();
});
