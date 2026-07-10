/**
 * Policy-enforcement E2E — pending a real product gap.
 * ────────────────────────────────────────────────────
 * This spec is marked `fixme`: it documents behavior the wallet does NOT
 * yet implement, so it must not run green.
 *
 * The gap (verified 2026-07-10): the popup send path (`handlePrepareTx`)
 * AND the dApp RPC path (`handleSendTransaction`) both call the policy
 * engine, but neither passes the spending context — `amountUsd`,
 * `destination`, `destinationCategory` are all left undefined. Every
 * value- and destination-based rule in the policy bundles
 * (packages/policy templates: spend-limit, velocity, unknown/blacklisted
 * destination) therefore never fires from any real send. On top of that,
 * `requiresReview` is derived from the `"approval-required"` outcome,
 * which the personal bundle never emits (its high-value rule is `warn`).
 * So there is currently no reachable spend-limit denial or review gate to
 * assert — the previous version of this spec seeded a `policyOverride`
 * storage key that no code reads and asserted a denial that cannot happen.
 *
 * The body below is the real test the feature should satisfy: an
 * over-limit send must surface a policy block on the review screen rather
 * than the plain confirm affordance. Un-`fixme` it when the send paths
 * feed spending context to `buildPolicyContext` and the review UI renders
 * the outcome. Tracked as a separate product task.
 *
 * Requires a local chain (WALLET_E2E_RPC), like send-flow.e2e.ts, because
 * the Review button is gated on a real balance.
 */

import { test, expect } from "./fixtures";

const RPC_URL = process.env.WALLET_E2E_RPC;

test.fixme(
  "policy engine blocks a send that exceeds the spend limit",
  async ({ approvedPage }) => {
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

    /* The review screen must present a policy block, not a clean confirm. */
    await expect(
      approvedPage.getByText(/(Denied|Blocked|Exceeds.*limit|Policy)/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  },
);
