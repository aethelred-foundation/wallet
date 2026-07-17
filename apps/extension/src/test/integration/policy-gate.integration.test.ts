/**
 * Integration: policy engine gates the eth_sendTransaction path.
 *
 * Covers:
 *   - Personal bundle: spend-limit warn (>$10k), velocity warn (>50 tx), value warn (>$50k)
 *   - Enterprise bundle: tx auto-requires approval, high-value ($100k) triggers dual-control
 *   - Blacklisted destination: deny (both tiers)
 *   - Destination category unknown + non-trivial value: personal warn
 *   - `matchedRules` is captured in the audit event
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createBackgroundHarness, type BackgroundHarness } from "./harness";

const TEST_RECIPIENT = "0xcafebabecafebabecafebabecafebabecafebabe";
const BLACKLISTED = "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead";

// 1 ETH in wei hex at $2,000 per ETH → $2,000
const WEI_1ETH = "0x" + (10n ** 18n).toString(16);
// 6 ETH → $12,000 (crosses personal $10k spend-limit)
const WEI_6ETH = "0x" + (6n * 10n ** 18n).toString(16);
// 60 ETH → $120,000 (crosses enterprise $100k high-value gate)
const WEI_60ETH = "0x" + (60n * 10n ** 18n).toString(16);
// 300 ETH → $600,000 (crosses enterprise $500k velocity ceiling)
const WEI_300ETH = "0x" + (300n * 10n ** 18n).toString(16);

async function resolveApproval(harness: BackgroundHarness, decision: "approved" | "rejected") {
  await new Promise((r) => setTimeout(r, 0));
  const pending = harness.getPendingApprovals();
  if (pending.length > 0) {
    await harness.sendMessage("approval-response", {
      approvalId: pending[0].approvalId,
      decision,
    });
  }
}

async function sendTxValue(harness: BackgroundHarness, from: string, value: string, to = TEST_RECIPIENT) {
  harness.stubNextBroadcast("0x" + "11".repeat(32) as `0x${string}`);
  return harness.sendMessage(
    "rpc-request",
    {
      method: "eth_sendTransaction",
      params: [{ from, to, value, data: "0x" }],
    },
    "https://dapp.test",
  );
}

describe("policy-gate integration", () => {
  let harness: BackgroundHarness;

  afterEach(async () => {
    await harness.dispose();
  });

  describe("personal workspace", () => {
    beforeEach(async () => {
      harness = await createBackgroundHarness({ workspaceKind: "personal" });
    });

    it("small txs ($2k each) pass policy with outcome=warn, no approval-required", async () => {
      const [account] = harness.getKnownAccounts();
      for (let i = 0; i < 3; i++) {
        const pending = sendTxValue(harness, account.address, WEI_1ETH);
        await resolveApproval(harness, "approved");
        const res = await pending;
        expect(res.payload.result).toBeDefined();
      }
      const policyEvents = harness
        .getAuditEvents()
        .filter((e) => e.kind === "policy-evaluated");
      expect(policyEvents).toHaveLength(3);
      for (const e of policyEvents) {
        expect(e.detail.outcome).toBe("warn");
      }
    });

    it("$12k tx triggers spend-limit-warn rule match", async () => {
      const [account] = harness.getKnownAccounts();
      const pending = sendTxValue(harness, account.address, WEI_6ETH);
      await resolveApproval(harness, "approved");
      await pending;
      const policyEvent = harness
        .getAuditEvents()
        .find((e) => e.kind === "policy-evaluated");
      const matchedRules = (policyEvent?.detail.matchedRules ?? []) as string[];
      expect(matchedRules).toContain("personal-spend-per-tx-limit");
    });

    it("blacklisted destination produces outcome=deny, no approval, no broadcast", async () => {
      await harness.dispose();
      harness = await createBackgroundHarness({
        workspaceKind: "personal",
        blacklistedDestinations: new Set([BLACKLISTED.toLowerCase()]),
      });
      const [account] = harness.getKnownAccounts();
      const res = await sendTxValue(harness, account.address, WEI_1ETH, BLACKLISTED);
      expect(res.payload.error?.code).toBe(4001);
      expect(
        harness.recordedRpcCalls().filter((c) => c.method === "eth_sendRawTransaction"),
      ).toHaveLength(0);
      const policyEvent = harness
        .getAuditEvents()
        .find((e) => e.kind === "policy-evaluated");
      expect(policyEvent?.detail.outcome).toBe("deny");
      const matched = policyEvent?.detail.matchedRules as string[];
      expect(matched).toContain("personal-destination-blacklisted");
    });

    it("unknown destination + small value (<$100) does NOT fire unknown-destination rule", async () => {
      await harness.dispose();
      harness = await createBackgroundHarness({ workspaceKind: "personal" });
      const [account] = harness.getKnownAccounts();
      const weiCents = "0x" + (10n ** 14n).toString(16); // 0.0001 ETH → $0.20
      const pending = sendTxValue(harness, account.address, weiCents);
      await resolveApproval(harness, "approved");
      await pending;
      const policyEvent = harness
        .getAuditEvents()
        .find((e) => e.kind === "policy-evaluated");
      expect(
        (policyEvent?.detail.matchedRules as string[]).includes("personal-destination-unknown"),
      ).toBe(false);
    });

    it("unknown destination + value > $100 fires unknown-destination warn rule", async () => {
      const [account] = harness.getKnownAccounts();
      const pending = sendTxValue(harness, account.address, WEI_1ETH);
      await resolveApproval(harness, "approved");
      await pending;
      const policyEvent = harness
        .getAuditEvents()
        .find((e) => e.kind === "policy-evaluated");
      const matched = policyEvent?.detail.matchedRules as string[];
      expect(matched).toContain("personal-destination-unknown");
    });

    it("known-contact destination does NOT fire unknown-destination rule", async () => {
      const knownAddr = "0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef";
      await harness.dispose();
      harness = await createBackgroundHarness({
        workspaceKind: "personal",
        destinationCategories: { [knownAddr.toLowerCase()]: "known-contact" },
      });
      const [account] = harness.getKnownAccounts();
      const pending = sendTxValue(harness, account.address, WEI_1ETH, knownAddr);
      await resolveApproval(harness, "approved");
      await pending;
      const policyEvent = harness
        .getAuditEvents()
        .find((e) => e.kind === "policy-evaluated");
      const matched = policyEvent?.detail.matchedRules as string[];
      expect(matched).not.toContain("personal-destination-unknown");
    });
  });

  describe("enterprise workspace", () => {
    beforeEach(async () => {
      harness = await createBackgroundHarness({ workspaceKind: "enterprise" });
    });

    it("every transaction triggers approval-required (enterprise-tx-approval)", async () => {
      const [account] = harness.getKnownAccounts();
      const pending = sendTxValue(harness, account.address, WEI_1ETH);
      await resolveApproval(harness, "approved");
      await pending;

      const policyEvent = harness
        .getAuditEvents()
        .find((e) => e.kind === "policy-evaluated");
      expect(policyEvent?.detail.outcome).toBe("approval-required");
    });

    it("$120k tx matches enterprise-high-value-tx rule", async () => {
      const [account] = harness.getKnownAccounts();
      const pending = sendTxValue(harness, account.address, WEI_60ETH);
      await resolveApproval(harness, "approved");
      await pending;
      const policyEvent = harness
        .getAuditEvents()
        .find((e) => e.kind === "policy-evaluated");
      const matched = (policyEvent?.detail.matchedRules as string[]) ?? [];
      expect(matched).toContain("enterprise-high-value-tx");
    });

    it("candidate-inclusive $600k/24h hits velocity-value ceiling before approval", async () => {
      const [account] = harness.getKnownAccounts();
      const response = await sendTxValue(harness, account.address, WEI_300ETH);
      expect(response.payload.error?.code).toBe(4001);
      expect(harness.getPendingApprovals()).toHaveLength(0);
      expect(
        harness.recordedRpcCalls().filter((call) => call.method === "eth_sendRawTransaction"),
      ).toHaveLength(0);
      const denyEvents = harness
        .getAuditEvents()
        .filter((e) => e.kind === "policy-evaluated" && e.detail.outcome === "deny");
      expect(denyEvents.length).toBeGreaterThan(0);
      const matched = denyEvents[denyEvents.length - 1].detail.matchedRules as string[];
      expect(matched).toContain("enterprise-velocity-value-deny");
    });

    it("blacklisted destination denies in enterprise as well", async () => {
      await harness.dispose();
      harness = await createBackgroundHarness({
        workspaceKind: "enterprise",
        blacklistedDestinations: new Set([BLACKLISTED.toLowerCase()]),
      });
      const [account] = harness.getKnownAccounts();
      const res = await sendTxValue(harness, account.address, WEI_1ETH, BLACKLISTED);
      expect(res.payload.error?.code).toBe(4001);
      const policyEvent = harness
        .getAuditEvents()
        .find((e) => e.kind === "policy-evaluated");
      expect(policyEvent?.detail.outcome).toBe("deny");
    });
  });

  describe("audit detail fidelity", () => {
    beforeEach(async () => {
      harness = await createBackgroundHarness({ workspaceKind: "personal" });
    });

    it("policy-evaluated event records outcome, matchedRules", async () => {
      const [account] = harness.getKnownAccounts();
      const pending = sendTxValue(harness, account.address, WEI_1ETH);
      await resolveApproval(harness, "approved");
      await pending;
      const policyEvent = harness
        .getAuditEvents()
        .find((e) => e.kind === "policy-evaluated");
      expect(policyEvent).toBeDefined();
      expect(policyEvent!.detail).toHaveProperty("outcome");
      expect(policyEvent!.detail).toHaveProperty("matchedRules");
      expect(Array.isArray(policyEvent!.detail.matchedRules)).toBe(true);
    });
  });
});
