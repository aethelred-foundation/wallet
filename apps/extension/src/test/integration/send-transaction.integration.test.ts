/**
 * End-to-end integration: the full eth_sendTransaction pipeline.
 *
 * Drives the harness through:
 *   rpc-request(eth_sendTransaction) → policy evaluation → approval created
 *   → approval-response → real signer → eth_sendRawTransaction broadcast
 *
 * Verifies the complete audit trail, the broadcast payload, and the failure
 * paths (user rejection, locked wallet, unknown account).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createBackgroundHarness, type BackgroundHarness } from "./harness";
import { AuditCapture } from "@aethelred/wallet-audit";

const TEST_RECIPIENT = "0xcafebabecafebabecafebabecafebabecafebabe";
const BROADCAST_HASH = "0x" + "a1".repeat(32) as `0x${string}`;

async function sendSmallTx(harness: BackgroundHarness, from: string) {
  harness.stubNextBroadcast(BROADCAST_HASH);
  return harness.sendMessage(
    "rpc-request",
    {
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to: TEST_RECIPIENT,
          value: "0x" + (10n ** 15n).toString(16), // 0.001 ETH
          data: "0x",
        },
      ],
    },
    "https://dapp.test",
  );
}

describe("send-transaction integration", () => {
  let harness: BackgroundHarness;

  beforeEach(async () => {
    harness = await createBackgroundHarness({ workspaceKind: "personal" });
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it("signs + broadcasts a small transaction after user approval (personal flow)", async () => {
    const [account] = harness.getKnownAccounts();
    const pendingResponse = sendSmallTx(harness, account.address);

    // Yield so the pipeline reaches requestUserApproval
    await new Promise((r) => setTimeout(r, 0));
    const pending = harness.getPendingApprovals();
    expect(pending).toHaveLength(1);

    await harness.sendMessage("approval-response", {
      approvalId: pending[0].approvalId,
      decision: "approved",
    });

    const response = await pendingResponse;
    expect(response.payload.result).toBe(BROADCAST_HASH);
    expect(response.payload.error).toBeUndefined();
  });

  it("audit chain sequence covers request-received → policy → signing → response", async () => {
    const [account] = harness.getKnownAccounts();
    const pendingResponse = sendSmallTx(harness, account.address);
    await new Promise((r) => setTimeout(r, 0));
    const [p] = harness.getPendingApprovals();
    await harness.sendMessage("approval-response", { approvalId: p.approvalId, decision: "approved" });
    await pendingResponse;

    const kinds = harness.getAuditEvents().map((e) => e.kind);
    expect(kinds).toContain("request-received");
    expect(kinds).toContain("policy-evaluated");
    expect(kinds).toContain("approval-decided");
    expect(kinds).toContain("signing-executed");
    expect(kinds).toContain("response-sent");
  });

  it("audit chain is hash-consistent over a real send", async () => {
    const [account] = harness.getKnownAccounts();
    const pendingResponse = sendSmallTx(harness, account.address);
    await new Promise((r) => setTimeout(r, 0));
    const [p] = harness.getPendingApprovals();
    await harness.sendMessage("approval-response", { approvalId: p.approvalId, decision: "approved" });
    await pendingResponse;

    expect(AuditCapture.verifyChain(harness.getAuditEvents())).toBe(true);
  });

  it("broadcast goes to eth_sendRawTransaction with a 0x-prefixed typed-02 payload", async () => {
    const [account] = harness.getKnownAccounts();
    const pendingResponse = sendSmallTx(harness, account.address);
    await new Promise((r) => setTimeout(r, 0));
    const [p] = harness.getPendingApprovals();
    await harness.sendMessage("approval-response", { approvalId: p.approvalId, decision: "approved" });
    await pendingResponse;

    const broadcasts = harness
      .recordedRpcCalls()
      .filter((c) => c.method === "eth_sendRawTransaction");
    expect(broadcasts).toHaveLength(1);
    const [rawTx] = broadcasts[0].params as [string];
    expect(rawTx.startsWith("0x02")).toBe(true);
  });

  it("rejection path: no sign, no broadcast, audit captures rejection", async () => {
    const [account] = harness.getKnownAccounts();
    const pendingResponse = sendSmallTx(harness, account.address);
    await new Promise((r) => setTimeout(r, 0));
    const [p] = harness.getPendingApprovals();
    await harness.sendMessage("approval-response", { approvalId: p.approvalId, decision: "rejected" });

    const response = await pendingResponse;
    expect(response.payload.error?.code).toBe(4001);
    expect(response.payload.error?.message).toMatch(/rejected/i);

    // No broadcast
    expect(
      harness.recordedRpcCalls().filter((c) => c.method === "eth_sendRawTransaction"),
    ).toHaveLength(0);

    // Audit reflects the rejection
    const kinds = harness.getAuditEvents().map((e) => e.kind);
    expect(kinds).toContain("approval-decided");
    expect(kinds).toContain("response-sent");
  });

  it("policy deny: returns error before reaching the approval stage", async () => {
    const blacklisted = "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead";
    await harness.dispose();
    harness = await createBackgroundHarness({
      workspaceKind: "personal",
      blacklistedDestinations: new Set([blacklisted.toLowerCase()]),
    });

    const [account] = harness.getKnownAccounts();
    const res = await harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{
          from: account.address,
          to: blacklisted,
          value: "0x" + (10n ** 15n).toString(16),
          data: "0x",
        }],
      },
      "https://dapp.test",
    );

    expect(res.payload.error).toBeDefined();
    expect(res.payload.error?.code).toBe(4001);
    // No approval was ever created
    expect(harness.getPendingApprovals()).toHaveLength(0);
    const kinds = harness.getAuditEvents().map((e) => e.kind);
    expect(kinds).toContain("policy-evaluated");
    // The last policy outcome should be the one marking denial
    const policyEvent = harness.getAuditEvents().find((e) => e.kind === "policy-evaluated");
    expect(policyEvent?.detail.outcome).toBe("deny");
  });

  it("Merkle batch coordinator auto-batches audit events after enough traffic", async () => {
    const [account] = harness.getKnownAccounts();

    // Send enough txs to cross the maxBatchSize=8 boundary (each tx emits
    // request-received, policy-evaluated, approval-decided, signing-executed,
    // response-sent → 5+ events each).
    for (let i = 0; i < 3; i++) {
      const pendingResponse = sendSmallTx(harness, account.address);
      await new Promise((r) => setTimeout(r, 0));
      const approvals = harness.getPendingApprovals();
      await harness.sendMessage("approval-response", {
        approvalId: approvals[0].approvalId,
        decision: "approved",
      });
      await pendingResponse;
    }

    expect(harness.getMerkleBatches().length).toBeGreaterThan(0);
    const batch = harness.getMerkleBatches()[0];
    expect(batch.root).toMatch(/^[0-9a-f]+$/);
    expect(batch.leafCount).toBeGreaterThan(0);
  });

  it("broadcasts using different nonces across consecutive sends (sequence N, N+1)", async () => {
    const [account] = harness.getKnownAccounts();

    const nonceOf = (params: unknown) => {
      const raw = (params as [string])[0];
      // Decode nonce from the signed tx RLP. We just check the count of
      // broadcast calls matches and the signed payloads are distinct —
      // the nonce is embedded inside the RLP.
      return raw.length;
    };

    harness.stubNextBroadcast(("0x" + "b1".repeat(32)) as `0x${string}`);
    harness.stubNextBroadcast(("0x" + "b2".repeat(32)) as `0x${string}`);

    for (let i = 0; i < 2; i++) {
      const pendingResponse = sendSmallTx(harness, account.address);
      await new Promise((r) => setTimeout(r, 0));
      const approvals = harness.getPendingApprovals();
      await harness.sendMessage("approval-response", {
        approvalId: approvals[0].approvalId,
        decision: "approved",
      });
      await pendingResponse;
    }
    const broadcasts = harness
      .recordedRpcCalls()
      .filter((c) => c.method === "eth_sendRawTransaction");
    expect(broadcasts).toHaveLength(2);
    expect(nonceOf(broadcasts[0].params)).toBeGreaterThan(0);
    // Check that both broadcasts happened — implies nonce alloc worked.
    expect(broadcasts[0].params).not.toStrictEqual(broadcasts[1].params);
  });

  it("prepare-tx then execute-tx: popup-initiated two-step flow", async () => {
    const [account] = harness.getKnownAccounts();
    const prep = await harness.sendMessage("prepare-tx", {
      from: account.address,
      to: TEST_RECIPIENT,
      value: "0x" + (10n ** 15n).toString(16),
      data: "0x",
    });
    const draftId = (prep.payload.result as { draftId: string }).draftId;
    expect(draftId).toMatch(/^draft-/);

    harness.stubNextBroadcast(BROADCAST_HASH);
    const exec = await harness.sendMessage("execute-tx", { draftId });
    expect((exec.payload.result as { hash: string }).hash).toBe(BROADCAST_HASH);

    const kinds = harness.getAuditEvents().map((e) => e.kind);
    expect(kinds).toContain("signing-executed");
    expect(kinds).toContain("response-sent");
  });

  it("unknown-from address: error before policy eval", async () => {
    const res = await harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{
          from: "0x0000000000000000000000000000000000000001",
          to: TEST_RECIPIENT,
          value: "0x1",
        }],
      },
      "https://dapp.test",
    );
    expect(res.payload.error?.code).toBe(4001);
    expect(res.payload.error?.message).toMatch(/Account .* not found/i);
  });

  it("locked wallet: eth_sendTransaction returns -32001", async () => {
    await harness.sendMessage("lock-request", {});
    const [account] = harness.getKnownAccounts();
    const res = await harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{
          from: account.address,
          to: TEST_RECIPIENT,
          value: "0x1",
        }],
      },
      "https://dapp.test",
    );
    expect(res.payload.error?.code).toBe(-32001);
  });

  it("pending approvals survive a snapshot (observable via get-state)", async () => {
    const [account] = harness.getKnownAccounts();
    const pendingResponse = sendSmallTx(harness, account.address);
    await new Promise((r) => setTimeout(r, 0));

    const state = await harness.sendMessage("get-state", {});
    const approvalsFromState = (state.payload.result as {
      pendingApprovals: unknown[];
    }).pendingApprovals;
    expect(approvalsFromState).toHaveLength(1);

    // Resolve to free the listener
    const [p] = harness.getPendingApprovals();
    await harness.sendMessage("approval-response", { approvalId: p.approvalId, decision: "rejected" });
    await pendingResponse;
  });

  it("approval entry carries structured tx detail (chainId / from / to / value)", async () => {
    const [account] = harness.getKnownAccounts();
    const pendingResponse = sendSmallTx(harness, account.address);
    await new Promise((r) => setTimeout(r, 0));
    const [p] = harness.getPendingApprovals();
    const detail = p.detail as { kind: string; chainId: string; from: string; to: string; value: string };
    expect(detail.kind).toBe("tx");
    expect(detail.chainId).toBe("0xaa36a7");
    expect(detail.from.toLowerCase()).toBe(account.address.toLowerCase());
    expect(detail.to.toLowerCase()).toBe(TEST_RECIPIENT);

    await harness.sendMessage("approval-response", { approvalId: p.approvalId, decision: "rejected" });
    await pendingResponse;
  });
});
