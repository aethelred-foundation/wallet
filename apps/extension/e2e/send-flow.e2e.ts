/**
 * Send-flow E2E (real broadcast against a local chain).
 * ─────────────────────────────────────────────────────
 * Home → Send → recipient + amount → Review transaction → Confirm & sign
 * → "Transaction submitted", and the recipient's on-chain balance moves.
 *
 * This spec CANNOT run without a chain. The Send view gates "Review
 * transaction" on `canReview`, which requires a real positive token balance
 * and (in a production build) a real gas estimate; "Confirm & sign" then
 * calls execute-tx, which signs and broadcasts for real. There is no
 * simulate path — the previous version of this spec claimed a "simulated
 * broadcast" that does not exist, and could never have advanced past the
 * disabled Review button on a zero-balance fresh wallet.
 *
 * So the spec brings a chain: it points the wallet's Aethelred network at a
 * local RPC (the `update-network-rpc` bridge kind), funds the imported
 * account with `anvil_setBalance`, and asserts the transfer landed. Bring
 * the chain up first and set WALLET_E2E_RPC:
 *
 *   anvil --chain-id 7332 --port 8545
 *   WALLET_E2E_RPC=http://127.0.0.1:8545 npx playwright test send-flow \
 *     --config e2e/playwright.config.ts
 */

import { test, expect } from "./fixtures";

const RPC_URL = process.env.WALLET_E2E_RPC;
const RECIPIENT = "0xcafebabecafebabecafebabecafebabecafebabe";

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

test("send flow signs and broadcasts a transfer that lands on-chain", async ({
  approvedPage,
}) => {
  test.skip(!RPC_URL, "set WALLET_E2E_RPC to a local anvil (chain-id 7332)");
  test.setTimeout(90_000);

  /* Point the wallet's Aethelred network (0x1ca4) at the local chain — its
   * default is the public testnet validator. */
  const rpcUpdate = await approvedPage.evaluate(async (rpcUrl) => {
    const chromeApi = (globalThis as unknown as { chrome: typeof chrome }).chrome;
    return await new Promise<any>((resolve) =>
      chromeApi.runtime.sendMessage(
        { kind: "update-network-rpc", payload: { chainId: "0x1ca4", rpcUrl } },
        resolve,
      ),
    );
  }, RPC_URL);
  expect(
    rpcUpdate?.payload?.result?.network?.rpcUrl ?? rpcUpdate?.result?.network?.rpcUrl,
    "wallet accepted the local RPC override",
  ).toBe(RPC_URL);

  /* Fund the fixture's account so the Send view has a spendable balance. */
  const state = await approvedPage.evaluate(async () => {
    const chromeApi = (globalThis as unknown as { chrome: typeof chrome }).chrome;
    return await new Promise<any>((resolve) =>
      chromeApi.runtime.sendMessage({ kind: "get-state" }, resolve),
    );
  });
  const from: string =
    state?.payload?.result?.accounts?.[0]?.address ?? state?.result?.accounts?.[0]?.address;
  expect(from, "fixture wallet exposes an account address").toMatch(/^0x[0-9a-fA-F]{40}$/);
  await rpc("anvil_setBalance", [from, "0x8ac7230489e80000"]); // 10 AETHEL

  const recipientBefore = BigInt(await rpc("eth_getBalance", [RECIPIENT, "latest"]));

  /* The popup polls balances; reload so the funded balance is on screen. */
  await approvedPage.reload();

  /* Home → Send. */
  await approvedPage.getByRole("button", { name: /^Send$/ }).first().click();

  /* Recipient + amount. The Review button stays disabled until both are
   * valid and the balance covers the amount. */
  const reviewBtn = approvedPage.getByRole("button", { name: /Review transaction/i });
  await expect(reviewBtn).toBeDisabled();
  await approvedPage.locator("#to").fill(RECIPIENT);
  await approvedPage.locator("#amount").fill("0.01");
  await expect(reviewBtn).toBeEnabled({ timeout: 20_000 });
  await reviewBtn.click();

  /* Review → sign + broadcast. */
  await approvedPage.getByRole("button", { name: /Confirm & sign/i }).click();

  /* Success morph. */
  await expect(approvedPage.getByText(/Transaction submitted/i)).toBeVisible({
    timeout: 30_000,
  });

  /* The chain agrees: the recipient received exactly 0.01 AETHEL. */
  await expect
    .poll(async () => (await rpc("eth_getBalance", [RECIPIENT, "latest"])).toString(), {
      timeout: 20_000,
    })
    .not.toBe(`0x${recipientBefore.toString(16)}`);

  const recipientAfter = BigInt(await rpc("eth_getBalance", [RECIPIENT, "latest"]));
  expect(recipientAfter - recipientBefore).toBe(10_000_000_000_000_000n); // 0.01e18
});
