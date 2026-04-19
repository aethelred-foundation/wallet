import type { RegulatoryFiling, FilingStatus, FilingType } from "./enterprise-types";

function generateId(): string {
  return `fil-${crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
}

/**
 * Regulatory filing lifecycle tracker.
 * Manages SAR, CTR, and other regulatory filings from
 * draft through submission, acknowledgment, and audit.
 */
export class FilingTracker {
  private filings = new Map<string, RegulatoryFiling>();

  createFiling(opts: {
    reportId: string;
    type: FilingType;
    jurisdiction: string;
    regulatoryBody: string;
    preparedBy: string;
  }): RegulatoryFiling {
    const filing: RegulatoryFiling = {
      id: generateId(),
      reportId: opts.reportId,
      type: opts.type,
      status: "draft",
      jurisdiction: opts.jurisdiction,
      regulatoryBody: opts.regulatoryBody,
      preparedBy: opts.preparedBy,
      preparedAt: Date.now(),
      submissionMethod: "api",
      filingHistory: [{ status: "draft", timestamp: Date.now(), actor: opts.preparedBy }],
    };

    this.filings.set(filing.id, filing);
    return filing;
  }

  submitForReview(filingId: string, reviewerId: string): RegulatoryFiling {
    return this.transition(filingId, "pending-officer-review", reviewerId);
  }

  approveForSubmission(filingId: string, approverId: string): RegulatoryFiling {
    const filing = this.getFiling(filingId);
    filing.approvedBy = approverId;
    filing.approvedAt = Date.now();
    return this.transition(filingId, "approved", approverId);
  }

  markSubmitted(filingId: string, reference: string, method: RegulatoryFiling["submissionMethod"]): RegulatoryFiling {
    const filing = this.getFiling(filingId);
    filing.submittedAt = Date.now();
    filing.submissionReference = reference;
    filing.submissionMethod = method;
    return this.transition(filingId, "submitted", "system");
  }

  markAcknowledged(filingId: string, acknowledgmentRef: string): RegulatoryFiling {
    const filing = this.getFiling(filingId);
    filing.acknowledgedAt = Date.now();
    filing.acknowledgmentReference = acknowledgmentRef;
    return this.transition(filingId, "acknowledged", "regulator");
  }

  markRejected(filingId: string, reason: string, amendmentDeadline?: number): RegulatoryFiling {
    const filing = this.getFiling(filingId);
    filing.rejectionReason = reason;
    filing.amendmentDeadline = amendmentDeadline;
    return this.transition(filingId, "rejected-by-regulator", "regulator", reason);
  }

  getFiling(id: string): RegulatoryFiling {
    const filing = this.filings.get(id);
    if (!filing) throw new Error(`Filing not found: ${id}`);
    return filing;
  }

  listFilings(opts?: { type?: FilingType; status?: FilingStatus; jurisdiction?: string }): RegulatoryFiling[] {
    let results = Array.from(this.filings.values());
    if (opts?.type) results = results.filter((f) => f.type === opts.type);
    if (opts?.status) results = results.filter((f) => f.status === opts.status);
    if (opts?.jurisdiction) results = results.filter((f) => f.jurisdiction === opts.jurisdiction);
    return results.sort((a, b) => b.preparedAt - a.preparedAt);
  }

  getPendingSubmissions(): RegulatoryFiling[] {
    return this.listFilings({ status: "approved" });
  }

  getOverdueAmendments(): RegulatoryFiling[] {
    const now = Date.now();
    return Array.from(this.filings.values()).filter(
      (f) => f.status === "amendment-required" && f.amendmentDeadline && f.amendmentDeadline < now
    );
  }

  getMetrics(): {
    total: number; draft: number; submitted: number; acknowledged: number;
    rejected: number; byType: Record<string, number>; byJurisdiction: Record<string, number>;
  } {
    const filings = Array.from(this.filings.values());
    return {
      total: filings.length,
      draft: filings.filter((f) => f.status === "draft").length,
      submitted: filings.filter((f) => f.status === "submitted").length,
      acknowledged: filings.filter((f) => f.status === "acknowledged").length,
      rejected: filings.filter((f) => f.status === "rejected-by-regulator").length,
      byType: filings.reduce((acc, f) => { acc[f.type] = (acc[f.type] ?? 0) + 1; return acc; }, {} as Record<string, number>),
      byJurisdiction: filings.reduce((acc, f) => { acc[f.jurisdiction] = (acc[f.jurisdiction] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    };
  }

  private transition(filingId: string, newStatus: FilingStatus, actor: string, notes?: string): RegulatoryFiling {
    const filing = this.getFiling(filingId);
    filing.status = newStatus;
    filing.filingHistory.push({ status: newStatus, timestamp: Date.now(), actor, notes });
    return filing;
  }
}
