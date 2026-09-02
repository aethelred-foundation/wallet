/**
 * Aethelred Wallet ⇄ ZeroID full integration.
 * ────────────────────────────────────────────
 * Drives the real, unpacked wallet extension through the complete ZeroID
 * identity-registration journey against a live local stack:
 *
 *   1. import an anvil-funded account into the wallet
 *   2. open ZeroID, connect via the wallet's per-origin consent
 *   3. run the identity-creation wizard
 *   4. approve the personal_sign message in the wallet
 *   5. approve the registerIdentity on-chain transaction in the wallet
 *   6. assert the identity is anchored on-chain + stored in the backend
 *      + rendered as the engraved identity card
 *
 * A background auto-approver approves each wallet prompt as it appears — the
 * way a user would — and screenshots the sheets for the human record.
 *
 * This test needs the full external stack running, so it is OFF unless
 * ZEROID_INTEGRATION=1 is set. Bring the stack up first:
 *   - anvil --chain-id 7332 --port 8545
 *   - deploy the ZeroID identity contracts (script/DeployIdentity.s.sol) to it
 *   - the ZeroID backend on :4003 and frontend on :3003 pointed at that chain
 *   - build the extension with its Aethelred network RPC at http://127.0.0.1:8545
 *
 * registerIdentity permanently binds the controller address on-chain, so each
 * pass against a long-lived chain needs a fresh account: set ZEROID_TEST_MNEMONIC
 * to any test-only phrase (its account 0 is auto-funded via anvil_setBalance).
 * Without it, the spec uses the anvil default mnemonic (account 0).
 */
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";

const ENABLED = process.env.ZEROID_INTEGRATION === "1";

const ZEROID_URL = process.env.ZEROID_URL ?? "http://localhost:3003";
const BACKEND_URL = process.env.ZEROID_BACKEND_URL ?? "http://localhost:4003";
const RPC_URL = process.env.ZEROID_RPC_URL ?? "http://127.0.0.1:8545";
// anvil default account 0 (m/44'/60'/0'/0/0 of the standard test mnemonic).
const ANVIL_MNEMONIC_PHRASE =
  "test test test test test test test test test test test junk";
const ANVIL_ACCOUNT0 = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
// registerIdentity binds a controller address permanently, so re-runs against a
// long-lived chain need a fresh account: pass a different (test-only) mnemonic
// via ZEROID_TEST_MNEMONIC. Its account 0 is funded with anvil_setBalance below.
const MNEMONIC_PHRASE = (
  process.env.ZEROID_TEST_MNEMONIC ?? ANVIL_MNEMONIC_PHRASE
).trim();
const MNEMONIC = MNEMONIC_PHRASE.split(/\s+/);
const USING_ANVIL_DEFAULT = MNEMONIC_PHRASE === ANVIL_MNEMONIC_PHRASE;

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

const SHOTS = path.resolve(__dirname, "..", "test-artifacts", "zeroid-integration");
let step = 0;
async function shot(page: Page, name: string) {
  step += 1;
  await page
    .screenshot({ path: path.join(SHOTS, `${String(step).padStart(2, "0")}-${name}.png`) })
    .catch(() => {});
}

/**
 * Continuously approve wallet prompts as they queue — like a user clicking
 * Approve — capturing each new kind once for the record.
 */
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

