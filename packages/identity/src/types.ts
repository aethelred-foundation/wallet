import type { WorkspaceKind, WorkspaceRole, SubjectSummary, WorkspaceSummary } from "@aethelred/wallet-connect";

export interface Subject {
  id: string;
  displayName: string;
  kind: "person" | "service" | "agent";
  email?: string;
  workspaceIds: string[];
  credentialIds: string[];
  createdAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  summary: string;
  memberIds: string[];
  accountIds: string[];
  policyBundleId: string;
  createdAt: number;
}

export interface RoleAssignment {
  id: string;
  subjectId: string;
  workspaceId: string;
  role: WorkspaceRole;
  grantedAt: number;
  grantedBy: string;
}

export interface Credential {
  id: string;
  subjectId: string;
  type: "password" | "passkey" | "hardware" | "certificate" | "verifiable";
  label: string;
  issuedAt: number;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export interface Organization {
  id: string;
  name: string;
  workspaceIds: string[];
  adminSubjectIds: string[];
  createdAt: number;
}

export interface ServiceIdentity {
  id: string;
  name: string;
  workspaceId: string;
  permissions: string[];
  createdAt: number;
}

export interface AgentIdentity {
  id: string;
  name: string;
  parentSubjectId: string;
  workspaceId: string;
  capabilities: string[];
  createdAt: number;
}

export function toSubjectSummary(subject: Subject): SubjectSummary {
  return {
    id: subject.id,
    displayName: subject.displayName,
    kind: subject.kind === "agent" ? "service" : subject.kind,
  };
}

export function toWorkspaceSummary(
  workspace: Workspace,
  role: WorkspaceRole
): WorkspaceSummary {
  return {
    id: workspace.id,
    name: workspace.name,
    kind: workspace.kind,
    role,
    summary: workspace.summary,
  };
}
