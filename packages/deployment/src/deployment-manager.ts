import type {
  DeploymentProfile,
  DeploymentTier,
  ServiceIdentity,
  AgentIdentity,
} from "./types";
import { getDeploymentProfile } from "./profiles";

function generateId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * DeploymentManager adapts the wallet to different trust environments.
 * It gates features, restricts operations, and manages service/agent identities
 * based on the active deployment profile.
 */
export class DeploymentManager {
  private activeProfile: DeploymentProfile;
  private serviceIdentities = new Map<string, ServiceIdentity>();
  private agentIdentities = new Map<string, AgentIdentity>();

  constructor(tier: DeploymentTier = "shared-cloud") {
    this.activeProfile = getDeploymentProfile(tier);
  }

  getActiveProfile(): DeploymentProfile {
    return this.activeProfile;
  }

  switchTier(tier: DeploymentTier): DeploymentProfile {
    this.activeProfile = getDeploymentProfile(tier);
    return this.activeProfile;
  }

  isFeatureEnabled(feature: keyof DeploymentProfile["features"]): boolean {
    return this.activeProfile.features[feature];
  }

  checkRestriction(check: {
    workspaceCount?: number;
    accountCount?: number;
    isExternalApp?: boolean;
    isCrossWorkspace?: boolean;
  }): { allowed: boolean; reason?: string } {
    const restrictions = this.activeProfile.restrictions;

    if (check.workspaceCount !== undefined && restrictions.maxWorkspaces !== null) {
      if (check.workspaceCount >= restrictions.maxWorkspaces) {
        return { allowed: false, reason: `Maximum ${restrictions.maxWorkspaces} workspaces for ${this.activeProfile.tier}` };
      }
    }

    if (check.accountCount !== undefined && restrictions.maxAccountsPerWorkspace !== null) {
      if (check.accountCount >= restrictions.maxAccountsPerWorkspace) {
        return { allowed: false, reason: `Maximum ${restrictions.maxAccountsPerWorkspace} accounts per workspace` };
      }
    }

    if (check.isExternalApp && !restrictions.allowExternalApps) {
      return { allowed: false, reason: "External apps are not permitted in this deployment tier" };
    }

    if (check.isCrossWorkspace && !restrictions.allowCrossWorkspaceTransfers) {
      return { allowed: false, reason: "Cross-workspace transfers are not permitted" };
    }

    return { allowed: true };
  }

  // Service Identity management (Phase 3)
  createServiceIdentity(opts: {
    name: string;
    workspaceId: string;
    permissions: string[];
  }): ServiceIdentity {
    if (!this.activeProfile.features.serviceIdentities) {
      throw new Error("Service identities are not available in this deployment tier");
    }

    const identity: ServiceIdentity = {
      id: generateId("svc"),
      name: opts.name,
      workspaceId: opts.workspaceId,
      deploymentId: this.activeProfile.id,
      permissions: opts.permissions,
      createdAt: Date.now(),
      status: "active",
    };

    this.serviceIdentities.set(identity.id, identity);
    return identity;
  }

  createAgentIdentity(opts: {
    name: string;
    parentServiceId: string;
    workspaceId: string;
    capabilities: string[];
    maxOperationsPerHour: number;
    requiresHumanApproval: boolean;
  }): AgentIdentity {
    if (!this.activeProfile.features.agentIdentities) {
      throw new Error("Agent identities are not available in this deployment tier");
    }

    const parent = this.serviceIdentities.get(opts.parentServiceId);
    if (!parent) throw new Error(`Parent service not found: ${opts.parentServiceId}`);

    const agent: AgentIdentity = {
      id: generateId("agt"),
      name: opts.name,
      parentServiceId: opts.parentServiceId,
      workspaceId: opts.workspaceId,
      capabilities: opts.capabilities,
      maxOperationsPerHour: opts.maxOperationsPerHour,
      requiresHumanApproval: opts.requiresHumanApproval,
      createdAt: Date.now(),
      status: "active",
    };

    this.agentIdentities.set(agent.id, agent);
    return agent;
  }

  suspendServiceIdentity(id: string): void {
    const identity = this.serviceIdentities.get(id);
    if (identity) {
      identity.status = "suspended";
      // Suspend all child agents
      for (const agent of this.agentIdentities.values()) {
        if (agent.parentServiceId === id) agent.status = "suspended";
      }
    }
  }

  listServiceIdentities(workspaceId?: string): ServiceIdentity[] {
    return Array.from(this.serviceIdentities.values()).filter(
      (s) => !workspaceId || s.workspaceId === workspaceId
    );
  }

  listAgentIdentities(workspaceId?: string): AgentIdentity[] {
    return Array.from(this.agentIdentities.values()).filter(
      (a) => !workspaceId || a.workspaceId === workspaceId
    );
  }

  getComplianceConfig() {
    return this.activeProfile.compliance;
  }

  loadFromSnapshot(data: {
    tier: DeploymentTier;
    services: ServiceIdentity[];
    agents: AgentIdentity[];
  }): void {
    this.activeProfile = getDeploymentProfile(data.tier);
    this.serviceIdentities.clear();
    for (const s of data.services) this.serviceIdentities.set(s.id, s);
    this.agentIdentities.clear();
    for (const a of data.agents) this.agentIdentities.set(a.id, a);
  }

  toSnapshot(): {
    tier: DeploymentTier;
    services: ServiceIdentity[];
    agents: AgentIdentity[];
  } {
    return {
      tier: this.activeProfile.tier,
      services: Array.from(this.serviceIdentities.values()),
      agents: Array.from(this.agentIdentities.values()),
    };
  }
}
