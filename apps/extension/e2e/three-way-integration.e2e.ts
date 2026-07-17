/**
 * Aethelred Wallet ⇄ Cruzible ⇄ ZeroID — the THREE-WAY integration.
 * ──────────────────────────────────────────────────────────────────
 * One hermetic session proving the identity-gated staking loop across all
 * three surfaces, against a live local devnet (chain 7332) running the
 * REAL contracts (ZeroID.sol from the zeroid repo — not a mock):
 *
 *   1. import a funded account; point the wallet's 7332 network at the devnet
 *   2. open Cruzible (identity gate ON) and connect via per-origin consent
 *   3. the stake form BLOCKS: amber "requires a ZeroID identity" banner and
 *      a disabled "ZeroID Identity Required" CTA
 *   4. register a ZeroID identity THROUGH THE WALLET (eth_sendTransaction →
 *      approval sheet) — and assert the wallet DECODED the intent as
 *      `registerIdentity` (gap W-1 exercised in the real pipeline)
 *   5. the banner flips to "ZeroID verified"; the SAME stake now submits;
 *      the wallet decodes it as a vault interaction and the stake lands
 *      ON-CHAIN (staker holds stAETHEL)
 *   6. the wallet's live staking reader (gap W-2) reports the position
 *      through its own service worker: stakedWei > 0 for the account
 *
 * ZeroID's registration is driven as an on-chain transaction through the
 * wallet — the wallet IS the integration surface under test; the ZeroID
 * SaaS app has its own E2E (zeroid-integration.e2e.ts).
 *
 * Off unless THREE_WAY_INTEGRATION=1. Bring the stack up first (from the
 * cruzible repo — scripts/setup-three-way-e2e.mjs prints every value):
 *   - aethelredd devnet with EVM JSON-RPC (CRUZIBLE_RPC, default :8547)
 *   - ZeroID + Cruzible (identity gate ON) + StAETHEL deployed
 *   - the Cruzible frontend (CRUZIBLE_URL, default :3005) with the
 *     deployed addresses in env
 *   - the imported account funded with native AETHEL
 */
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";

const ENABLED = process.env.THREE_WAY_INTEGRATION === "1";

const CRUZIBLE_URL = process.env.CRUZIBLE_URL ?? "http://localhost:3005";
const RPC_URL = process.env.CRUZIBLE_RPC ?? "http://127.0.0.1:8547";
const STAETHEL_ADDRESS = process.env.CRUZIBLE_STAETHEL_ADDRESS ?? "";
const ZEROID_ADDRESS = process.env.ZEROID_REGISTRY_ADDRESS ?? "";
// anvil default account 0 — import target; must be pre-funded on the devnet.
const MNEMONIC =
  "test test test test test test test test test test test junk".split(" ");
const ACCOUNT0 = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

// registerIdentity(bytes32 didHash, bytes32 recoveryHash) — selector 0x3ffb0036.
const DID_HASH = "11".repeat(31) + "01";
const RECOVERY_HASH = "22".repeat(31) + "02";
const REGISTER_CALLDATA = `0x3ffb0036${DID_HASH}${RECOVERY_HASH}`;

const SHOTS = path.resolve(__dirname, "..", "test-artifacts", "three-way-integration");
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

async function erc20Balance(token: string, owner: string): Promise<bigint> {
  const data = `0x70a08231${owner.slice(2).padStart(64, "0")}`;
  return BigInt(await rpc("eth_call", [{ to: token, data }, "latest"]));
}

/** ZeroID resolveByController(address) — returns the bound didHash. */
async function resolveByController(owner: string): Promise<string> {
  const data = `0x274124d3${owner.slice(2).padStart(64, "0")}`;
  return await rpc("eth_call", [{ to: ZEROID_ADDRESS, data }, "latest"]);
}

/** Approve wallet prompts as they queue; record decoded methods (W-1). */
function startAutoApprover(walletPopup: Page) {
  let running = true;
  const decodedMethods = new Set<string>();
  const approvedKinds = new Set<string>();
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
          return pending
            ? {
                id: pending.id,
                kind: pending.detail?.kind ?? "unknown",
                decodedMethod: pending.detail?.decodedMethod ?? null,
              }
            : null;
        })
        .catch(() => null);
      if (next) {
        approvedKinds.add(next.kind);
        if (next.decodedMethod) decodedMethods.add(next.decodedMethod);
        await shot(walletPopup, `wallet-approve-${next.decodedMethod ?? next.kind}`);
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
    approvedKinds,
    decodedMethods,
  };
}

