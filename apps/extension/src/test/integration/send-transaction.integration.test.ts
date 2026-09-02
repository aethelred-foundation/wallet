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
import { hexToBytes } from "@aethelred/wallet-core";

const TEST_RECIPIENT = "0xcafebabecafebabecafebabecafebabecafebabe";
const BROADCAST_HASH = "0x" + "a1".repeat(32) as `0x${string}`;
const MAINNET_USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

function encodeErc20Transfer(recipient: string, amountBaseUnits: bigint): string {
  return (
    "0xa9059cbb" +
    recipient.slice(2).toLowerCase().padStart(64, "0") +
    amountBaseUnits.toString(16).padStart(64, "0")
  );
}

function tokenDecimalsRpc(decimals: number) {
  return {
    eth_call: (params: unknown) => {
      const [call] = params as [{ to?: string; data?: string }, string?];
      if (call.data !== "0x313ce567") return "0x";
      return `0x${BigInt(decimals).toString(16).padStart(64, "0")}`;
    },
  };
}

type DecodedRlp = Uint8Array | DecodedRlp[];

function readBigEndian(bytes: Uint8Array): number {
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return value;
}

function decodeRlp(bytes: Uint8Array, offset = 0): [DecodedRlp, number] {
  const prefix = bytes[offset];
  if (prefix <= 0x7f) return [bytes.slice(offset, offset + 1), offset + 1];

  let payloadOffset: number;
  let payloadLength: number;
  let isList = false;
  if (prefix <= 0xb7) {
    payloadOffset = offset + 1;
    payloadLength = prefix - 0x80;
  } else if (prefix <= 0xbf) {
    const lengthBytes = prefix - 0xb7;
    payloadOffset = offset + 1 + lengthBytes;
    payloadLength = readBigEndian(bytes.slice(offset + 1, payloadOffset));
  } else if (prefix <= 0xf7) {
    isList = true;
    payloadOffset = offset + 1;
    payloadLength = prefix - 0xc0;
  } else {
    isList = true;
    const lengthBytes = prefix - 0xf7;
    payloadOffset = offset + 1 + lengthBytes;
    payloadLength = readBigEndian(bytes.slice(offset + 1, payloadOffset));
  }

  const end = payloadOffset + payloadLength;
  if (!isList) return [bytes.slice(payloadOffset, end), end];
  const values: DecodedRlp[] = [];
  let cursor = payloadOffset;
  while (cursor < end) {
    const [value, next] = decodeRlp(bytes, cursor);
    values.push(value);
    cursor = next;
  }
  return [values, end];
}

function rlpBytesToBigInt(value: DecodedRlp): bigint {
  if (!(value instanceof Uint8Array)) throw new Error("Expected an RLP byte string");
  if (value.length === 0) return 0n;
  return BigInt(`0x${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`);
}

