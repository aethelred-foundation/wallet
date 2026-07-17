import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackgroundHarness, type BackgroundHarness } from "./harness";

const RECIPIENT = "0xcafebabecafebabecafebabecafebabecafebabe";
const BLACKLISTED = "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead";
const HALF_ETH = `0x${(5n * 10n ** 17n).toString(16)}`; // $1,000 at harness $2k/ETH

async function approvePending(harness: BackgroundHarness, decision: "approved" | "rejected") {
  await vi.waitFor(() => {
    expect(harness.getPendingApprovals()).toHaveLength(1);
  });
  const [approval] = harness.getPendingApprovals();
  await harness.sendMessage("approval-response", {
    approvalId: approval.approvalId,
    decision,
  });
  return approval;
}

function send(harness: BackgroundHarness, from: string, value = "0x0") {
  return harness.sendMessage(
    "rpc-request",
    {
      method: "eth_sendTransaction",
      params: [{ from, to: RECIPIENT, value, data: "0x" }],
    },
    "https://concurrent.example",
  );
}

describe("atomic velocity reservations", () => {
  let harness: BackgroundHarness;

  afterEach(async () => {
    await harness.dispose();
  });

  it("allows exactly the 200th concurrent operation and blocks the 201st before signing", async () => {
    harness = await createBackgroundHarness({ workspaceKind: "enterprise" });
    await harness.seedVelocity(199, 0);
    const [account] = harness.getKnownAccounts();

    const requests = [send(harness, account.address), send(harness, account.address)];
    await approvePending(harness, "approved");
    const responses = await Promise.all(requests);

    expect(responses.filter((response) => response.payload.result)).toHaveLength(1);
    expect(
      responses.filter((response) => response.payload.error?.code === 4001),
    ).toHaveLength(1);
    expect(
      harness.recordedRpcCalls().filter((call) => call.method === "eth_sendRawTransaction"),
    ).toHaveLength(1);
    expect(await harness.getEffectiveVelocitySnapshot()).toEqual({
      count: 200,
      valueUsd: 0,
    });

    const denial = harness
      .getAuditEvents()
      .find(
        (event) =>
          event.kind === "policy-evaluated" && event.detail.outcome === "deny",
      );
    expect(denial?.detail.matchedRules).toContain(
      "enterprise-velocity-count-deny",
    );
  });

  it("allows exactly $500k cumulative and blocks the concurrent request above it", async () => {
    harness = await createBackgroundHarness({ workspaceKind: "enterprise" });
    await harness.seedVelocity(1, 499_000);
    const [account] = harness.getKnownAccounts();

    const requests = [
      send(harness, account.address, HALF_ETH),
      send(harness, account.address, HALF_ETH),
    ];
    await approvePending(harness, "approved");
    const responses = await Promise.all(requests);

    expect(responses.filter((response) => response.payload.result)).toHaveLength(1);
    expect(
      responses.filter((response) => response.payload.error?.code === 4001),
    ).toHaveLength(1);
    expect(
      harness.recordedRpcCalls().filter((call) => call.method === "eth_sendRawTransaction"),
    ).toHaveLength(1);
    expect(await harness.getEffectiveVelocitySnapshot()).toEqual({
      count: 2,
      valueUsd: 500_000,
    });

    const denial = harness
      .getAuditEvents()
      .find(
        (event) =>
          event.kind === "policy-evaluated" && event.detail.outcome === "deny",
      );
    expect(denial?.detail.matchedRules).toContain(
      "enterprise-velocity-value-deny",
    );
  });

  it("holds popup draft capacity at prepare and revalidates it at execute", async () => {
    harness = await createBackgroundHarness({ workspaceKind: "enterprise" });
    await harness.seedVelocity(199, 0);
    const [account] = harness.getKnownAccounts();
    const payload = {
      from: account.address,
      to: RECIPIENT,
      value: "0x0",
      data: "0x",
    };

    const responses = await Promise.all([
      harness.sendMessage("prepare-tx", payload),
      harness.sendMessage("prepare-tx", payload),
    ]);
    const prepared = responses.find((response) => response.payload.result);
    const denied = responses.find((response) => response.payload.error?.code === 4001);
    expect(prepared).toBeDefined();
    expect(denied).toBeDefined();
    expect(await harness.getEffectiveVelocitySnapshot()).toEqual({
      count: 200,
      valueUsd: 0,
    });

    const draftId = (prepared!.payload.result as { draftId: string }).draftId;
    const executed = await harness.sendMessage("execute-tx", { draftId });
    expect(executed.payload.result).toBeDefined();
    expect(
      harness.recordedRpcCalls().filter((call) => call.method === "eth_sendRawTransaction"),
    ).toHaveLength(1);
    expect(await harness.getEffectiveVelocitySnapshot()).toEqual({
      count: 200,
      valueUsd: 0,
    });
  });

  it("reuses a nonce after a denied popup prepare", async () => {
    harness = await createBackgroundHarness({
      workspaceKind: "enterprise",
      blacklistedDestinations: new Set([BLACKLISTED.toLowerCase()]),
    });
    const [account] = harness.getKnownAccounts();

    const denied = await harness.sendMessage("prepare-tx", {
      from: account.address,
      to: BLACKLISTED,
      value: "0x0",
      data: "0x",
    });
    expect(denied.payload.error?.code).toBe(4001);

    const prepared = await harness.sendMessage("prepare-tx", {
      from: account.address,
      to: RECIPIENT,
      value: "0x0",
      data: "0x",
    });
    const detail = (prepared.payload.result as { detail: { nonce: number } }).detail;
    expect(detail.nonce).toBe(0);
  });

  it("reuses a nonce after dApp approval rejection, before any broadcast attempt", async () => {
    harness = await createBackgroundHarness({ workspaceKind: "enterprise" });
    const [account] = harness.getKnownAccounts();

    const rejectedRequest = send(harness, account.address);
    const firstApproval = await approvePending(harness, "rejected");
    expect((firstApproval.detail as { nonce: number }).nonce).toBe(0);
    expect((await rejectedRequest).payload.error?.code).toBe(4001);

    const approvedRequest = send(harness, account.address);
    const secondApproval = await approvePending(harness, "approved");
    expect((secondApproval.detail as { nonce: number }).nonce).toBe(0);
    expect((await approvedRequest).payload.result).toBeDefined();
  });

  it("claims a popup draft once so concurrent execute cannot rebroadcast its nonce", async () => {
    harness = await createBackgroundHarness({ workspaceKind: "enterprise" });
    const [account] = harness.getKnownAccounts();
    const prepared = await harness.sendMessage("prepare-tx", {
      from: account.address,
      to: RECIPIENT,
      value: "0x0",
      data: "0x",
    });
    const draftId = (prepared.payload.result as { draftId: string }).draftId;

    let finishBroadcast!: (hash: string) => void;
    const broadcastGate = new Promise<string>((resolve) => {
      finishBroadcast = resolve;
    });
    harness.stubRpc("eth_sendRawTransaction", async () => broadcastGate);

    const firstExecute = harness.sendMessage("execute-tx", { draftId });
    await vi.waitFor(() => {
      expect(
        harness.recordedRpcCalls().filter((call) => call.method === "eth_sendRawTransaction"),
      ).toHaveLength(1);
    });
    const secondExecute = await harness.sendMessage("execute-tx", { draftId });
    expect(secondExecute.payload.error?.code).toBe(-32602);

    finishBroadcast(`0x${"77".repeat(32)}`);
    expect((await firstExecute).payload.result).toBeDefined();
    expect(
      harness.recordedRpcCalls().filter((call) => call.method === "eth_sendRawTransaction"),
    ).toHaveLength(1);
  });

  it("retains an ambiguous broadcast attempt across worker restart", async () => {
    harness = await createBackgroundHarness({ workspaceKind: "enterprise" });
    const [account] = harness.getKnownAccounts();
    harness.stubRpc("eth_sendRawTransaction", async () => {
      throw new Error("transport response lost");
    });

    const request = send(harness, account.address, HALF_ETH);
    await approvePending(harness, "approved");
    const response = await request;
    expect(response.payload.error?.code).toBe(-32603);
    expect(await harness.getEffectiveVelocitySnapshot()).toEqual({
      count: 1,
      valueUsd: 1_000,
    });

    await harness.restart();
    expect(await harness.getEffectiveVelocitySnapshot()).toEqual({
      count: 1,
      valueUsd: 1_000,
    });
  }, 15_000);
});
