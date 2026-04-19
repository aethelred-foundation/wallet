export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

export class SubjectNotFoundError extends IdentityError {
  constructor(id: string) {
    super(`Subject not found: ${id}`);
    this.name = "SubjectNotFoundError";
  }
}

export class WorkspaceNotFoundError extends IdentityError {
  constructor(id: string) {
    super(`Workspace not found: ${id}`);
    this.name = "WorkspaceNotFoundError";
  }
}

export class DuplicateAssignmentError extends IdentityError {
  constructor(subjectId: string, workspaceId: string) {
    super(`Subject ${subjectId} already has a role in workspace ${workspaceId}`);
    this.name = "DuplicateAssignmentError";
  }
}