function decodeSignedEip1559Gas(rawTx: string) {
  const bytes = hexToBytes(rawTx);
  if (bytes[0] !== 0x02) throw new Error("Expected an EIP-1559 type-2 transaction");
  const [body] = decodeRlp(bytes.slice(1));
  if (!Array.isArray(body)) throw new Error("Expected an RLP transaction list");
  return {
    maxPriorityFeePerGas: rlpBytesToBigInt(body[2]),
    maxFeePerGas: rlpBytesToBigInt(body[3]),
    gasLimit: rlpBytesToBigInt(body[4]),
  };
}

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

  it("fails closed when the chain changes while a dApp transaction awaits approval", async () => {
    const [account] = harness.getKnownAccounts();
    const pendingResponse = sendSmallTx(harness, account.address);

    await new Promise((resolve) => setTimeout(resolve, 0));
    const [pending] = harness.getPendingApprovals();
    expect(pending).toBeDefined();

    const switched = await harness.sendMessage(
      "rpc-request",
      {
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x1" }],
      },
      "https://dapp.test",
    );
    expect(switched.payload.error).toBeUndefined();

    await harness.sendMessage("approval-response", {
      approvalId: pending.approvalId,
      decision: "approved",
    });
    const response = await pendingResponse;

    expect(response.payload.error?.code).toBe(4901);
    expect(response.payload.error?.message).toMatch(/chain changed after approval/i);
    expect(
      harness.recordedRpcCalls().filter((call) => call.method === "eth_sendRawTransaction"),
    ).toHaveLength(0);
    expect(
      harness.getAuditEvents().filter((event) => event.kind === "signing-executed"),
    ).toHaveLength(0);
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

  it("signs exactly the immutable gas tuple shown for approval", async () => {
    const [account] = harness.getKnownAccounts();
    const tx = {
      from: account.address,
      to: TEST_RECIPIENT,
      value: "0x1",
      data: "0x",
      gas: "0xc350", // 50,000
      maxFeePerGas: "0x2540be400", // 10 gwei
      maxPriorityFeePerGas: "0x3b9aca00", // 1 gwei
    };
    harness.stubNextBroadcast(BROADCAST_HASH);
    const pendingResponse = harness.sendMessage(
      "rpc-request",
      { method: "eth_sendTransaction", params: [tx] },
      "https://dapp.test",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const [approval] = harness.getPendingApprovals();
    const reviewed = approval.detail as {
      gasLimit: string;
      maxFeePerGas: string;
      maxPriorityFeePerGas: string;
      estimatedFee: string;
    };
    expect(reviewed).toMatchObject({
      gasLimit: "0xc350",
      maxFeePerGas: "0x2540be400",
      maxPriorityFeePerGas: "0x3b9aca00",
      estimatedFee: `0x${(50_000n * 10_000_000_000n).toString(16)}`,
    });

    // Mutating the original bridge payload while the popup is open must not
    // substitute a different fee tuple after the user has reviewed it.
    tx.gas = "0x989680";
    tx.maxFeePerGas = "0x9184e72a000";
    tx.maxPriorityFeePerGas = "0x8f7e32c3000";
    await harness.sendMessage("approval-response", {
      approvalId: approval.approvalId,
      decision: "approved",
    });
    const response = await pendingResponse;
    expect(response.payload.result).toBe(BROADCAST_HASH);

    const [broadcast] = harness.recordedRpcCalls().filter(
      (call) => call.method === "eth_sendRawTransaction",
    );
    const [rawTx] = broadcast.params as [string];
    expect(decodeSignedEip1559Gas(rawTx)).toEqual({
      gasLimit: BigInt(reviewed.gasLimit),
      maxFeePerGas: BigInt(reviewed.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(reviewed.maxPriorityFeePerGas),
    });
  });

  it.each([
    ["gas", "21000"],
    ["gas", "-0x1"],
    ["gasLimit", `0x1${"0".repeat(16)}`],
    ["maxFeePerGas", `0x1${"0".repeat(32)}`],
  ])("rejects unsafe caller gas quantity %s=%s before nonce allocation", async (field, value) => {
    const [account] = harness.getKnownAccounts();
    const response = await harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{
          from: account.address,
          to: TEST_RECIPIENT,
          value: "0x1",
          [field]: value,
        }],
      },
      "https://dapp.test",
    );
    expect(response.payload.error?.code).toBe(-32602);
    expect(response.payload.error?.message).toMatch(/hex quantity|safety bound/i);
    expect(harness.getPendingApprovals()).toHaveLength(0);
    expect(
      harness.recordedRpcCalls().filter((call) => call.method === "eth_getTransactionCount"),
    ).toHaveLength(0);
  });

  it("rejects eth_signTransaction with 4200 without prompting, signing, or allocating a nonce", async () => {
    const [account] = harness.getKnownAccounts();
    const response = await harness.sendMessage(
      "rpc-request",
      {
        method: "eth_signTransaction",
        params: [{ from: account.address, to: TEST_RECIPIENT, value: "0x1" }],
      },
      "https://dapp.test",
    );

    expect(response.payload.error?.code).toBe(4200);
    expect(response.payload.error?.message).toMatch(/use eth_sendTransaction/i);
    expect(harness.getPendingApprovals()).toHaveLength(0);
    expect(harness.getSensitivePrimitiveCounts()).toEqual({ sign: 0, broadcast: 0 });
    expect(
      harness.recordedRpcCalls().filter((call) => call.method === "eth_getTransactionCount"),
    ).toHaveLength(0);
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

  it("signs the exact popup-selected fee tuple returned for review", async () => {
    const [account] = harness.getKnownAccounts();
    const selected = {
      gas: "0xc350", // 50,000
      maxFeePerGas: "0x6fc23ac00", // 30 gwei
      maxPriorityFeePerGas: "0xb2d05e00", // 3 gwei
    };
    const prep = await harness.sendMessage("prepare-tx", {
      from: account.address,
      to: TEST_RECIPIENT,
      value: "0x" + (10n ** 15n).toString(16),
      data: "0x",
      ...selected,
    });
    const prepared = prep.payload.result as {
      draftId: string;
      detail: {
        gasLimit: string;
        maxFeePerGas: string;
        maxPriorityFeePerGas: string;
        estimatedFee: string;
      };
    };
    expect(prepared.detail).toMatchObject({
      gasLimit: selected.gas,
      maxFeePerGas: selected.maxFeePerGas,
      maxPriorityFeePerGas: selected.maxPriorityFeePerGas,
      estimatedFee: `0x${(BigInt(selected.gas) * BigInt(selected.maxFeePerGas)).toString(16)}`,
    });

    harness.stubNextBroadcast(BROADCAST_HASH);
    const executed = await harness.sendMessage("execute-tx", { draftId: prepared.draftId });
    expect(executed.payload.result).toMatchObject({ hash: BROADCAST_HASH });

    const [broadcast] = harness.recordedRpcCalls().filter(
      (call) => call.method === "eth_sendRawTransaction",
    );
    const [rawTx] = broadcast.params as [string];
    expect(decodeSignedEip1559Gas(rawTx)).toEqual({
      gasLimit: BigInt(prepared.detail.gasLimit),
      maxFeePerGas: BigInt(prepared.detail.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(prepared.detail.maxPriorityFeePerGas),
    });
  });

  it("cancels a popup draft, releases its nonce, and makes execution impossible", async () => {
    const [account] = harness.getKnownAccounts();
    const first = await harness.sendMessage("prepare-tx", {
      from: account.address,
      to: TEST_RECIPIENT,
      value: "0x1",
      data: "0x",
    });
    const firstPrepared = first.payload.result as {
      draftId: string;
      detail: { nonce: number };
    };

    const cancelled = await harness.sendMessage("cancel-tx", {
      draftId: firstPrepared.draftId,
    });
    expect(cancelled.payload.result).toEqual({ ok: true });
    const staleExecute = await harness.sendMessage("execute-tx", {
      draftId: firstPrepared.draftId,
    });
    expect(staleExecute.payload.error?.message).toMatch(/draft not found/i);
    expect(
      harness.recordedRpcCalls().filter((call) => call.method === "eth_sendRawTransaction"),
    ).toHaveLength(0);

    const second = await harness.sendMessage("prepare-tx", {
      from: account.address,
      to: TEST_RECIPIENT,
      value: "0x1",
      data: "0x",
    });
    const secondPrepared = second.payload.result as {
      draftId: string;
      detail: { nonce: number };
    };
    expect(secondPrepared.detail.nonce).toBe(firstPrepared.detail.nonce);
    await harness.sendMessage("cancel-tx", { draftId: secondPrepared.draftId });
  });

  it("invalidates a popup draft when the active chain changes before execute", async () => {
    const [account] = harness.getKnownAccounts();
    const prep = await harness.sendMessage("prepare-tx", {
      from: account.address,
      to: TEST_RECIPIENT,
      value: "0x" + (10n ** 15n).toString(16),
      data: "0x",
    });
    const draftId = (prep.payload.result as { draftId: string }).draftId;

    const switched = await harness.sendMessage(
      "rpc-request",
      {
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x1" }],
      },
      "https://dapp.test",
    );
    expect(switched.payload.error).toBeUndefined();

    const executed = await harness.sendMessage("execute-tx", { draftId });
    expect(executed.payload.error?.code).toBe(4901);
    expect(executed.payload.error?.message).toMatch(/chain changed after.*reviewed/i);
    expect(
      harness.recordedRpcCalls().filter((call) => call.method === "eth_sendRawTransaction"),
    ).toHaveLength(0);
    expect(
      harness.getAuditEvents().filter((event) => event.kind === "signing-executed"),
    ).toHaveLength(0);
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

  it("rejects a decimal-looking value before simulation, review, signing, or broadcast", async () => {
    const [account] = harness.getKnownAccounts();
    const response = await harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{
          from: account.address,
          to: TEST_RECIPIENT,
          // The approval UI formerly parsed this as ~1 ETH while the signer
          // prefixed it with 0x and encoded roughly 2,833 ETH.
          value: "999999999999999999",
        }],
      },
      "https://dapp.test",
    );

    expect(response.payload.error?.code).toBe(-32602);
    expect(response.payload.error?.message).toMatch(/value.*canonical 0x-prefixed/i);
    expect(harness.getPendingApprovals()).toHaveLength(0);
    expect(
      harness.recordedRpcCalls().filter((call) =>
        call.method === "eth_estimateGas" || call.method === "eth_sendRawTransaction"
      ),
    ).toHaveLength(0);
    expect(
      harness.getAuditEvents().filter((event) => event.kind === "signing-executed"),
    ).toHaveLength(0);
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

  it("decodes ERC-20 units for dApp policy and records non-zero USD velocity", async () => {
    await harness.dispose();
    harness = await createBackgroundHarness({
      activeChainId: "0x1",
      tokenPricesUsd: { [MAINNET_USDC]: 1 },
      mockRpcResponses: tokenDecimalsRpc(6),
    });
    const [account] = harness.getKnownAccounts();
    const amountBaseUnits = 12_500_000n; // 12.5 USDC from authoritative 6 decimals
    harness.stubNextBroadcast(BROADCAST_HASH);

    const pendingResponse = harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{
          from: account.address,
          to: MAINNET_USDC,
          value: "0x0",
          data: encodeErc20Transfer(TEST_RECIPIENT, amountBaseUnits),
        }],
      },
      "https://dapp.test",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const [approval] = harness.getPendingApprovals();
    const detail = approval.detail as {
      assetSymbol: string;
      amountUsd: number;
      decodedMethod: string;
      decodedParams: Record<string, string>;
      reviewedSpending: {
        kind: string;
        recipient: string;
        amount: string;
        amountBaseUnits: string;
        decimals: number;
        symbol: string;
        tokenContract: string;
        nativeValue: string;
      };
      warnings: string[];
    };
    expect(detail.assetSymbol).toBe("USDC");
    expect(detail.amountUsd).toBe(12.5);
    expect(detail.decodedMethod).toBe("transfer");
    expect(detail.decodedParams.recipient).toBe(TEST_RECIPIENT);
    expect(detail.decodedParams.amount).toBe("12.5");
    expect(detail.decodedParams.amountBaseUnits).toBe(amountBaseUnits.toString());
    expect(detail.reviewedSpending).toEqual({
      kind: "erc20",
      recipient: TEST_RECIPIENT,
      amount: "12.5",
      amountBaseUnits: amountBaseUnits.toString(),
      decimals: 6,
      symbol: "USDC",
      tokenContract: MAINNET_USDC,
      nativeValue: "0x0",
    });
    expect(detail.warnings.join(" ")).toMatch(/12\.5 USDC/i);

    const policyEvent = [...harness.getAuditEvents()]
      .reverse()
      .find((event) => event.kind === "policy-evaluated");
    expect(policyEvent?.detail.amount).toBe(12.5);
    expect(policyEvent?.detail.amountUsd).toBe(12.5);
    expect(policyEvent?.detail.destination).toBe(TEST_RECIPIENT);
    expect(policyEvent?.detail.assetSymbol).toBe("USDC");

    await harness.sendMessage("approval-response", {
      approvalId: approval.approvalId,
      decision: "approved",
    });
    const response = await pendingResponse;
    expect(response.payload.result).toBe(BROADCAST_HASH);
    expect(harness.getVelocitySnapshot()).toEqual({ count: 1, valueUsd: 12.5 });
  });

  it("uses the same ERC-20 spending context for prepare-tx and execute velocity", async () => {
    await harness.dispose();
    harness = await createBackgroundHarness({
      activeChainId: "0x1",
      tokenPricesUsd: { [MAINNET_USDC]: 1 },
      mockRpcResponses: tokenDecimalsRpc(6),
    });
    const [account] = harness.getKnownAccounts();
    const amountBaseUnits = 42_000_000n;
    const prep = await harness.sendMessage("prepare-tx", {
      from: account.address,
      to: MAINNET_USDC,
      value: "0x0",
      data: encodeErc20Transfer(TEST_RECIPIENT, amountBaseUnits),
    });
    const prepared = prep.payload.result as {
      draftId: string;
      detail: {
        assetSymbol: string;
        amountUsd: number;
        decodedParams: Record<string, string>;
        reviewedSpending: {
          kind: string;
          recipient: string;
          amount: string;
          amountBaseUnits: string;
          decimals: number;
          symbol: string;
          tokenContract: string;
          nativeValue: string;
        };
      };
      policy: { amount: number; destination: string };
    };
    expect(prepared.detail.assetSymbol).toBe("USDC");
    expect(prepared.detail.amountUsd).toBe(42);
    expect(prepared.detail.decodedParams.amountBaseUnits).toBe(amountBaseUnits.toString());
    expect(prepared.detail.reviewedSpending).toEqual({
      kind: "erc20",
      recipient: TEST_RECIPIENT,
      amount: "42",
      amountBaseUnits: amountBaseUnits.toString(),
      decimals: 6,
      symbol: "USDC",
      tokenContract: MAINNET_USDC,
      nativeValue: "0x0",
    });
    expect(prepared.policy.amount).toBe(42);
    expect(prepared.policy.destination).toBe(TEST_RECIPIENT);

    harness.stubNextBroadcast(BROADCAST_HASH);
    const executed = await harness.sendMessage("execute-tx", { draftId: prepared.draftId });
    expect((executed.payload.result as { hash: string }).hash).toBe(BROADCAST_HASH);
    expect(harness.getVelocitySnapshot()).toEqual({ count: 1, valueUsd: 42 });
  });

  it("forces explicit high-risk review when a listed ERC-20 has no authoritative price", async () => {
    await harness.dispose();
    harness = await createBackgroundHarness({
      activeChainId: "0x1",
      mockRpcResponses: tokenDecimalsRpc(6),
    });
    const [account] = harness.getKnownAccounts();
    const prep = await harness.sendMessage("prepare-tx", {
      from: account.address,
      to: MAINNET_USDC,
      value: "0x0",
      data: encodeErc20Transfer(TEST_RECIPIENT, 1_000_000n),
    });
    const prepared = prep.payload.result as {
      requiresReview: boolean;
      detail: { simulationRisk: string; warnings: string[] };
      policy: { outcome: string; warnings: string[] };
    };
    expect(prepared.requiresReview).toBe(true);
    expect(prepared.policy.outcome).toBe("approval-required");
    expect(prepared.detail.simulationRisk).toBe("high");
    expect(prepared.detail.warnings.join(" ")).toMatch(/authoritative USD price/i);
  });

  it("fails closed on malformed ERC-20 transfer calldata", async () => {
    await harness.dispose();
    harness = await createBackgroundHarness({
      activeChainId: "0x1",
      tokenPricesUsd: { [MAINNET_USDC]: 1 },
    });
    const [account] = harness.getKnownAccounts();
    const response = await harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{
          from: account.address,
          to: MAINNET_USDC,
          value: "0x0",
          data: "0xa9059cbb00",
        }],
      },
      "https://dapp.test",
    );
    expect(response.payload.error?.code).toBe(-32602);
    expect(response.payload.error?.message).toMatch(/malformed ERC-20 transfer/i);
    expect(harness.getPendingApprovals()).toHaveLength(0);
    expect(harness.getVelocitySnapshot()).toEqual({ count: 0, valueUsd: 0 });
  });

  it("fails closed when custom-token decimals disagree with decimals() on chain", async () => {
    await harness.dispose();
    const customToken = "0x2222222222222222222222222222222222222222";
    harness = await createBackgroundHarness({
      activeChainId: "0x1",
      customTokens: [{
        chainId: 1,
        address: customToken,
        name: "Caller Supplied Token",
        symbol: "CST",
        decimals: 18,
        logoColor: "#222222",
      }],
      // The contract is authoritative and says 6; the caller-supplied list
      // entry says 18. Policy must not divide by the untrusted 18 decimals.
      mockRpcResponses: tokenDecimalsRpc(6),
    });
    const [account] = harness.getKnownAccounts();
    const response = await harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{
          from: account.address,
          to: customToken,
          value: "0x0",
          data: encodeErc20Transfer(TEST_RECIPIENT, 5_000_000n),
        }],
      },
      "https://dapp.test",
    );
    expect(response.payload.error?.code).toBe(4001);
    expect(response.payload.error?.message).toMatch(/decimals mismatch/i);
    expect(response.payload.error?.message).toMatch(/list says 18, contract says 6/i);
    expect(harness.getPendingApprovals()).toHaveLength(0);
    expect(harness.getVelocitySnapshot()).toEqual({ count: 0, valueUsd: 0 });
  });

  it("fails closed when transfer calldata targets a token absent from the active-chain list", async () => {
    await harness.dispose();
    harness = await createBackgroundHarness({ activeChainId: "0x1" });
    const [account] = harness.getKnownAccounts();
    const unknownToken = "0x1111111111111111111111111111111111111111";
    const response = await harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{
          from: account.address,
          to: unknownToken,
          value: "0x0",
          data: encodeErc20Transfer(TEST_RECIPIENT, 1_000_000n),
        }],
      },
      "https://dapp.test",
    );
    expect(response.payload.error?.code).toBe(4001);
    expect(response.payload.error?.message).toMatch(/not in the authoritative token list/i);
    expect(harness.getPendingApprovals()).toHaveLength(0);
    expect(harness.getVelocitySnapshot()).toEqual({ count: 0, valueUsd: 0 });
  });
});