test.describe("Aethelred Wallet + Cruzible + ZeroID", () => {
  test.skip(!ENABLED, "set THREE_WAY_INTEGRATION=1 with the local stack running");
  test.beforeAll(() => {
    fs.mkdirSync(SHOTS, { recursive: true });
    if (!STAETHEL_ADDRESS || !ZEROID_ADDRESS) {
      throw new Error("CRUZIBLE_STAETHEL_ADDRESS and ZEROID_REGISTRY_ADDRESS are required");
    }
  });

  test("identity-gated staking end-to-end across all three surfaces", async ({
    context,
    extensionId,
  }) => {
    test.setTimeout(240_000);

    // ── 1. Import the funded account, point 7332 at the devnet ────────────
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
    ).toBe(RPC_URL);
    await walletPopup.reload();
    const approver = startAutoApprover(walletPopup);

    // Fresh chain state: the account controls no ZeroID identity.
    expect(BigInt(await resolveByController(ACCOUNT0))).toBe(0n);

    // ── 2. Connect to Cruzible ─────────────────────────────────────────────
    const dapp = await context.newPage();
    await dapp.goto(`${CRUZIBLE_URL}/vault`, { waitUntil: "domcontentloaded" });
    await dapp.waitForTimeout(2500);
    await dapp.getByRole("button", { name: /Connect Wallet/i }).first().click();
    await dapp.waitForTimeout(600);
    const connectorBtn = dapp
      .locator("button")
      .filter({ hasText: /Aethelred Wallet|Injected|Browser Wallet/i })
      .first();
    if (await connectorBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await connectorBtn.click();
    }
    await expect(dapp.getByText(new RegExp(ACCOUNT0.slice(0, 6), "i")).first()).toBeVisible({
      timeout: 20_000,
    });
    await shot(dapp, "cruzible-connected");

    // ── 3. The identity gate BLOCKS an unregistered wallet ────────────────
    await dapp.getByRole("button", { name: /^Stake$/ }).first().click();
    await dapp.waitForTimeout(600);
    await expect(
      dapp.getByText(/This vault requires a ZeroID identity/i).first(),
      "the stake form explains the identity gate",
    ).toBeVisible({ timeout: 20_000 });
    await dapp.locator("#stake-aethel-amount").fill("2");
    const blockedCta = dapp.getByRole("button", { name: /^ZeroID Identity Required$/ });
    await expect(blockedCta, "the CTA names the blocker").toBeVisible({ timeout: 30_000 });
    await expect(blockedCta).toBeDisabled();
    await shot(dapp, "cruzible-identity-blocked");

    // ── 4. Register the ZeroID identity THROUGH THE WALLET ────────────────
    const txHash = await dapp.evaluate(
      async ({ to, data, from }) => {
        const eth = (window as any).ethereum;
        return await eth.request({
          method: "eth_sendTransaction",
          params: [{ from, to, data }],
        });
      },
      { to: ZEROID_ADDRESS, data: REGISTER_CALLDATA, from: ACCOUNT0 },
    );
    expect(txHash, "registerIdentity submitted via the wallet").toMatch(/^0x[0-9a-f]{64}$/);
    await expect(async () => {
      expect(BigInt(await resolveByController(ACCOUNT0)) !== 0n).toBe(true);
    }).toPass({ timeout: 30_000 });
    // W-1 through the REAL pipeline: the approval detail carried the intent.
    expect([...approver.decodedMethods]).toContain("registerIdentity");

    // ── 5. The gate opens: the SAME stake now goes through ────────────────
    await dapp.reload({ waitUntil: "domcontentloaded" });
    await dapp.waitForTimeout(2500);
    await dapp.getByRole("button", { name: /^Stake$/ }).first().click();
    await expect(
      dapp.getByText(/ZeroID verified/i).first(),
      "the banner flips to verified after registration",
    ).toBeVisible({ timeout: 20_000 });
    await shot(dapp, "cruzible-identity-verified");

    const stAethelBefore = await erc20Balance(STAETHEL_ADDRESS, ACCOUNT0);
    await dapp.locator("#stake-aethel-amount").fill("2");
    const primary = dapp.getByRole("button", { name: /^Stake 2\.00 AETHEL$/ });
    await expect(primary).toBeEnabled({ timeout: 30_000 });
    await primary.click();
    await dapp.waitForTimeout(600);
    await dapp.getByRole("button", { name: /^Confirm Stake$/ }).click();

    await expect(async () => {
      const after = await erc20Balance(STAETHEL_ADDRESS, ACCOUNT0);
      expect(after > stAethelBefore, "staker received stAETHEL on-chain").toBe(true);
    }).toPass({ timeout: 60_000 });
    await shot(dapp, "cruzible-staked");
    expect([...approver.approvedKinds]).toContain("tx");

    // ── 6. The wallet's live staking reader sees the position (W-2) ────────
    await walletPopup.evaluate(
      async (token) => {
        const chromeApi = (globalThis as unknown as { chrome: typeof chrome }).chrome;
        await new Promise((r) =>
          chromeApi.runtime.sendMessage(
            {
              kind: "add-token",
              payload: {
                address: token,
                symbol: "stAETHEL",
                name: "Staked AETHEL",
                decimals: 18,
                chainId: 7332,
                logoColor: "#34c759",
              },
            },
            r,
          ),
        );
      },
      STAETHEL_ADDRESS,
    );
    const position = await walletPopup.evaluate(async (address) => {
      const chromeApi = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      const res = await new Promise<any>((r) =>
        chromeApi.runtime.sendMessage({ kind: "get-staking-position", payload: { address } }, r),
      );
      return res?.payload?.result ?? res?.result ?? null;
    }, ACCOUNT0);
    expect(position, "the wallet reads a live Cruzible position").toBeTruthy();
    expect(BigInt(position.stakedWei) > 0n, "stakedWei reflects the stake").toBe(true);
    expect(position.vaultAddress, "vault discovered on-chain from the token").toMatch(
      /^0x[0-9a-f]{40}$/,
    );
    await shot(walletPopup, "wallet-final");

    await approver.stop();
  });
});