test.describe("Aethelred Wallet + ZeroID", () => {
  test.skip(!ENABLED, "set ZEROID_INTEGRATION=1 with the local stack running");
  test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));

  test("registers a ZeroID identity end-to-end via the wallet", async ({
    context,
    extensionId,
  }) => {
    test.setTimeout(180_000);

    // ── 1. Import the anvil-funded account into the wallet ────────────────
    const walletPopup = await context.newPage();
    await walletPopup.goto(`chrome-extension://${extensionId}/popup.html`);
    const importResult = await walletPopup.evaluate(
      async ({ mnemonic }) => {
        const chromeApi = (globalThis as unknown as { chrome: typeof chrome }).chrome;
        return await new Promise<any>((resolve) =>
          chromeApi.runtime.sendMessage(
            {
              kind: "import-wallet",
              payload: { password: "Integration-Test-Pass-123", mnemonic, label: "e2e-0" },
            },
            resolve,
          ),
        );
      },
      { mnemonic: MNEMONIC },
    );
    const importedAddress: string = (
      importResult?.payload?.result?.address ??
      importResult?.result?.address ??
      ""
    ).toLowerCase();
    if (USING_ANVIL_DEFAULT) {
      expect(importedAddress, "wallet derives anvil account 0 from the test mnemonic").toBe(
        ANVIL_ACCOUNT0,
      );
    } else {
      expect(
        importedAddress,
        "wallet derives account 0 from the supplied mnemonic",
      ).toMatch(/^0x[0-9a-f]{40}$/);
      // Not an anvil default account, so it starts with zero balance — fund it
      // for the registerIdentity gas.
      await rpc("anvil_setBalance", [importedAddress, "0x8ac7230489e80000"]); // 10 AETHEL
    }
    await walletPopup.reload();
    await shot(walletPopup, "wallet-home-imported");

    // The wallet's default 0x1ca4 entry points at the PUBLIC testnet
    // validator. This test is hermetic: re-point the active network at the
    // local RPC so the registerIdentity broadcast lands on the same chain the
    // dApp, backend, and the assertions below are looking at. (A previous run
    // silently broadcast to the public validator — nonce moved there, nothing
    // on anvil — and still "passed" because nothing asserted the chain.)
    const rpcUpdate = await walletPopup.evaluate(async (rpcUrl) => {
      const chromeApi = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      return await new Promise<any>((resolve) =>
        chromeApi.runtime.sendMessage(
          { kind: "update-network-rpc", payload: { chainId: "0x1ca4", rpcUrl } },
          resolve,
        ),
      );
    }, RPC_URL);
    const updatedRpc =
      rpcUpdate?.payload?.result?.network?.rpcUrl ?? rpcUpdate?.result?.network?.rpcUrl;
    expect(updatedRpc, "wallet accepted the local RPC override").toBe(RPC_URL);

    const approver = startAutoApprover(walletPopup);

    // ── 2. Open ZeroID and connect through the wallet ─────────────────────
    const dapp = await context.newPage();
    await dapp.goto(ZEROID_URL, { waitUntil: "domcontentloaded" });
    await dapp.waitForTimeout(1500);
    await shot(dapp, "zeroid-welcome");

    // The wallet injects an EIP-1193 provider and announces via EIP-6963.
    expect(
      await dapp.evaluate(() => !!(window as any).ethereum?.isAethelred),
      "the Aethelred Wallet provider is present on the dApp page",
    ).toBe(true);

    await dapp.getByRole("button", { name: /^Connect$/ }).first().click();
    await dapp.waitForTimeout(800);
    await shot(dapp, "zeroid-connect-menu");
    await dapp.locator("button").filter({ hasText: /Aethelred Wallet/i }).first().click();

    await expect(
      dapp.getByText(new RegExp(importedAddress.slice(0, 6), "i")).first(),
    ).toBeVisible({ timeout: 20_000 });
    await shot(dapp, "zeroid-connected");

    // ── 3. Open the identity-creation wizard ──────────────────────────────
    await dapp.goto(`${ZEROID_URL}/identity`, { waitUntil: "domcontentloaded" });
    await dapp.waitForTimeout(1200);
    await dapp.getByRole("button", { name: /Create ZeroID/i }).first().click();
    await dapp.waitForTimeout(800);
    await dapp.getByRole("button", { name: /^Next$/ }).first().click();
    await dapp.waitForTimeout(600);
    await shot(dapp, "zeroid-register-step");

    // ── 4 + 5. Register: the auto-approver handles personal_sign + the tx ──
    await dapp.getByRole("button", { name: /Register Identity/i }).first().click();

    // ── 6. Success: card engraved + backend + chain agree ─────────────────
    await expect(dapp.getByText(/Identity Registered/i)).toBeVisible({ timeout: 60_000 });
    await shot(dapp, "zeroid-registered");
    expect([...approver.approvedKinds].sort()).toEqual(
      ["connect", "personal_sign", "tx"].sort(),
    );

    await dapp.goto(`${ZEROID_URL}/`, { waitUntil: "domcontentloaded" });
    await dapp.waitForTimeout(3000);
    await shot(dapp, "zeroid-dashboard-card");

    const backend = await dapp.evaluate(
      async ({ url, addr }) => {
        const res = await fetch(`${url}/api/v1/identity/address/${addr}`);
        return { status: res.status, body: await res.text() };
      },
      { url: BACKEND_URL, addr: importedAddress },
    );
    expect(backend.status, "backend resolves the registered identity").toBe(200);
    expect(backend.body).toContain(`did:aethelred:testnet:${importedAddress}`);

    // ── 7. The chain itself must agree — UI + backend are not enough. ─────
    // A broadcast that landed on a different node (or reverted) can satisfy
    // every assertion above; only the target chain's own state is proof.
    const nonce = (await rpc("eth_getTransactionCount", [
      importedAddress,
      "latest",
    ])) as string;
    expect(
      parseInt(nonce, 16),
      "the registration tx was mined on the LOCAL chain",
    ).toBeGreaterThan(0);

    const registry =
      process.env.ZEROID_REGISTRY_ADDRESS ??
      "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    // resolveByController(address) selector 0x274124d3 + left-padded address.
    const didHash = (await rpc("eth_call", [
      {
        to: registry,
        data: `0x274124d3${importedAddress.slice(2).padStart(64, "0")}`,
      },
      "latest",
    ])) as string;
    expect(
      didHash,
      "resolveByController binds the wallet's account to a DID on-chain",
    ).not.toBe(`0x${"0".repeat(64)}`);

    await approver.stop();
  });
});
