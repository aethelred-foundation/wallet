/**
 * Approval workflow types.
 * Designed for Elixir approval-router consumption in Phase 2+.
 * All types are JSON-serializable.
 */

import type { WorkspaceRole } from "@aethelred/wallet-connect";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "escalated"
  | "cancelled";

export type QuorumType =
  | "any-one"        // Any single reviewer
  | "majority"       // >50% of assigned reviewers
  | "unanimous"      // All assigned reviewers
  | "threshold"      // N-of-M reviewers
  | "sequential";    // Must be approved in order

export type EscalationTrigger =
  | "timeout"        // Escalate after N minutes
  | "rejection"      // Escalate on rejection
  | "high-value"     // Escalate for high-value operations
  | "policy-flag";   // Escalate when policy flags require it

export interface ApprovalRequest {
  id: string;
  title: string;
  summary: string;
  workspaceId: string;
  requesterId: string;
  appId: string;
  appOrigin: string;
  intentId: string;
  intentKind: string;

  // Quorum configuration
  quorum: QuorumConfig;

  // Assigned reviewers
  reviewers: ReviewerAssignment[];

  // Decisions made so far
  decisions: ApprovalDecision[];

  // Escalation
  escalation?: EscalationConfig;
  escalatedAt?: number;
  escalatedTo?: string;

  // Lifecycle
  status: ApprovalStatus;
  createdAt: number;
  expiresAt: number;
  resolvedAt?: number;

  // Context for the reviewer
  context: ApprovalContext;
}

export interface QuorumConfig {
  type: QuorumType;
  threshold?: number; // For "threshold" type: required approvals
  total?: number;     // For "threshold" type: total reviewers
}

export interface ReviewerAssignment {
  subjectId: string;
  displayName: string;
  role: WorkspaceRole;
  assignedAt: number;
  notifiedAt?: number;
}

export interface ApprovalDecision {
  reviewerId: string;
  reviewerName: string;
  decision: "approved" | "rejected";
  reason?: string;
  timestamp: number;
}

export interface EscalationConfig {
  trigger: EscalationTrigger;
  timeoutMinutes?: number;
  escalateToRole: WorkspaceRole;
  maxEscalations: number;
  currentLevel: number;
}

export interface ApprovalContext {
  // Transaction/operation details
  operationType: string;
  amount?: string;
  asset?: string;
  destination?: string;
  targetContractAddress?: string;
  targetContractLabel?: string;
  targetContractTrust?: "trusted" | "unrecognized" | "unpinned" | "not-applicable";
  appSurface?: string;

  // Risk assessment
  riskLevel?: string;
  riskSignals?: Array<{ title: string; description: string }>;

  // Policy information
  policyMode: string;
  matchedPolicyRules: string[];

  // Simulation summary
  simulationSummary?: string;
}

export interface SpendLimit {
  id: string;
  workspaceId: string;
  asset: string;
  maxAmountPerTransaction: string;
  maxAmountPerDay: string;
  maxAmountPerWeek: string;
  requiresApprovalAbove: string;
  currentDailySpend: string;
  currentWeeklySpend: string;
  lastResetDaily: number;
  lastResetWeekly: number;
}

export interface ApprovalTemplate {
  id: string;
  name: string;
  description: string;
  workspaceKind: string;
  quorum: QuorumConfig;
  escalation?: EscalationConfig;
  reviewerRoles: WorkspaceRole[];
  expiryMinutes: number;
}
