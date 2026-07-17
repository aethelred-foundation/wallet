/**
 * Aethelred Wallet ⇄ Cruzible full integration.
 * ──────────────────────────────────────────────
 * Drives the real, unpacked wallet extension through the Cruzible liquid-
 * staking flow against a live local aethelredd devnet (chain 7332):
 *
 *   1. import a funded account into the wallet
 *   2. re-point the wallet's 7332 network at the local devnet RPC
 *   3. open Cruzible, connect via the wallet's per-origin consent
 *   4. stake native AETHEL through the vault UI (two-step confirm)
 *   5. approve the transaction in the wallet
 *   6. assert the stake landed ON-CHAIN: the staker holds stAETHEL
 *
 * Off unless CRUZIBLE_INTEGRATION=1. Bring the stack up first:
 *   - aethelredd devnet with EVM JSON-RPC (CRUZIBLE_RPC, default :8547)
 *   - Cruzible + StAETHEL deployed (scripts/devnet-deploy-e2e.mjs in the
 *     cruzible repo prints the addresses)
 *   - the Cruzible frontend (CRUZIBLE_URL, default :3005) with
 *     NEXT_PUBLIC_CHAIN_ENV=devnet and the deployed addresses in env
 *   - the imported account funded with native AETHEL on that chain
 */
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";

const ENABLED = process.env.CRUZIBLE_INTEGRATION === "1";

const CRUZIBLE_URL = process.env.CRUZIBLE_URL ?? "http://localhost:3005";
const RPC_URL = process.env.CRUZIBLE_RPC ?? "http://127.0.0.1:8547";
const STAETHEL_ADDRESS =
  process.env.CRUZIBLE_STAETHEL_ADDRESS ??
  "0x24969c6522d4957ca589cce09dc5be38faff0e26";
// anvil default account 0 — import target; must be pre-funded on the devnet.
const MNEMONIC =
  "test test test test test test test test test test test junk".split(" ");
const ACCOUNT0 = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

const SHOTS = path.resolve(__dirname, "..", "test-artifacts", "cruzible-integration");
let step = 0;
async function shot(page: Page, name: string) {
  step += 1;
  await page
    .screenshot({ path: path.join(SHOTS, `${String(step).padStart(2, "0")}-${name}.png`) })
    .catch(() => {});
}

async function rpc(method: string, params: unknown[]): Promise<string> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result as string;
}

/** ERC-20 balanceOf via eth_call (selector 0x70a08231). */
async function erc20Balance(token: string, owner: string): Promise<bigint> {
  const data = `0x70a08231${owner.slice(2).padStart(64, "0")}`;
  return BigInt(await rpc("eth_call", [{ to: token, data }, "latest"]));
}

