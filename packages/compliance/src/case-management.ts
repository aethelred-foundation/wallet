import type { InvestigationCase, CaseStatus, CasePriority, CaseNote, EvidenceItem, EvidenceChain, ComplianceOfficer } from "./enterprise-types";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

function generateId(prefix: string): string {
  return `${prefix}-${crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
}

/**
 * Enterprise case management for compliance investigations.
 * Handles case lifecycle, evidence chains, investigator assignment,
 * escalation, law enforcement referral, and resolution workflows.
 */
export class CaseManager {
  private cases = new Map<string, InvestigationCase>();
  private officers = new Map<string, ComplianceOfficer>();

  registerOfficer(officer: ComplianceOfficer): void {
    this.officers.set(officer.id, officer);
  }

  createCase(opts: {
    title: string;
    description: string;
    workspaceId: string;
    sourceScreeningIds: string[];
    sourceAlertIds: string[];
    suspectedActivity: string[];
    totalExposureUsd: number;
    priority: CasePriority;
    riskLevel: InvestigationCase["riskLevel"];
  }): InvestigationCase {
    const caseId = generateId("case");
    const investigationCase: InvestigationCase = {
      id: caseId,
      title: opts.title,
      description: opts.description,
      workspaceId: opts.workspaceId,
      sourceScreeningIds: opts.sourceScreeningIds,
      sourceAlertIds: opts.sourceAlertIds,
      investigatorId: "",
      status: "open",
      priority: opts.priority,
      riskLevel: opts.riskLevel,
      suspectedActivity: opts.suspectedActivity,
      totalExposureUsd: opts.totalExposureUsd,
      evidenceChain: { id: generateId("evi"), caseId, items: [], integrityHash: "", lastUpdated: Date.now() },
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      notes: [],
      statusHistory: [{ status: "open", changedAt: Date.now(), changedBy: "system" }],
    };

    this.cases.set(caseId, investigationCase);
    return investigationCase;
  }

  assignCase(caseId: string, investigatorId: string): InvestigationCase {
    const c = this.getCase(caseId);
    const officer = this.officers.get(investigatorId);
    if (officer && officer.activeCaseCount >= officer.maxConcurrentCases) {
      throw new Error(`Investigator ${investigatorId} at max case capacity (${officer.maxConcurrentCases})`);
    }

    c.investigatorId = investigatorId;
    c.assignedAt = Date.now();
    if (officer) officer.activeCaseCount += 1;
    this.transitionStatus(caseId, "assigned", investigatorId);
    return c;
  }

  transitionStatus(caseId: string, newStatus: CaseStatus, changedBy: string, reason?: string): InvestigationCase {
    const c = this.getCase(caseId);
    const validTransitions = this.getValidTransitions(c.status);
    if (!validTransitions.includes(newStatus)) {
      throw new Error(`Invalid transition from ${c.status} to ${newStatus}. Valid: ${validTransitions.join(", ")}`);
    }

    c.statusHistory.push({ status: newStatus, changedAt: Date.now(), changedBy, reason });
    c.status = newStatus;
    c.lastActivityAt = Date.now();

    if (newStatus === "resolved-no-action" || newStatus === "resolved-action-taken" || newStatus === "closed") {
      c.resolvedAt = Date.now();
      const officer = this.officers.get(c.investigatorId);
      if (officer) officer.activeCaseCount = Math.max(0, officer.activeCaseCount - 1);
    }

    return c;
  }

  addEvidence(caseId: string, item: Omit<EvidenceItem, "id" | "chainOfCustody" | "admissible">): EvidenceItem {
    const c = this.getCase(caseId);
    const evidence: EvidenceItem = {
      id: generateId("evi"),
      ...item,
      chainOfCustody: [{ holderId: item.collectedBy, receivedAt: item.collectedAt }],
      admissible: true,
    };

    c.evidenceChain.items.push(evidence);
    c.evidenceChain.lastUpdated = Date.now();
    c.evidenceChain.integrityHash = this.computeChainHash(c.evidenceChain);
    c.lastActivityAt = Date.now();
    return evidence;
  }

  addNote(caseId: string, authorId: string, content: string, isConfidential = false): CaseNote {
    const c = this.getCase(caseId);
    const note: CaseNote = {
      id: generateId("note"),
      authorId,
      content,
      attachments: [],
      createdAt: Date.now(),
      isConfidential,
    };
    c.notes.push(note);
    c.lastActivityAt = Date.now();
    return note;
  }

  resolveCase(caseId: string, resolution: NonNullable<InvestigationCase["resolution"]>): InvestigationCase {
    const c = this.getCase(caseId);
    c.resolution = resolution;
    const newStatus = resolution.outcome === "sar-filed" ? "sar-filed" : resolution.outcome === "law-enforcement-referral" ? "escalated-to-law-enforcement" : "resolved-action-taken";
    return this.transitionStatus(caseId, newStatus, resolution.approvedBy, resolution.rationale);
  }

  referToLawEnforcement(caseId: string, referral: NonNullable<InvestigationCase["lawEnforcementReferral"]>): InvestigationCase {
    const c = this.getCase(caseId);
    c.lawEnforcementReferral = referral;
    return this.transitionStatus(caseId, "escalated-to-law-enforcement", "system", `Referred to ${referral.agencyName}`);
  }

  getCase(id: string): InvestigationCase {
    const c = this.cases.get(id);
    if (!c) throw new Error(`Case not found: ${id}`);
    return c;
  }

  listCases(opts?: { status?: CaseStatus; priority?: CasePriority; investigatorId?: string; workspaceId?: string }): InvestigationCase[] {
    let results = Array.from(this.cases.values());
    if (opts?.status) results = results.filter((c) => c.status === opts.status);
    if (opts?.priority) results = results.filter((c) => c.priority === opts.priority);
    if (opts?.investigatorId) results = results.filter((c) => c.investigatorId === opts.investigatorId);
    if (opts?.workspaceId) results = results.filter((c) => c.workspaceId === opts.workspaceId);
    return results.sort((a, b) => {
      const priorityOrder = { urgent: 0, critical: 1, high: 2, medium: 3, low: 4 };
      return (priorityOrder[a.priority] ?? 5) - (priorityOrder[b.priority] ?? 5);
    });
  }

  getOverdueCases(): InvestigationCase[] {
    const now = Date.now();
    return Array.from(this.cases.values()).filter((c) => c.dueDate && c.dueDate < now && !c.resolvedAt);
  }

  getCaseMetrics(workspaceId?: string): {
    total: number; open: number; inProgress: number; resolved: number; overdue: number;
    avgResolutionDays: number; byPriority: Record<string, number>; byRisk: Record<string, number>;
  } {
    const cases = workspaceId ? this.listCases({ workspaceId }) : Array.from(this.cases.values());
    const resolved = cases.filter((c) => c.resolvedAt);
    const avgDays = resolved.length > 0
      ? resolved.reduce((sum, c) => sum + (c.resolvedAt! - c.createdAt), 0) / resolved.length / 86400000
      : 0;

    return {
      total: cases.length,
      open: cases.filter((c) => c.status === "open").length,
      inProgress: cases.filter((c) => ["assigned", "under-investigation", "evidence-collection", "analysis"].includes(c.status)).length,
      resolved: resolved.length,
      overdue: cases.filter((c) => c.dueDate && c.dueDate < Date.now() && !c.resolvedAt).length,
      avgResolutionDays: Math.round(avgDays),
      byPriority: cases.reduce((acc, c) => { acc[c.priority] = (acc[c.priority] ?? 0) + 1; return acc; }, {} as Record<string, number>),
      byRisk: cases.reduce((acc, c) => { acc[c.riskLevel] = (acc[c.riskLevel] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    };
  }

  private getValidTransitions(current: CaseStatus): CaseStatus[] {
    const transitions: Record<CaseStatus, CaseStatus[]> = {
      "open": ["assigned", "closed"],
      "assigned": ["under-investigation", "closed"],
      "under-investigation": ["evidence-collection", "analysis", "pending-review", "escalated"],
      "evidence-collection": ["analysis", "under-investigation"],
      "analysis": ["pending-review", "evidence-collection"],
      "pending-review": ["resolved-no-action", "resolved-action-taken", "escalated", "sar-filed", "under-investigation"],
      "escalated": ["escalated-to-law-enforcement", "under-investigation", "sar-filed"],
      "escalated-to-law-enforcement": ["resolved-action-taken", "closed"],
      "sar-filed": ["resolved-action-taken", "closed"],
      "resolved-no-action": ["closed"],
      "resolved-action-taken": ["closed"],
      "closed": [],
    };
    return transitions[current] ?? [];
  }

  private computeChainHash(chain: EvidenceChain): string {
    const data = chain.items.map((i) => `${i.id}:${i.contentHash}:${i.collectedAt}`).join("|");
    return bytesToHex(sha256(new TextEncoder().encode(data)));
  }
}
