/**
 * Integration test for the full enterprise approval + tx flow.
 *
 * Unlike the existing unit tests (policy-rules, eip712, transaction, etc.)
 * which exercise one package in isolation, this test drives the realistic
 * cross-package sequence that handleSendTransaction runs in
 * apps/extension/src/background.ts:
 *
 *   1. policy.evaluate(ctx, bundle)    → `approval-required`
 *   2. getApprovalTemplate(kind, hv)   → `enterpriseHighValueTemplate`
 *   3. workflowEngine.createRequest()  → pending ApprovalRequest
 *   4. audit.record("approval-requested")
 *   5. workflowEngine.submitDecision() × quorum
 *   6. audit.record("approval-decided")
 *   7. audit.record("signing-executed") — stand-in for the real sign path
 *   8. audit.record("response-sent")
 *   9. velocityTracker.recordOperation()
 *  10. AuditCapture.verifyChain(events)  — tamper-evidence still holds
 *
 * This mirrors the exact sequence the background service worker runs when
 * a dApp calls `eth_sendTransaction` against an enterprise workspace with
 * a high-value tx — which is where the biggest GAP integration bugs lived
 * (workflowEngine was dead code; validateRequest was dead code; audit
 * chain verification was never tested end-to-end).
 *
 * The test is hermetic: no chrome.*, no network, no filesystem. It only
 * touches the four @aethelred packages that ship the enterprise flow.
 */

import { describe, it, expect } from "vitest";
import {
  evaluate,
  enterprisePolicyBundle,
  VelocityTracker,
  type PolicyContext,
  type VelocityStorageAdapter,
} from "@aethelred/wallet-policy";
import {
  WorkflowEngine,
  enterpriseHighValueTemplate,
  getApprovalTemplate,
  type ApprovalContext,
} from "@aethelred/wallet-approval";
import { AuditCapture, type AuditEvent } from "@aethelred/wallet-audit";

/** In-memory velocity storage so the tracker doesn't need chrome.storage. */
function memoryVelocityStorage(): VelocityStorageAdapter {
  const buckets = new Map<string, string>();
  return {
    async get(key: string) {
      return buckets.get(key) ?? null;
    },
    async set(key: string, value: string) {
      buckets.set(key, value);
    },
    async delete(key: string) {
      buckets.delete(key);
    },
  };
}

/** Minimal PolicyContext for a high-value eth_sendTransaction in enterprise mode. */
function enterpriseHighValueCtx(): PolicyContext {
  return {
    subject: { id: "subj-alice", role: "operator" },
    workspace: { id: "ws-ent-1", kind: "enterprise" },
    app: { id: "app-uniswap", origin: "https://app.uniswap.org", trustLevel: "first-party" },
    intent: { kind: "sign-transaction", method: "eth_sendTransaction" },
    session: { exists: true },
    account: { id: "acc-1", address: "0x1234567890abcdef1234567890abcdef12345678", namespace: "eip155" },
    amount: 0.5,
    amountUsd: 250_000,
    destination: "0xcafebabecafebabecafebabecafebabecafebabe",
  };
}

