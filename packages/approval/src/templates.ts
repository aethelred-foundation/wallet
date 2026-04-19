import type { ApprovalTemplate } from "./types";

/**
 * Built-in approval templates for each workspace kind.
 * In Phase 2+, these will be authorable through the Elixir admin control-plane.
 */

export const personalApprovalTemplate: ApprovalTemplate = {
  id: "template-personal-default",
  name: "Personal default",
  description: "Single-reviewer approval for personal operations",
  workspaceKind: "personal",
  quorum: { type: "any-one" },
  reviewerRoles: ["owner"],
  expiryMinutes: 30,
};

export const enterpriseStandardTemplate: ApprovalTemplate = {
  id: "template-enterprise-standard",
  name: "Enterprise standard",
  description: "Single reviewer with timeout escalation",
  workspaceKind: "enterprise",
  quorum: { type: "any-one" },
  escalation: {
    trigger: "timeout",
    timeoutMinutes: 60,
    escalateToRole: "owner",
    maxEscalations: 2,
    currentLevel: 0,
  },
  reviewerRoles: ["treasury-admin", "owner"],
  expiryMinutes: 120,
};

export const enterpriseHighValueTemplate: ApprovalTemplate = {
  id: "template-enterprise-high-value",
  name: "Enterprise high-value",
  description: "Majority approval required for high-value operations",
  workspaceKind: "enterprise",
  quorum: { type: "majority" },
  escalation: {
    trigger: "timeout",
    timeoutMinutes: 30,
    escalateToRole: "owner",
    maxEscalations: 1,
    currentLevel: 0,
  },
  reviewerRoles: ["treasury-admin", "compliance-reviewer", "owner"],
  expiryMinutes: 240,
};

export const sovereignDualControlTemplate: ApprovalTemplate = {
  id: "template-sovereign-dual-control",
  name: "Sovereign dual control",
  description: "Unanimous approval from two independent reviewers",
  workspaceKind: "sovereign",
  quorum: { type: "threshold", threshold: 2 },
  escalation: {
    trigger: "timeout",
    timeoutMinutes: 15,
    escalateToRole: "owner",
    maxEscalations: 3,
    currentLevel: 0,
  },
  reviewerRoles: ["treasury-admin", "compliance-reviewer", "owner"],
  expiryMinutes: 60,
};

export const sovereignCommitteeTemplate: ApprovalTemplate = {
  id: "template-sovereign-committee",
  name: "Sovereign committee",
  description: "Full committee approval in sequential order",
  workspaceKind: "sovereign",
  quorum: { type: "sequential" },
  reviewerRoles: ["operator", "treasury-admin", "compliance-reviewer", "owner"],
  expiryMinutes: 480,
};

export function getApprovalTemplate(
  workspaceKind: string,
  isHighValue = false
): ApprovalTemplate {
  switch (workspaceKind) {
    case "sovereign":
      return isHighValue ? sovereignCommitteeTemplate : sovereignDualControlTemplate;
    case "enterprise":
      return isHighValue ? enterpriseHighValueTemplate : enterpriseStandardTemplate;
    default:
      return personalApprovalTemplate;
  }
}

export const ALL_TEMPLATES: ApprovalTemplate[] = [
  personalApprovalTemplate,
  enterpriseStandardTemplate,
  enterpriseHighValueTemplate,
  sovereignDualControlTemplate,
  sovereignCommitteeTemplate,
];
