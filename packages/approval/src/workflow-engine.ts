import type {
  ApprovalRequest,
  ApprovalDecision,
  ApprovalStatus,
  ApprovalTemplate,
  ApprovalContext,
  SpendLimit,
} from "./types";
import type { WorkspaceRole } from "@aethelred/wallet-connect";

function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `apr-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * WorkflowEngine manages the complete approval lifecycle.
 * In Phase 0-1: runs locally in the extension.
 * In Phase 2+: Elixir approval-router wraps the same logic with
 * persistent storage, push notifications, and multi-device support.
 */
export class WorkflowEngine {
  private requests = new Map<string, ApprovalRequest>();
  private spendLimits = new Map<string, SpendLimit>();
  private readonly listeners: Array<(request: ApprovalRequest) => void> = [];

  createRequest(opts: {
    title: string;
    summary: string;
    workspaceId: string;
    requesterId: string;
    appId: string;
    appOrigin: string;
    intentId: string;
    intentKind: string;
    template: ApprovalTemplate;
    reviewers: Array<{ subjectId: string; displayName: string; role: WorkspaceRole }>;
    context: ApprovalContext;
  }): ApprovalRequest {
    const request: ApprovalRequest = {
      id: generateId(),
      title: opts.title,
      summary: opts.summary,
      workspaceId: opts.workspaceId,
      requesterId: opts.requesterId,
      appId: opts.appId,
      appOrigin: opts.appOrigin,
      intentId: opts.intentId,
      intentKind: opts.intentKind,
      quorum: opts.template.quorum,
      reviewers: opts.reviewers.map((r) => ({
        ...r,
        assignedAt: Date.now(),
      })),
      decisions: [],
      escalation: opts.template.escalation,
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + opts.template.expiryMinutes * 60 * 1000,
      context: opts.context,
    };

    this.requests.set(request.id, request);
    this.notify(request);
    return request;
  }

  submitDecision(
    requestId: string,
    decision: Omit<ApprovalDecision, "timestamp">
  ): ApprovalRequest {
    const request = this.requests.get(requestId);
    if (!request) throw new Error(`Approval request not found: ${requestId}`);
    if (request.status !== "pending" && request.status !== "escalated") {
      throw new Error(`Cannot submit decision for ${request.status} request`);
    }

    // Check reviewer is assigned
    const isAssigned = request.reviewers.some((r) => r.subjectId === decision.reviewerId);
    if (!isAssigned) {
      throw new Error(`Reviewer ${decision.reviewerId} is not assigned to this request`);
    }

    // Check for duplicate decisions
    const alreadyDecided = request.decisions.some((d) => d.reviewerId === decision.reviewerId);
    if (alreadyDecided) {
      throw new Error(`Reviewer ${decision.reviewerId} has already submitted a decision`);
    }

    request.decisions.push({
      ...decision,
      timestamp: Date.now(),
    });

    // Evaluate quorum
    request.status = this.evaluateQuorum(request);

    if (request.status === "approved" || request.status === "rejected") {
      request.resolvedAt = Date.now();
    }

    // Handle escalation on rejection
    if (
      request.status === "rejected" &&
      request.escalation &&
      request.escalation.trigger === "rejection" &&
      request.escalation.currentLevel < request.escalation.maxEscalations
    ) {
      request.status = "escalated";
      request.escalation.currentLevel += 1;
      request.escalatedAt = Date.now();
    }

    this.notify(request);
    return request;
  }

  cancelRequest(requestId: string): void {
    const request = this.requests.get(requestId);
    if (request && request.status === "pending") {
      request.status = "cancelled";
      request.resolvedAt = Date.now();
      this.notify(request);
    }
  }

  getRequest(id: string): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  listPending(workspaceId?: string): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter(
      (r) =>
        (r.status === "pending" || r.status === "escalated") &&
        (!workspaceId || r.workspaceId === workspaceId)
    );
  }

  listAll(workspaceId?: string): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter(
      (r) => !workspaceId || r.workspaceId === workspaceId
    );
  }

  // Check and expire timed-out requests
  checkExpiry(): ApprovalRequest[] {
    const now = Date.now();
    const expired: ApprovalRequest[] = [];

    for (const request of this.requests.values()) {
      if (request.status === "pending" && request.expiresAt < now) {
        // Check for timeout escalation
        if (
          request.escalation?.trigger === "timeout" &&
          request.escalation.currentLevel < request.escalation.maxEscalations
        ) {
          request.status = "escalated";
          request.escalation.currentLevel += 1;
          request.escalatedAt = now;
        } else {
          request.status = "expired";
          request.resolvedAt = now;
        }
        expired.push(request);
        this.notify(request);
      }
    }

    return expired;
  }

  // Spend limit management
  setSpendLimit(limit: SpendLimit): void {
    this.spendLimits.set(limit.id, limit);
  }

  checkSpendLimit(
    workspaceId: string,
    asset: string,
    amount: string
  ): { allowed: boolean; requiresApproval: boolean; reason?: string } {
    const limit = Array.from(this.spendLimits.values()).find(
      (l) => l.workspaceId === workspaceId && l.asset === asset
    );

    if (!limit) return { allowed: true, requiresApproval: false };

    const amountNum = parseFloat(amount);
    const maxPerTx = parseFloat(limit.maxAmountPerTransaction);
    const maxDaily = parseFloat(limit.maxAmountPerDay);
    const approvalThreshold = parseFloat(limit.requiresApprovalAbove);
    const currentDaily = parseFloat(limit.currentDailySpend);

    if (amountNum > maxPerTx) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Amount ${amount} exceeds per-transaction limit of ${limit.maxAmountPerTransaction} ${asset}`,
      };
    }

    if (currentDaily + amountNum > maxDaily) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Would exceed daily spend limit of ${limit.maxAmountPerDay} ${asset}`,
      };
    }

    if (amountNum > approvalThreshold) {
      return {
        allowed: true,
        requiresApproval: true,
        reason: `Amount ${amount} exceeds approval threshold of ${limit.requiresApprovalAbove} ${asset}`,
      };
    }

    return { allowed: true, requiresApproval: false };
  }

  onRequestUpdate(listener: (request: ApprovalRequest) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  private evaluateQuorum(request: ApprovalRequest): ApprovalStatus {
    const approvals = request.decisions.filter((d) => d.decision === "approved");
    const rejections = request.decisions.filter((d) => d.decision === "rejected");
    const total = request.reviewers.length;

    switch (request.quorum.type) {
      case "any-one":
        if (approvals.length >= 1) return "approved";
        if (rejections.length >= 1) return "rejected";
        return "pending";

      case "majority":
        if (approvals.length > total / 2) return "approved";
        if (rejections.length > total / 2) return "rejected";
        return "pending";

      case "unanimous":
        if (approvals.length === total) return "approved";
        if (rejections.length > 0) return "rejected";
        return "pending";

      case "threshold": {
        const required = request.quorum.threshold ?? 1;
        if (approvals.length >= required) return "approved";
        const remaining = total - request.decisions.length;
        if (approvals.length + remaining < required) return "rejected";
        return "pending";
      }

      case "sequential": {
        // Must be approved in order of assignment
        for (let i = 0; i < request.decisions.length; i++) {
          if (request.decisions[i].decision === "rejected") return "rejected";
        }
        if (request.decisions.length === total) return "approved";
        return "pending";
      }

      default:
        return "pending";
    }
  }

  private notify(request: ApprovalRequest): void {
    for (const listener of this.listeners) {
      try { listener(request); } catch { /* listeners must not break */ }
    }
  }

  loadFromSnapshot(requests: ApprovalRequest[], limits: SpendLimit[]): void {
    this.requests.clear();
    for (const r of requests) this.requests.set(r.id, r);
    this.spendLimits.clear();
    for (const l of limits) this.spendLimits.set(l.id, l);
  }

  toSnapshot(): { requests: ApprovalRequest[]; limits: SpendLimit[] } {
    return {
      requests: Array.from(this.requests.values()),
      limits: Array.from(this.spendLimits.values()),
    };
  }
}
