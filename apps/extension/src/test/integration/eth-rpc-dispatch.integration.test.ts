/**
 * Integration test for read-only RPC dispatch.
 *
 * Covers every method in the `KNOWN_METHODS` set that does NOT require a
 * signature — asserts each:
 *   - routes to the right RPC endpoint / handler
 *   - returns a spec-compliant shape
 *   - errors with -32601 for unknown methods and -32602 for malformed params
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createBackgroundHarness, type BackgroundHarness } from "./harness";

describe("EIP-1193 read-only RPC dispatch", () => {
  let harness: BackgroundHarness;

  beforeEach(async () => {
    harness = await createBackgroundHarness();
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it("eth_chainId returns the active chain hex", async () => {
    const res = await harness.sendMessage("rpc-request", { method: "eth_chainId", params: [] });
    expect(res.payload.result).toBe("0xaa36a7");
  });

  it("net_version returns decimal chain id", async () => {
    const res = await harness.sendMessage("rpc-request", { method: "net_version", params: [] });
    expect(res.payload.result).toBe(String(parseInt("0xaa36a7", 16)));
  });

  it("eth_accounts returns nothing until the site is connected", async () => {
    const res = await harness.sendMessage("rpc-request", { method: "eth_accounts", params: [] });
    expect(res.payload.result).toEqual([]);
  });

  it("eth_requestAccounts requires user approval, then grants + persists", async () => {
    // Fire without awaiting — it blocks on the connection approval.
    const pendingResponse = harness.sendMessage("rpc-request", {
      method: "eth_requestAccounts",
      params: [],
    });
    await new Promise((r) => setTimeout(r, 0));
    const pending = harness.getPendingApprovals();
    expect(pending).toHaveLength(1);
    await harness.sendMessage("approval-response", {
      approvalId: pending[0].approvalId,
      decision: "approved",
    });
    const res = await pendingResponse;
    const addresses = res.payload.result as string[];
    expect(addresses).toHaveLength(1);
    expect(addresses[0]).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // Now connected: eth_accounts exposes the granted account, and a repeat
    // eth_requestAccounts returns it without re-prompting.
    const accts = await harness.sendMessage("rpc-request", { method: "eth_accounts", params: [] });
    expect((accts.payload.result as string[])[0]).toBe(addresses[0]);
    const again = await harness.sendMessage("rpc-request", {
      method: "eth_requestAccounts",
      params: [],
    });
    expect((again.payload.result as string[])[0]).toBe(addresses[0]);
    expect(harness.getPendingApprovals()).toHaveLength(0);
  });

  it("eth_accounts hides a previously granted address while the vault is locked", async () => {
    const pendingResponse = harness.sendMessage("rpc-request", {
      method: "eth_requestAccounts",
      params: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [approval] = harness.getPendingApprovals();
    await harness.sendMessage("approval-response", {
      approvalId: approval.approvalId,
      decision: "approved",
    });
    const connected = await pendingResponse;
    expect(connected.payload.result).toHaveLength(1);

    await harness.sendMessage("lock-request", {});
    const accounts = await harness.sendMessage(
      "rpc-request",
      { method: "eth_accounts", params: [] },
      "https://dapp.test",
    );
    expect(accounts.payload.result).toEqual([]);
  });

  it("eth_requestAccounts rejects cleanly (4001) when the user declines", async () => {
    const pendingResponse = harness.sendMessage("rpc-request", {
      method: "eth_requestAccounts",
      params: [],
    });
    await new Promise((r) => setTimeout(r, 0));
    const pending = harness.getPendingApprovals();
    expect(pending).toHaveLength(1);
    await harness.sendMessage("approval-response", {
      approvalId: pending[0].approvalId,
      decision: "rejected",
    });
    const res = await pendingResponse;
    expect((res.payload as { error?: { code: number } }).error?.code).toBe(4001);
    // Still not connected.
    const accts = await harness.sendMessage("rpc-request", { method: "eth_accounts", params: [] });
    expect(accts.payload.result).toEqual([]);
  });

  it("eth_blockNumber proxies to RPC", async () => {
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_blockNumber",
      params: [],
    });
    expect(res.payload.result).toBe("0x1234567");

    const calls = harness.recordedRpcCalls().filter((c) => c.method === "eth_blockNumber");
    expect(calls).toHaveLength(1);
  });

  it("eth_getBalance returns the seeded balance", async () => {
    const [account] = harness.getKnownAccounts();
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_getBalance",
      params: [account.address, "latest"],
    });
    const balance = res.payload.result as string;
    expect(balance.startsWith("0x")).toBe(true);
    // 10 ETH
    expect(BigInt(balance)).toBe(10n * 10n ** 18n);
  });

  it("eth_getTransactionCount returns a hex value", async () => {
    const [account] = harness.getKnownAccounts();
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_getTransactionCount",
      params: [account.address, "pending"],
    });
    expect((res.payload.result as string).startsWith("0x")).toBe(true);
  });

  it("eth_gasPrice returns a hex big int", async () => {
    const res = await harness.sendMessage("rpc-request", { method: "eth_gasPrice", params: [] });
    const hex = res.payload.result as string;
    expect(hex.startsWith("0x")).toBe(true);
    expect(BigInt(hex)).toBeGreaterThan(0n);
  });

  it("eth_feeHistory returns the scripted oldestBlock/baseFeePerGas", async () => {
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_feeHistory",
      params: ["0x1", "latest", [50]],
    });
    const feeHistory = res.payload.result as {
      oldestBlock: string;
      baseFeePerGas: string[];
      gasUsedRatio: number[];
      reward: string[][];
    };
    expect(feeHistory.oldestBlock).toBe("0x1234500");
    expect(feeHistory.baseFeePerGas).toHaveLength(2);
  });

  it("eth_maxPriorityFeePerGas returns a hex", async () => {
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_maxPriorityFeePerGas",
      params: [],
    });
    expect((res.payload.result as string).startsWith("0x")).toBe(true);
  });

  it("eth_call returns the stubbed `0x`", async () => {
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_call",
      params: [{ to: "0xcafe", data: "0x" }, "latest"],
    });
    expect(res.payload.result).toBe("0x");
  });

  it("eth_getCode returns `0x` for EOAs", async () => {
    const [account] = harness.getKnownAccounts();
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_getCode",
      params: [account.address, "latest"],
    });
    expect(res.payload.result).toBe("0x");
  });

  it("eth_getBlockByNumber returns a stubbed block", async () => {
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    });
    const block = res.payload.result as { number: string; transactions: unknown[] };
    expect(block.number).toBe("0x1234567");
    expect(block.transactions).toEqual([]);
  });

  it("eth_getBlockByHash returns null when the hash isn't found", async () => {
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_getBlockByHash",
      params: ["0x" + "00".repeat(32), false],
    });
    expect(res.payload.result).toBe(null);
  });

  /**
   * This test originally locked in a production bug: eth_getLogs was
   * dispatched by background.ts but missing from request-validator's
   * KNOWN_METHODS, so every call was rejected with -32601. Fixed by
   * adding eth_getLogs + the other filter methods (eth_newFilter,
   * eth_getFilterChanges, eth_uninstallFilter, etc.) to the whitelist.
   * The test now verifies the fix: eth_getLogs passes the validator
   * gate and forwards to the RPC client, which echoes back our stubbed
   * empty log array.
   */
  it("eth_getLogs forwards through the validator gate and returns RPC response", async () => {
    // Re-create the harness with eth_getLogs stubbed so we can observe
    // the full request → validator → dispatcher → rpcClient → mocked
    // fetch → response path. The fix under test is that eth_getLogs is
    // now in request-validator's KNOWN_METHODS whitelist.
    await harness.dispose();
    harness = await createBackgroundHarness({
      mockRpcResponses: { eth_getLogs: () => [] },
    });
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_getLogs",
      params: [{ fromBlock: "latest", toBlock: "latest" }],
    });
    expect(res.payload.error).toBeUndefined();
    expect(res.payload.result).toEqual([]);
  });

  it("eth_getTransactionReceipt returns null for an unknown hash", async () => {
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_getTransactionReceipt",
      params: ["0x" + "99".repeat(32)],
    });
    expect(res.payload.result).toBe(null);
  });

  it("eth_getTransactionByHash returns null for an unknown hash", async () => {
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_getTransactionByHash",
      params: ["0x" + "99".repeat(32)],
    });
    expect(res.payload.result).toBe(null);
  });

  it("eth_estimateGas returns a hex limit", async () => {
    const [account] = harness.getKnownAccounts();
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_estimateGas",
      params: [{ from: account.address, to: "0xcafe", value: "0x1" }],
    });
    expect((res.payload.result as string).startsWith("0x")).toBe(true);
  });

  it("eth_sendRawTransaction proxies a 0x-prefixed raw tx", async () => {
    harness.stubNextBroadcast("0xdeadbeef");
    const rawTx = "0x02ef01";
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_sendRawTransaction",
      params: [rawTx],
    });
    expect(res.payload.result).toBe("0xdeadbeef");

    const calls = harness.recordedRpcCalls().filter((c) => c.method === "eth_sendRawTransaction");
    expect(calls).toHaveLength(1);
    expect((calls[0].params as [string])[0]).toBe(rawTx);
  });

  it("eth_sendRawTransaction rejects non-0x input with -32602", async () => {
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_sendRawTransaction",
      params: ["not-hex"],
    });
    expect(res.payload.error?.code).toBe(-32602);
  });

  it("unknown methods return spec-compliant -32601", async () => {
    const res = await harness.sendMessage("rpc-request", {
      method: "unicorn_pony_dance",
      params: [],
    });
    expect(res.payload.error?.code).toBe(-32601);
    expect(res.payload.error?.message).toMatch(/Unknown method/);
  });

  it("malformed params (non-array, non-object) yield -32602", async () => {
    const res = await harness.sendMessage("rpc-request", {
      method: "eth_blockNumber",
      params: "bad",
    });
    expect(res.payload.error?.code).toBe(-32602);
  });

  it("every KNOWN_METHODS read-only method is routable", async () => {
    // The integration test surface proves the dispatcher covers these.
    const readOnly: Array<{ method: string; params: unknown[] }> = [
      { method: "eth_chainId", params: [] },
      { method: "net_version", params: [] },
      { method: "eth_blockNumber", params: [] },
      { method: "eth_getBalance", params: [harness.getKnownAccounts()[0].address, "latest"] },
      { method: "eth_getTransactionCount", params: [harness.getKnownAccounts()[0].address, "pending"] },
      { method: "eth_gasPrice", params: [] },
      { method: "eth_feeHistory", params: ["0x1", "latest", [50]] },
      { method: "eth_maxPriorityFeePerGas", params: [] },
      { method: "eth_call", params: [{ to: "0xcafe" }, "latest"] },
      { method: "eth_getCode", params: ["0x0000000000000000000000000000000000000001", "latest"] },
      { method: "eth_getBlockByNumber", params: ["latest", false] },
      // NB: eth_getLogs not covered — see dedicated "known bug" test above.
      { method: "eth_getTransactionByHash", params: ["0x" + "11".repeat(32)] },
      { method: "eth_getTransactionReceipt", params: ["0x" + "11".repeat(32)] },
      { method: "eth_estimateGas", params: [{ from: harness.getKnownAccounts()[0].address, to: "0xcafe" }] },
      { method: "eth_accounts", params: [] },
      // eth_requestAccounts is interactive (per-origin consent) — covered by
      // the dedicated approval tests above, not this read-only routability list.
    ];

    for (const req of readOnly) {
      const res = await harness.sendMessage("rpc-request", req);
      expect(res.payload.error, `unexpected error for ${req.method}`).toBeUndefined();
    }
  });
});