/** Approve wallet prompts as they queue (connect + tx), like a user would. */
function startAutoApprover(walletPopup: Page) {
  let running = true;
  const seen = new Set<string>();
  const loop = (async () => {
    while (running) {
      const next = await walletPopup
        .evaluate(async () => {
          const chromeApi = (globalThis as unknown as { chrome: typeof chrome }).chrome;
          const state = await new Promise<any>((r) =>
            chromeApi.runtime.sendMessage({ kind: "get-state" }, r),
          );
          const approvals: any[] = state?.payload?.result?.pendingApprovals ?? [];
          const pending = approvals.find((a) => a.status === "pending");
          return pending ? { id: pending.id, kind: pending.detail?.kind ?? "unknown" } : null;
        })
        .catch(() => null);
      if (next) {
        if (!seen.has(next.kind)) {
          seen.add(next.kind);
          await shot(walletPopup, `wallet-approve-${next.kind}`);
        }
        await walletPopup
          .evaluate(async (id) => {
            const chromeApi = (globalThis as unknown as { chrome: typeof chrome }).chrome;
            await new Promise((r) =>
              chromeApi.runtime.sendMessage(
                { kind: "approval-response", payload: { approvalId: id, decision: "approved" } },
                r,
              ),
            );
          }, next.id)
          .catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  })();
  return {
    stop: async () => {
      running = false;
      await loop;
    },
    approvedKinds: seen,
  };
}

test.describe("Aethelred Wallet + Cruzible", () => {
  test.skip(!ENABLED, "set CRUZIBLE_INTEGRATION=1 with the local stack running");
  test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));

  test("stakes native AETHEL end-to-end via the wallet", async ({
    context,
    extensionId,
  }) => {
    test.setTimeout(180_000);

    // ── 1. Import the funded account ──────────────────────────────────────
    const walletPopup = await context.newPage();
    await walletPopup.goto(`chrome-extension://${extensionId}/popup.html`);
    await walletPopup.evaluate(
      async ({ mnemonic }) => {
        const chromeApi = (globalThis as unknown as { chrome: typeof chrome }).chrome;
        await new Promise((resolve) =>
          chromeApi.runtime.sendMessage(
            {
              kind: "import-wallet",
              payload: { password: "Integration-Test-Pass-123", mnemonic, label: "devnet-0" },
            },
            resolve,
          ),
        );
      },
      { mnemonic: MNEMONIC },
    );

    // ── 2. Point the wallet's 7332 network at the local devnet ────────────
    const rpcUpdate = await walletPopup.evaluate(async (rpcUrl) => {
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
      "wallet accepted the devnet RPC override",
    ).toBe(RPC_URL);
    await walletPopup.reload();
    await shot(walletPopup, "wallet-home-imported");

    const approver = startAutoApprover(walletPopup);
    const stAethelBefore = await erc20Balance(STAETHEL_ADDRESS, ACCOUNT0);

    // ── 3. Open Cruzible and connect ───────────────────────────────────────
    const dapp = await context.newPage();
    await dapp.goto(`${CRUZIBLE_URL}/vault`, { waitUntil: "domcontentloaded" });
    await dapp.waitForTimeout(2500);
    await shot(dapp, "cruzible-vault");

    expect(
      await dapp.evaluate(() => !!(window as any).ethereum?.isAethelred),
      "the Aethelred Wallet provider is present on the dApp page",
    ).toBe(true);

    await dapp.getByRole("button", { name: /Connect Wallet/i }).first().click();
    await dapp.waitForTimeout(600);
    await shot(dapp, "cruzible-connector-modal");
    const connectorBtn = dapp
      .locator("button")
      .filter({ hasText: /Aethelred Wallet|Injected|Browser Wallet/i })
      .first();
    if (await connectorBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await connectorBtn.click();
    }
    // The header renders the connected address truncated + checksummed
    // ("0xf39F...2266"), so assert on the prefix.
    await expect(
      dapp.getByText(new RegExp(ACCOUNT0.slice(0, 6), "i")).first(),
    ).toBeVisible({ timeout: 20_000 });
    await shot(dapp, "cruzible-connected");

    // The wallet must still be on Aethelred (0x1ca4) after the dApp's
    // connect handshake — a connect flow that silently switches the wallet
    // to another network breaks every account-scoped read that routes
    // through the provider ("Available: 0.00" with a funded account).
    const activeChain = await walletPopup.evaluate(async () => {
      const chromeApi = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      const res = await new Promise<any>((r) =>
        chromeApi.runtime.sendMessage({ kind: "get-networks" }, r),
      );
      return res?.payload?.result?.active ?? res?.result?.active;
    });
    expect(activeChain, "wallet stays on Aethelred after connect").toBe("0x1ca4");

    // ── 4. Stake 2 AETHEL through the vault form (behind the Stake tab) ───
    await dapp.getByRole("button", { name: /^Stake$/ }).first().click();
    await dapp.waitForTimeout(600);
    const amountInput = dapp.locator("#stake-aethel-amount");
    await amountInput.scrollIntoViewIfNeeded();
    await amountInput.fill("2");
    // Two-step confirm. The CTA text encodes the gating state — it reads
    // "Waiting for Live Exchange Rate" / "Insufficient Balance" until the
    // vault quote and the wallet balance are both live, then becomes
    // "Stake 2.00 AETHEL". Asserting on the final label means a stalled
    // quote or an unread balance fails loudly instead of silently.
    const primary = dapp.getByRole("button", { name: /^Stake 2\.00 AETHEL$/ });
    await expect(primary, "stake CTA enables once quote + balance are live").toBeEnabled({
      timeout: 30_000,
    });
    await primary.click();
    await dapp.waitForTimeout(600);
    await shot(dapp, "cruzible-confirm");
    await dapp.getByRole("button", { name: /^Confirm Stake$/ }).click();

    // ── 5. The wallet approves (auto-approver), the tx lands ──────────────
    await expect(async () => {
      const after = await erc20Balance(STAETHEL_ADDRESS, ACCOUNT0);
      expect(after > stAethelBefore, "staker received stAETHEL on-chain").toBe(true);
    }).toPass({ timeout: 60_000 });
    await shot(dapp, "cruzible-staked");

    expect([...approver.approvedKinds]).toContain("tx");

    // ── 6. On-chain: nonce moved on the LOCAL chain (no cross-RPC leak) ────
    const nonce = parseInt(await rpc("eth_getTransactionCount", [ACCOUNT0, "latest"]), 16);
    expect(nonce, "the stake tx was mined on the local devnet").toBeGreaterThan(0);

    await approver.stop();
  });
});
