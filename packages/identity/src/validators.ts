import type { Subject, Workspace, RoleAssignment, Credential } from "./types";

export function validateSubject(subject: Partial<Subject>): string[] {
  const errors: string[] = [];
  if (!subject.id) errors.push("Subject id is required");
  if (!subject.displayName) errors.push("Subject displayName is required");
  if (!subject.kind) errors.push("Subject kind is required");
  if (subject.kind && !["person", "service", "agent"].includes(subject.kind)) {
    errors.push("Subject kind must be person, service, or agent");
  }
  return errors;
}

export function validateWorkspace(workspace: Partial<Workspace>): string[] {
  const errors: string[] = [];
  if (!workspace.id) errors.push("Workspace id is required");
  if (!workspace.name) errors.push("Workspace name is required");
  if (!workspace.kind) errors.push("Workspace kind is required");
  if (workspace.kind && !["personal", "enterprise", "sovereign"].includes(workspace.kind)) {
    errors.push("Workspace kind must be personal, enterprise, or sovereign");
  }
  return errors;
}

export function validateRoleAssignment(assignment: Partial<RoleAssignment>): string[] {
  const errors: string[] = [];
  if (!assignment.subjectId) errors.push("RoleAssignment subjectId is required");
  if (!assignment.workspaceId) errors.push("RoleAssignment workspaceId is required");
  if (!assignment.role) errors.push("RoleAssignment role is required");
  const validRoles = ["owner", "operator", "treasury-admin", "compliance-reviewer"];
  if (assignment.role && !validRoles.includes(assignment.role)) {
    errors.push(`RoleAssignment role must be one of: ${validRoles.join(", ")}`);
  }
  return errors;
}

export function validateCredential(credential: Partial<Credential>): string[] {
  const errors: string[] = [];
  if (!credential.id) errors.push("Credential id is required");
  if (!credential.subjectId) errors.push("Credential subjectId is required");
  if (!credential.type) errors.push("Credential type is required");
  const validTypes = ["password", "passkey", "hardware", "certificate", "verifiable"];
  if (credential.type && !validTypes.includes(credential.type)) {
    errors.push(`Credential type must be one of: ${validTypes.join(", ")}`);
  }
  return errors;
}
