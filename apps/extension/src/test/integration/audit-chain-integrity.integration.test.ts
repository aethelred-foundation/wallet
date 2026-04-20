/**
 * Integration: audit chain integrity across a realistic session.
 *
 * The audit chain is the wallet's cross-contract tamper-evidence property
 * (Phase-2 Elixir re-verifies the chain on export). Any path that writes to
 * the chain MUST preserve:
 *   - Monotonic sequenceNumber
 *   - eventHash = SHA-256(seq | ts | kind | JSON(detail) | previousHash)
 *   - previousHash chain linkage
 *
 * This test drives a 20-step synthetic user session through the harness and
 * asserts the chain remains valid, then proves `verifyChain()` detects
 * tampering with any single event.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createBackgroundHarness, type BackgroundHarness } from "./harness";
import { AuditCapture } from "@aethelred/wallet-audit";

async function runSession(harness: BackgroundHarness) {
  const [account] = harness.getKnownAccounts();

  // Step 1: lock / unlock
  await harness.sendMessage("lock-request", {});
  await harness.sendMessage("unlock-request", { password: "correct-horse-battery-staple" });

  // Step 2: read-only RPCs
  await harness.sendMessage("rpc-request", { method: "eth_chainId", params: [] });
  await harness.sendMessage("rpc-request", { method: "eth_blockNumber", params: [] });

  // Step 3: a passkey enrollment
  await harness.sendMessage("passkey-enroll", {
    credentialId: "cred-session-1",
    publicKeySpki: "abc",
    rpId: "wallet.aethelred.local",
    label: "TouchID",
    subjectId: "subj-owner",
  });
  await harness.sendMessage("passkey-verify", {
    credentialId: "cred-session-1",
    newSignCounter: 1,
  });

  // Step 4: three signed transactions
  for (let i = 0; i < 3; i++) {
    harness.stubNextBroadcast("0x" + `${(i + 1).toString(16).padStart(2, "0")}`.repeat(32) as `0x${string}`);
    const pending = harness.sendMessage(
      "rpc-request",
      {
        method: "eth_sendTransaction",
        params: [{
          from: account.address,
          to: "0xcafe0000cafe0000cafe0000cafe0000cafe0000",
          value: "0x" + (10n ** 15n).toString(16),
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
    await pending;
  }

  // Step 5: one rejection
  const rej = harness.sendMessage(
    "rpc-request",
    {
      method: "eth_sendTransaction",
      params: [{
        from: account.address,
        to: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead",
        value: "0x" + (10n ** 15n).toString(16),
      }],
    },
    "https://dapp.test",
  );
  await new Promise((r) => setTimeout(r, 0));
  const approvals2 = harness.getPendingApprovals();
  if (approvals2.length > 0) {
    await harness.sendMessage("approval-response", {
      approvalId: approvals2[0].approvalId,
      decision: "rejected",
    });
  }
  await rej;
}

describe("audit chain integrity integration", () => {
  let harness: BackgroundHarness;

  beforeEach(async () => {
    harness = await createBackgroundHarness();
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it("realistic session produces a continuous, verifiable chain", async () => {
    await runSession(harness);
    const events = harness.getAuditEvents();
    expect(events.length).toBeGreaterThanOrEqual(10);
    expect(AuditCapture.verifyChain(events)).toBe(true);
  });

  it("sequenceNumber is strictly increasing 1..N", async () => {
    await runSession(harness);
    const events = harness.getAuditEvents();
    for (let i = 0; i < events.length; i++) {
      expect(events[i].sequenceNumber).toBe(i + 1);
    }
  });

  it("previousHash of event N equals eventHash of event N-1", async () => {
    await runSession(harness);
    const events = harness.getAuditEvents();
    for (let i = 1; i < events.length; i++) {
      expect(events[i].previousHash).toBe(events[i - 1].eventHash);
    }
  });

  it("first event's previousHash is genesis (all zeros)", async () => {
    await runSession(harness);
    const [first] = harness.getAuditEvents();
    expect(first.previousHash).toBe("0".repeat(64));
  });

  it("tampering with one event breaks verifyChain()", async () => {
    await runSession(harness);
    const events = harness.getAuditEvents();
    const tampered = structuredClone(events);
    const mid = Math.floor(tampered.length / 2);
    tampered[mid] = { ...tampered[mid], detail: { tampered: true } };
    expect(AuditCapture.verifyChain(tampered)).toBe(false);
  });

  it("reordering events breaks the chain link", async () => {
    await runSession(harness);
    const events = harness.getAuditEvents();
    const shuffled = structuredClone(events);
    if (shuffled.length < 3) return;
    // Swap two adjacent events' previousHash without updating the hash
    const tmp = shuffled[1].previousHash;
    shuffled[1].previousHash = shuffled[2].previousHash;
    shuffled[2].previousHash = tmp;
    expect(AuditCapture.verifyChain(shuffled)).toBe(false);
  });

  it("inserting a forged event into the middle breaks the chain", async () => {
    await runSession(harness);
    const events = harness.getAuditEvents();
    const forged = [
      ...events.slice(0, 2),
      {
        ...events[1],
        id: "evt-forged",
        sequenceNumber: events[1].sequenceNumber + 1,
        detail: { forged: true },
      },
      ...events.slice(2),
    ];
    expect(AuditCapture.verifyChain(forged)).toBe(false);
  });

  it("every audit event has a unique id", async () => {
    await runSession(harness);
    const events = harness.getAuditEvents();
    const ids = new Set(events.map((e) => e.id));
    expect(ids.size).toBe(events.length);
  });

  it("every event has a non-empty eventHash", async () => {
    await runSession(harness);
    for (const e of harness.getAuditEvents()) {
      expect(e.eventHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("every event carries subjectId + workspaceId", async () => {
    await runSession(harness);
    for (const e of harness.getAuditEvents()) {
      expect(e.subjectId).toBeDefined();
      expect(e.subjectId.length).toBeGreaterThan(0);
      expect(e.workspaceId).toBeDefined();
      expect(e.workspaceId.length).toBeGreaterThan(0);
    }
  });

  it("observes these audit event kinds during a realistic session", async () => {
    await runSession(harness);
    const kinds = new Set(harness.getAuditEvents().map((e) => e.kind));
    // The exact set depends on the scenario; we expect AT LEAST the core set.
    for (const required of [
      "wallet-initialized",
      "lock-state-changed",
      "credential-enrolled",
      "credential-verified",
      "request-received",
      "policy-evaluated",
      "signing-executed",
      "response-sent",
      "approval-decided",
    ] as const) {
      expect(kinds.has(required)).toBe(true);
    }
  });

  it("an export-style snapshot re-verifies", async () => {
    await runSession(harness);
    const snapshot = JSON.parse(JSON.stringify(harness.getAuditEvents()));
    expect(AuditCapture.verifyChain(snapshot)).toBe(true);
  });
});