describe("Enterprise approval flow integration", () => {
  it("drives policy → template → workflow → audit for a high-value tx", async () => {
    const ctx = enterpriseHighValueCtx();

    /* 1. Policy evaluation — the hook that decides whether we need approval. */
    const policyResult = evaluate(ctx, enterprisePolicyBundle);
    expect(policyResult.outcome).toBe("approval-required");
    expect(policyResult.matchedRules.some((r) => r.id === "enterprise-high-value-tx")).toBe(true);

    /* 2. Template selection — mirrors background.ts's selection logic. */
    const template = getApprovalTemplate("enterprise", true);
    expect(template).toBe(enterpriseHighValueTemplate);
    expect(template.quorum.type).toBe("majority");

    /* 3. Create request with the same ApprovalContext shape background.ts uses. */
    const workflow = new WorkflowEngine();
    const audit = new AuditCapture();
    const capturedEvents: AuditEvent[] = [];
    audit.onEvent((e) => capturedEvents.push(e));

    const approvalContext: ApprovalContext = {
      operationType: "eth_sendTransaction",
      amount: ctx.amount?.toString(),
      asset: "ETH",
      destination: ctx.destination,
      riskLevel: "high",
      policyMode: "enterprise",
      matchedPolicyRules: policyResult.matchedRules.map((r) => r.id),
      simulationSummary: "Transfer 0.5 ETH to 0xcafe…babe",
    };

    const request = workflow.createRequest({
      title: "High-value transfer",
      summary: `Transfer $${ctx.amountUsd!.toLocaleString()} to 0xcafe…babe`,
      workspaceId: ctx.workspace.id,
      requesterId: ctx.subject.id,
      appId: ctx.app.id,
      appOrigin: ctx.app.origin,
      intentId: "intent-001",
      intentKind: "sign-transaction",
      template,
      reviewers: [
        { subjectId: "subj-bob",   displayName: "Bob (Treasury)",    role: "treasury-admin" },
        { subjectId: "subj-carol", displayName: "Carol (Compliance)", role: "compliance-reviewer" },
        { subjectId: "subj-dave",  displayName: "Dave (Owner)",       role: "owner" },
      ],
      context: approvalContext,
    });

    expect(request.status).toBe("pending");
    expect(request.reviewers).toHaveLength(3);
    expect(workflow.listPending(ctx.workspace.id)).toHaveLength(1);

    /* 4. Audit — request received & approval requested (both belong to the same intent). */
    audit.record({
      kind: "request-received",
      subjectId: ctx.subject.id,
      workspaceId: ctx.workspace.id,
      appId: ctx.app.id,
      intentId: "intent-001",
      detail: { method: "eth_sendTransaction", amountUsd: ctx.amountUsd },
    });
    audit.record({
      kind: "policy-evaluated",
      subjectId: ctx.subject.id,
      workspaceId: ctx.workspace.id,
      intentId: "intent-001",
      detail: { outcome: policyResult.outcome, matchedRules: approvalContext.matchedPolicyRules },
    });
    audit.record({
      kind: "approval-requested",
      subjectId: ctx.subject.id,
      workspaceId: ctx.workspace.id,
      intentId: "intent-001",
      detail: { approvalId: request.id, quorum: template.quorum.type },
    });

    /* 5. Quorum — "majority" of 3 means we need 2 approvals. */
    let updated = workflow.submitDecision(request.id, {
      reviewerId: "subj-bob",
      reviewerName: "Bob (Treasury)",
      decision: "approved",
      reason: "Destination is an internal treasury wallet",
    });
    expect(updated.status).toBe("pending"); // only 1/3 — majority not yet reached

    /* Before pushing the quorum over the edge, create a PARALLEL pending
     * request so we can exercise the duplicate-reviewer and unassigned-reviewer
     * guards against a still-pending request. Once a request moves to
     * `approved`, submitDecision() rejects every subsequent call with
     * "Cannot submit decision for approved request" — which would hide the
     * more specific guards we want to prove fire. */
    const parallel = workflow.createRequest({
      title: "Parallel request for guard testing",
      summary: "Used only to assert duplicate + unassigned reviewer guards",
      workspaceId: ctx.workspace.id,
      requesterId: ctx.subject.id,
      appId: ctx.app.id,
      appOrigin: ctx.app.origin,
      intentId: "intent-001b",
      intentKind: "sign-transaction",
      template,
      reviewers: [
        { subjectId: "subj-bob",   displayName: "Bob (Treasury)",    role: "treasury-admin" },
        { subjectId: "subj-carol", displayName: "Carol (Compliance)", role: "compliance-reviewer" },
        { subjectId: "subj-dave",  displayName: "Dave (Owner)",       role: "owner" },
      ],
      context: approvalContext,
    });
    workflow.submitDecision(parallel.id, {
      reviewerId: "subj-bob",
      reviewerName: "Bob (Treasury)",
      decision: "approved",
    });

    /* Duplicate decisions from the same reviewer must fail — prevents double-voting. */
    expect(() =>
      workflow.submitDecision(parallel.id, {
        reviewerId: "subj-bob",
        reviewerName: "Bob (Treasury)",
        decision: "rejected",
      }),
    ).toThrow(/already submitted/);

    /* Unassigned reviewer must fail — prevents a malicious content script from
     * forging a decision by someone who wasn't assigned. */
    expect(() =>
      workflow.submitDecision(parallel.id, {
        reviewerId: "subj-evil",
        reviewerName: "Evil Eve",
        decision: "approved",
      }),
    ).toThrow(/not assigned/);

    /* Now finish the primary request's quorum. */
    updated = workflow.submitDecision(request.id, {
      reviewerId: "subj-carol",
      reviewerName: "Carol (Compliance)",
      decision: "approved",
      reason: "Vendor is on the approved list",
    });
    expect(updated.status).toBe("approved"); // 2/3 → majority
    expect(updated.resolvedAt).toBeDefined();

    /* 6. More audit events — approval decided & signing executed. */
    audit.record({
      kind: "approval-decided",
      subjectId: ctx.subject.id,
      workspaceId: ctx.workspace.id,
      intentId: "intent-001",
      detail: { approvalId: request.id, decision: "approved", approvals: 2, rejections: 0 },
    });
    audit.record({
      kind: "signing-executed",
      subjectId: ctx.subject.id,
      workspaceId: ctx.workspace.id,
      intentId: "intent-001",
      detail: { accountId: ctx.account.id, digestHex: "0xabc…" },
    });
    audit.record({
      kind: "response-sent",
      subjectId: ctx.subject.id,
      workspaceId: ctx.workspace.id,
      intentId: "intent-001",
      detail: { txHash: "0xdeadbeef", status: "broadcast" },
    });

    /* 7. Velocity tracker — enterprise cap is 200 tx / $500k per 24h.
     * Uses the real VelocityTracker contract (subjectId-scoped, 24h
     * sliding window keyed by recordId for idempotency). */
    const velocity = new VelocityTracker(memoryVelocityStorage());
    await velocity.recordOperation({
      recordId: "intent-001",
      subjectId: ctx.subject.id,
      amountUsd: ctx.amountUsd!,
      assetSymbol: "ETH",
    });
    const window = await velocity.getVelocity(ctx.subject.id);
    expect(window.count24h).toBe(1);
    expect(window.valueUsd24h).toBe(250_000);

    /* Idempotency: re-recording the same recordId must NOT double-count. This
     * is the property that lets background.ts retry a failed audit write without
     * inflating velocity — a nasty class of bug in wallets that retry on SW
     * restart. */
    await velocity.recordOperation({
      recordId: "intent-001",
      subjectId: ctx.subject.id,
      amountUsd: ctx.amountUsd!,
      assetSymbol: "ETH",
    });
    const windowAfterRetry = await velocity.getVelocity(ctx.subject.id);
    expect(windowAfterRetry.count24h).toBe(1);

    /* 8. Audit chain integrity — the whole capture trail must hash-verify.
     * This is the tamper-evidence property Phase-2 Elixir will re-verify on
     * export: if ANY event in the chain was edited, verifyChain returns false. */
    expect(capturedEvents).toHaveLength(6);
    expect(AuditCapture.verifyChain(capturedEvents)).toBe(true);

    /* Mutate one event's detail after the fact — chain must now reject. */
    const tampered = structuredClone(capturedEvents);
    tampered[2].detail = { approvalId: "forged", quorum: "any-one" };
    expect(AuditCapture.verifyChain(tampered)).toBe(false);

    /* Primary request is resolved; the parallel guard-testing request is
     * still at 1/3 approvals, so it remains pending. */
    expect(workflow.listPending(ctx.workspace.id)).toHaveLength(1);
    expect(workflow.listAll(ctx.workspace.id)).toHaveLength(2);
    expect(workflow.getRequest(request.id)?.status).toBe("approved");
    expect(workflow.getRequest(parallel.id)?.status).toBe("pending");
  });

  it("rejects a majority-quorum request when the majority votes no", () => {
    const workflow = new WorkflowEngine();
    const template = enterpriseHighValueTemplate;

    const request = workflow.createRequest({
      title: "Rejected transfer",
      summary: "Transfer 10 ETH to unknown wallet",
      workspaceId: "ws-ent-1",
      requesterId: "subj-alice",
      appId: "app-1",
      appOrigin: "https://random-dapp.xyz",
      intentId: "intent-002",
      intentKind: "sign-transaction",
      template,
      reviewers: [
        { subjectId: "subj-bob",   displayName: "Bob",   role: "treasury-admin" },
        { subjectId: "subj-carol", displayName: "Carol", role: "compliance-reviewer" },
        { subjectId: "subj-dave",  displayName: "Dave",  role: "owner" },
      ],
      context: {
        operationType: "eth_sendTransaction",
        policyMode: "enterprise",
        matchedPolicyRules: ["enterprise-unknown-destination"],
      },
    });

    workflow.submitDecision(request.id, {
      reviewerId: "subj-bob",
      reviewerName: "Bob",
      decision: "rejected",
      reason: "Unrecognized destination",
    });
    const after = workflow.submitDecision(request.id, {
      reviewerId: "subj-carol",
      reviewerName: "Carol",
      decision: "rejected",
      reason: "Destination failed KYT screening",
    });

    /* Majority(2/3) rejected — the enterpriseHighValueTemplate has
     * `trigger: "timeout"` escalation (not rejection-based), so the status
     * should stay "rejected" rather than auto-escalating. */
    expect(after.status).toBe("rejected");
    expect(after.resolvedAt).toBeDefined();
  });

  it("expires an untouched approval request after its deadline", () => {
    const workflow = new WorkflowEngine();
    const realNow = Date.now;

    const request = workflow.createRequest({
      title: "Stale",
      summary: "Low-value but forgotten",
      workspaceId: "ws-ent-1",
      requesterId: "subj-alice",
      appId: "app-1",
      appOrigin: "https://example.com",
      intentId: "intent-003",
      intentKind: "sign-transaction",
      template: {
        ...enterpriseHighValueTemplate,
        expiryMinutes: 1,
        escalation: undefined, // disable timeout-escalation for this test
      },
      reviewers: [{ subjectId: "subj-bob", displayName: "Bob", role: "owner" }],
      context: {
        operationType: "eth_sendTransaction",
        policyMode: "enterprise",
        matchedPolicyRules: [],
      },
    });

    try {
      // Advance the clock past the expiry.
      Date.now = () => realNow() + 120_000;
      const expired = workflow.checkExpiry();
      expect(expired).toHaveLength(1);
      expect(workflow.getRequest(request.id)?.status).toBe("expired");
    } finally {
      Date.now = realNow;
    }
  });
});
