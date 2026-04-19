import type { WorkspaceRole } from "@aethelred/wallet-connect";
import { WorkspaceNotFoundError } from "./errors";
import type { Workspace, RoleAssignment } from "./types";

function generateId(): string {
  return `ws-${crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
}

export class WorkspaceRegistry {
  private workspaces = new Map<string, Workspace>();
  private roleAssignments: RoleAssignment[] = [];
  private activeWorkspaceId: string | null = null;

  createWorkspace(
    name: string,
    kind: Workspace["kind"],
    summary: string,
    ownerSubjectId: string
  ): Workspace {
    const id = generateId();
    const workspace: Workspace = {
      id,
      name,
      kind,
      summary,
      memberIds: [ownerSubjectId],
      accountIds: [],
      policyBundleId: `policy-default-${kind}`,
      createdAt: Date.now(),
    };
    this.workspaces.set(id, workspace);

    this.roleAssignments.push({
      id: `role-${id}-${ownerSubjectId}`,
      subjectId: ownerSubjectId,
      workspaceId: id,
      role: "owner",
      grantedAt: Date.now(),
      grantedBy: ownerSubjectId,
    });

    if (!this.activeWorkspaceId) {
      this.activeWorkspaceId = id;
    }

    return workspace;
  }

  get(id: string): Workspace {
    const workspace = this.workspaces.get(id);
    if (!workspace) throw new WorkspaceNotFoundError(id);
    return workspace;
  }

  getActive(): Workspace | null {
    if (!this.activeWorkspaceId) return null;
    return this.workspaces.get(this.activeWorkspaceId) ?? null;
  }

  setActive(id: string): void {
    if (!this.workspaces.has(id)) throw new WorkspaceNotFoundError(id);
    this.activeWorkspaceId = id;
  }

  list(): Workspace[] {
    return Array.from(this.workspaces.values());
  }

  listForSubject(subjectId: string): Workspace[] {
    const workspaceIds = this.roleAssignments
      .filter((ra) => ra.subjectId === subjectId)
      .map((ra) => ra.workspaceId);
    return workspaceIds
      .map((id) => this.workspaces.get(id))
      .filter((ws): ws is Workspace => ws !== undefined);
  }

  getRole(subjectId: string, workspaceId: string): WorkspaceRole | null {
    const assignment = this.roleAssignments.find(
      (ra) => ra.subjectId === subjectId && ra.workspaceId === workspaceId
    );
    return assignment?.role ?? null;
  }

  assignRole(
    subjectId: string,
    workspaceId: string,
    role: WorkspaceRole,
    grantedBy: string
  ): void {
    if (!this.workspaces.has(workspaceId)) throw new WorkspaceNotFoundError(workspaceId);

    const existing = this.roleAssignments.findIndex(
      (ra) => ra.subjectId === subjectId && ra.workspaceId === workspaceId
    );

    const assignment: RoleAssignment = {
      id: `role-${workspaceId}-${subjectId}`,
      subjectId,
      workspaceId,
      role,
      grantedAt: Date.now(),
      grantedBy,
    };

    if (existing >= 0) {
      this.roleAssignments[existing] = assignment;
    } else {
      this.roleAssignments.push(assignment);
      const workspace = this.workspaces.get(workspaceId)!;
      if (!workspace.memberIds.includes(subjectId)) {
        workspace.memberIds.push(subjectId);
      }
    }
  }

  addAccountToWorkspace(workspaceId: string, accountId: string): void {
    const workspace = this.get(workspaceId);
    if (!workspace.accountIds.includes(accountId)) {
      workspace.accountIds.push(accountId);
    }
  }

  delete(id: string): void {
    this.workspaces.delete(id);
    this.roleAssignments = this.roleAssignments.filter((ra) => ra.workspaceId !== id);
    if (this.activeWorkspaceId === id) {
      const remaining = this.workspaces.keys().next();
      this.activeWorkspaceId = remaining.done ? null : remaining.value;
    }
  }

  loadFromSnapshot(
    workspaces: Workspace[],
    roles: RoleAssignment[],
    activeId: string | null
  ): void {
    this.workspaces.clear();
    for (const ws of workspaces) {
      this.workspaces.set(ws.id, ws);
    }
    this.roleAssignments = roles;
    this.activeWorkspaceId = activeId;
  }

  toSnapshot(): {
    workspaces: Workspace[];
    roles: RoleAssignment[];
    activeId: string | null;
  } {
    return {
      workspaces: this.list(),
      roles: [...this.roleAssignments],
      activeId: this.activeWorkspaceId,
    };
  }
}
