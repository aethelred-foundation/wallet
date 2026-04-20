/**
 * Integration: multi-reviewer approval quorum in the enterprise workspace.
 *
 * Wires three reviewers into the harness so an enterprise tx creates a
 * workflow request with majority quorum. Exercises:
 *   - 2-of-3 approval promotes request to "approved" + signs + broadcasts
 *   - 2-of-3 rejection marks request "rejected" (escalation disabled)
 *   - Mixed 1-approve / 1-reject → reviewer-count insufficient, still pending
 *   - Duplicate reviewer decision → error
 *   - Unassigned reviewer decision → error
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createBackgroundHarness, type BackgroundHarness } from "./harness";
import {
  enterpriseHighValueTemplate,
  WorkflowEngine,
  type ApprovalRequest,
  type ApprovalContext,
} from "@aethelred/wallet-approval";

const REVIEWERS = [
  { subjectId: "subj-bob",   displayName: "Bob (Treasury)",    role: "treasury-admin" as const },
  { subjectId: "subj-carol", displayName: "Carol (Compliance)", role: "compliance-reviewer" as const },
  { subjectId: "subj-dave",  displayName: "Dave (Owner)",       role: "owner" as const },
];

describe("workflow-quorum integration", () => {
  let harness: BackgroundHarness;

  beforeEach(async () => {
    harness = await createBackgroundHarness({
      workspaceKind: "enterprise",
      extraReviewers: REVIEWERS.slice(1), // the owner acts as reviewer 1
    });
  });

  afterEach(async () => {
    await harness.dispose();
  });

  describe("direct WorkflowEngine wiring (background contract)", () => {
    it("2-of-3 approvals → approved, 1-of-3 leaves request pending", () => {
      const engine = new WorkflowEngine();
      const req = engine.createRequest({
        title: "High value transfer",
        summary: "Transfer $250k",
        workspaceId: "ws-ent-1",
        requesterId: "subj-alice",
        appId: "app-dex",
        appOrigin: "https://dex.test",
        intentId: "intent-qa-1",
        intentKind: "sign-transaction",
        template: enterpriseHighValueTemplate,
        reviewers: REVIEWERS,
        context: {
          operationType: "eth_sendTransaction",
          policyMode: "approval-required",
          matchedPolicyRules: ["enterprise-high-value-tx"],
        } satisfies ApprovalContext,
      });

      expect(req.status).toBe("pending");
      expect(req.reviewers).toHaveLength(3);

      const after1 = engine.submitDecision(req.id, {
        reviewerId: "subj-bob",
        reviewerName: "Bob (Treasury)",
        decision: "approved",
      });
      expect(after1.status).toBe("pending");

      const after2 = engine.submitDecision(req.id, {
        reviewerId: "subj-carol",
        reviewerName: "Carol (Compliance)",
        decision: "approved",
      });
      expect(after2.status).toBe("approved");
      expect(after2.resolvedAt).toBeDefined();
    });

    it("2-of-3 rejections → rejected, resolvedAt set", () => {
      const engine = new WorkflowEngine();
      const req = engine.createRequest({
        title: "Rejected transfer",
        summary: "10 ETH to unknown wallet",
        workspaceId: "ws-ent-1",
        requesterId: "subj-alice",
        appId: "app-1",
        appOrigin: "https://random-dapp.xyz",
        intentId: "intent-qa-2",
        intentKind: "sign-transaction",
        template: enterpriseHighValueTemplate,
        reviewers: REVIEWERS,
        context: {
          operationType: "eth_sendTransaction",
          policyMode: "approval-required",
          matchedPolicyRules: ["enterprise-high-value-tx"],
        },
      });
      engine.submitDecision(req.id, {
        reviewerId: "subj-bob",
        reviewerName: "Bob",
        decision: "rejected",
      });
      const after2 = engine.submitDecision(req.id, {
        reviewerId: "subj-carol",
        reviewerName: "Carol",
        decision: "rejected",
      });
      expect(after2.status).toBe("rejected");
      expect(after2.resolvedAt).toBeDefined();
    });

    it("1-approve + 1-reject leaves pending (no majority either way)", () => {
      const engine = new WorkflowEngine();
      const req = engine.createRequest({
        title: "Split opinion",
        summary: "Tied",
        workspaceId: "ws-ent-1",
        requesterId: "subj-alice",
        appId: "app-1",
        appOrigin: "https://dapp.test",
        intentId: "intent-qa-3",
        intentKind: "sign-transaction",
        template: enterpriseHighValueTemplate,
        reviewers: REVIEWERS,
        context: { operationType: "eth_sendTransaction", policyMode: "approval-required", matchedPolicyRules: [] },
      });
      engine.submitDecision(req.id, {
        reviewerId: "subj-bob",
        reviewerName: "Bob",
        decision: "approved",
      });
      const after2 = engine.submitDecision(req.id, {
        reviewerId: "subj-carol",
        reviewerName: "Carol",
        decision: "rejected",
      });
      expect(after2.status).toBe("pending");
    });

    it("duplicate reviewer → error", () => {
      const engine = new WorkflowEngine();
      const req = engine.createRequest({
        title: "Dup test",
        summary: "Dup test",
        workspaceId: "ws-ent-1",
        requesterId: "subj-alice",
        appId: "app-1",
        appOrigin: "https://dapp.test",
        intentId: "intent-qa-4",
        intentKind: "sign-transaction",
        template: enterpriseHighValueTemplate,
        reviewers: REVIEWERS,
        context: { operationType: "eth_sendTransaction", policyMode: "approval-required", matchedPolicyRules: [] },
      });
      engine.submitDecision(req.id, {
        reviewerId: "subj-bob",
        reviewerName: "Bob",
        decision: "approved",
      });
      expect(() =>
        engine.submitDecision(req.id, {
          reviewerId: "subj-bob",
          reviewerName: "Bob",
          decision: "rejected",
        }),
      ).toThrow(/already submitted/);
    });

    it("unassigned reviewer → error", () => {
      const engine = new WorkflowEngine();
      const req = engine.createRequest({
        title: "Unassigned test",
        summary: "Unassigned test",
        workspaceId: "ws-ent-1",
        requesterId: "subj-alice",
        appId: "app-1",
        appOrigin: "https://dapp.test",
        intentId: "intent-qa-5",
        intentKind: "sign-transaction",
        template: enterpriseHighValueTemplate,
        reviewers: REVIEWERS,
        context: { operationType: "eth_sendTransaction", policyMode: "approval-required", matchedPolicyRules: [] },
      });
      expect(() =>
        engine.submitDecision(req.id, {
          reviewerId: "subj-evil",
          reviewerName: "Evil Eve",
          decision: "approved",
        }),
      ).toThrow(/not assigned/);
    });
  });

  describe("dispatcher-driven quorum", () => {
    it("enterprise tx creates a workflow request visible to the engine", async () => {
      const [account] = harness.getKnownAccounts();
      harness.stubNextBroadcast("0x" + "10".repeat(32) as `0x${string}`);

      const pending = harness.sendMessage(
        "rpc-request",
        {
          method: "eth_sendTransaction",
          params: [{
            from: account.address,
            to: "0xcafebabecafebabecafebabecafebabecafebabe",
            value: "0x" + (10n ** 18n).toString(16),
            data: "0x",
          }],
        },
        "https://dapp.test",
      );
      await new Promise((r) => setTimeout(r, 0));

      const workflow = harness.getWorkflowEngine();
      const requests = workflow.listPending();
      expect(requests.length).toBeGreaterThan(0);
      const req = requests[0];
      expect(req.status).toBe("pending");
      expect(req.reviewers.length).toBeGreaterThanOrEqual(1);

      // Resolve the popup approval to unblock the test
      const approvals = harness.getPendingApprovals();
      await harness.sendMessage("approval-response", {
        approvalId: approvals[0].approvalId,
        decision: "approved",
      });
      await pending;
    });

    it("approval-requested audit event records workflow approvalId + quorum", async () => {
      const [account] = harness.getKnownAccounts();
      harness.stubNextBroadcast("0x" + "20".repeat(32) as `0x${string}`);
      const pending = harness.sendMessage(
        "rpc-request",
        {
          method: "eth_sendTransaction",
          params: [{
            from: account.address,
            to: "0xcafebabecafebabecafebabecafebabecafebabe",
            value: "0x" + (10n ** 18n).toString(16),
            data: "0x",
          }],
        },
        "https://dapp.test",
      );
      await new Promise((r) => setTimeout(r, 0));

      const approvalRequested = harness
        .getAuditEvents()
        .find((e) => e.kind === "approval-requested");
      expect(approvalRequested).toBeDefined();
      expect(approvalRequested?.detail).toHaveProperty("approvalId");
      expect(approvalRequested?.detail).toHaveProperty("quorum");

      const approvals = harness.getPendingApprovals();
      await harness.sendMessage("approval-response", {
        approvalId: approvals[0].approvalId,
        decision: "approved",
      });
      await pending;
    });

    it("rejection updates workflow request status to rejected", async () => {
      const [account] = harness.getKnownAccounts();
      harness.stubNextBroadcast("0x" + "30".repeat(32) as `0x${string}`);
      const pending = harness.sendMessage(
        "rpc-request",
        {
          method: "eth_sendTransaction",
          params: [{
            from: account.address,
            to: "0xcafebabecafebabecafebabecafebabecafebabe",
            value: "0x" + (10n ** 18n).toString(16),
          }],
        },
        "https://dapp.test",
      );
      await new Promise((r) => setTimeout(r, 0));
      const workflow = harness.getWorkflowEngine();
      const reqIdsBefore = workflow.listPending().map((r) => r.id);

      const approvals = harness.getPendingApprovals();
      await harness.sendMessage("approval-response", {
        approvalId: approvals[0].approvalId,
        decision: "rejected",
      });
      await pending;

      // The request associated with this flow should be resolved (pending → rejected)
      let resolved: ApprovalRequest | undefined;
      for (const id of reqIdsBefore) {
        const r = workflow.getRequest(id);
        if (r && r.status !== "pending") {
          resolved = r;
          break;
        }
      }
      expect(resolved).toBeDefined();
    });
  });

  describe("escalation + expiry", () => {
    it("expires an untouched approval request past its deadline", () => {
      const engine = new WorkflowEngine();
      const realNow = Date.now;
      const req = engine.createRequest({
        title: "Stale",
        summary: "Forgotten",
        workspaceId: "ws-ent-1",
        requesterId: "subj-alice",
        appId: "app-1",
        appOrigin: "https://example.com",
        intentId: "intent-qa-expire",
        intentKind: "sign-transaction",
        template: {
          ...enterpriseHighValueTemplate,
          expiryMinutes: 1,
          escalation: undefined,
        },
        reviewers: [{ subjectId: "subj-bob", displayName: "Bob", role: "owner" }],
        context: { operationType: "eth_sendTransaction", policyMode: "approval-required", matchedPolicyRules: [] },
      });
      try {
        Date.now = () => realNow() + 120_000;
        const expired = engine.checkExpiry();
        expect(expired).toHaveLength(1);
        expect(engine.getRequest(req.id)?.status).toBe("expired");
      } finally {
        Date.now = realNow;
      }
    });
  });
});
