/**
 * Integration: wallet lock / unlock lifecycle.
 *
 * Covers:
 *   - Unlock with correct password → signing works
 *   - Lock → signing fails with -32001 "Wallet locked"
 *   - Wrong password → fails, state stays locked, audit captures failure
 *   - Correct password after a failed attempt still unlocks
 *   - lock-state-changed audit events fire for every transition
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createBackgroundHarness, TEST_PASSWORD, type BackgroundHarness } from "./harness";

describe("lock-unlock integration", () => {
  let harness: BackgroundHarness;

  beforeEach(async () => {
    harness = await createBackgroundHarness();
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it("lock-request: signing subsequently fails with -32001", async () => {
    await harness.sendMessage("lock-request", {});
    const [account] = harness.getKnownAccounts();
    const res = await harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{
          from: account.address,
          to: "0xcafebabecafebabecafebabecafebabecafebabe",
          value: "0x1",
        }],
      },
      "https://dapp.test",
    );
    expect(res.payload.error?.code).toBe(-32001);
  });

  it("unlock with correct password restores signing", async () => {
    await harness.sendMessage("lock-request", {});
    const unlock = await harness.sendMessage("unlock-request", { password: TEST_PASSWORD });
    expect(unlock.payload.result).toBeDefined();
    expect(unlock.payload.error).toBeUndefined();

    // After unlock, a tx should work (approved in the popup)
    const [account] = harness.getKnownAccounts();
    harness.stubNextBroadcast("0x" + "42".repeat(32) as `0x${string}`);
    const pending = harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{
          from: account.address,
          to: "0xcafebabecafebabecafebabecafebabecafebabe",
          value: "0x1",
        }],
      },
      "https://dapp.test",
    );
    await new Promise((r) => setTimeout(r, 0));
    const approvals = harness.getPendingApprovals();
    await harness.sendMessage("approval-response", {
      approvalId: approvals[0].approvalId,
      decision: "approved",
    });
    const res = await pending;
    expect(res.payload.result).toBeDefined();
  });

  it("wrong password → error, locked state preserved, audit captures failure", async () => {
    await harness.sendMessage("lock-request", {});
    const beforeCount = harness
      .getAuditEvents()
      .filter((e) => e.kind === "credential-verification-failed").length;
    const res = await harness.sendMessage("unlock-request", { password: "wrong" });
    expect(res.payload.error).toBeDefined();
    expect(res.payload.error?.code).toBe(-32001);

    const afterCount = harness
      .getAuditEvents()
      .filter((e) => e.kind === "credential-verification-failed").length;
    expect(afterCount).toBe(beforeCount + 1);

    // Still locked: signing should still fail
    const [account] = harness.getKnownAccounts();
    const txRes = await harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{ from: account.address, to: "0xcafe", value: "0x1" }],
      },
      "https://dapp.test",
    );
    expect(txRes.payload.error?.code).toBe(-32001);
  });

  it("correct password after failed attempt still unlocks", async () => {
    await harness.sendMessage("lock-request", {});
    await harness.sendMessage("unlock-request", { password: "wrong" });
    const res = await harness.sendMessage("unlock-request", { password: TEST_PASSWORD });
    expect(res.payload.result).toBeDefined();
  });

  it("lock-state-changed audit events record both transitions", async () => {
    await harness.sendMessage("lock-request", {});
    await harness.sendMessage("unlock-request", { password: TEST_PASSWORD });

    const lockEvents = harness
      .getAuditEvents()
      .filter((e) => e.kind === "lock-state-changed");

    // Initial wallet-initialized + lock-request(locked=true) + unlock-request(locked=false)
    // are all in the event stream; we expect at least one locked=true and one locked=false.
    const hasLocked = lockEvents.some((e) => e.detail.locked === true);
    const hasUnlocked = lockEvents.some((e) => e.detail.locked === false);
    expect(hasLocked).toBe(true);
    expect(hasUnlocked).toBe(true);
  });

  it("read-only RPCs (eth_chainId) still work while locked", async () => {
    await harness.sendMessage("lock-request", {});
    const res = await harness.sendMessage("rpc-request", { method: "eth_chainId", params: [] });
    expect(res.payload.result).toBe("0xaa36a7");
    expect(res.payload.error).toBeUndefined();
  });

  it("get-state reports locked=true when locked", async () => {
    await harness.sendMessage("lock-request", {});
    const state = await harness.sendMessage("get-state", {});
    const result = state.payload.result as { locked: boolean };
    expect(result.locked).toBe(true);
  });

  it("isLocked reports false after unlock", async () => {
    await harness.sendMessage("lock-request", {});
    await harness.sendMessage("unlock-request", { password: TEST_PASSWORD });
    const state = await harness.sendMessage("get-state", {});
    const result = state.payload.result as { locked: boolean };
    expect(result.locked).toBe(false);
  });
});
