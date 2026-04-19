import type { MachineIdentity, MachinePermission, MachineType, ProvenanceRecord, CustodyEntry, Attestation } from "./types";

function generateId(prefix: string): string {
  return `${prefix}-${crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
}

/**
 * Machine Identity Protocol for non-human actors.
 * Manages AI agents, IoT devices, autonomous vehicles, oracles, validators,
 * and other machine-to-machine signing identities with rate limiting,
 * autonomous delegation, and human-in-the-loop approval gates.
 */
export class MachineIdentityManager {
  private identities = new Map<string, MachineIdentity>();
  private operationCounts = new Map<string, { count: number; windowStart: number }>();

  register(opts: {
    name: string;
    type: MachineType;
    workspaceId: string;
    parentIdentityId?: string;
    publicKey: string;
    permissions: MachinePermission[];
    maxOperationsPerHour: number;
    maxValuePerTransaction: string;
    maxDailyVolume: string;
    requiresHumanApproval: boolean;
    approvalThreshold: string;
    expiresAt?: number;
  }): MachineIdentity {
    const identity: MachineIdentity = {
      id: generateId("mid"),
      name: opts.name,
      type: opts.type,
      workspaceId: opts.workspaceId,
      parentIdentityId: opts.parentIdentityId,
      publicKey: opts.publicKey,
      permissions: opts.permissions,
      maxOperationsPerHour: opts.maxOperationsPerHour,
      maxValuePerTransaction: opts.maxValuePerTransaction,
      maxDailyVolume: opts.maxDailyVolume,
      requiresHumanApproval: opts.requiresHumanApproval,
      approvalThreshold: opts.approvalThreshold,
      status: "active",
      activatedAt: Date.now(),
      expiresAt: opts.expiresAt,
      totalOperations: 0,
      totalValueProcessed: "0",
      anomalyCount: 0,
    };

    this.identities.set(identity.id, identity);
    return identity;
  }

  /**
   * Check if a machine can perform an operation.
   * Enforces rate limits, value limits, and human approval requirements.
   */
  authorize(machineId: string, opts: {
    action: string;
    value?: string;
    scope?: string;
  }): { authorized: boolean; requiresHumanApproval: boolean; reason?: string } {
    const identity = this.identities.get(machineId);
    if (!identity) return { authorized: false, requiresHumanApproval: false, reason: "Machine identity not found" };
    if (identity.status !== "active") return { authorized: false, requiresHumanApproval: false, reason: `Machine is ${identity.status}` };
    if (identity.expiresAt && identity.expiresAt < Date.now()) return { authorized: false, requiresHumanApproval: false, reason: "Machine identity expired" };

    // Check permissions
    const hasPermission = identity.permissions.some((p) =>
      p.action === opts.action && (!p.expiresAt || p.expiresAt > Date.now())
    );
    if (!hasPermission) return { authorized: false, requiresHumanApproval: false, reason: `No permission for action: ${opts.action}` };

    // Check rate limit
    if (!this.checkRateLimit(machineId, identity.maxOperationsPerHour)) {
      return { authorized: false, requiresHumanApproval: false, reason: `Rate limit exceeded: ${identity.maxOperationsPerHour}/hour` };
    }

    // Check value limit
    if (opts.value) {
      const value = parseFloat(opts.value);
      if (value > parseFloat(identity.maxValuePerTransaction)) {
        return { authorized: false, requiresHumanApproval: false, reason: `Value ${opts.value} exceeds per-transaction limit ${identity.maxValuePerTransaction}` };
      }

      // Check if human approval is required for this value
      if (identity.requiresHumanApproval && value > parseFloat(identity.approvalThreshold)) {
        return { authorized: true, requiresHumanApproval: true, reason: `Value ${opts.value} exceeds approval threshold ${identity.approvalThreshold}` };
      }
    }

    return { authorized: true, requiresHumanApproval: identity.requiresHumanApproval };
  }

  recordOperation(machineId: string, value?: string): void {
    const identity = this.identities.get(machineId);
    if (!identity) return;

    identity.totalOperations += 1;
    identity.lastOperationAt = Date.now();
    if (value) {
      identity.totalValueProcessed = String(parseFloat(identity.totalValueProcessed) + parseFloat(value));
    }

    // Update rate limit counter
    const counter = this.operationCounts.get(machineId);
    if (counter) counter.count += 1;
  }

  recordAnomaly(machineId: string, description: string): void {
    const identity = this.identities.get(machineId);
    if (!identity) return;
    identity.anomalyCount += 1;

    // Auto-suspend after 5 anomalies
    if (identity.anomalyCount >= 5) {
      identity.status = "suspended";
      identity.suspensionReason = `Auto-suspended after ${identity.anomalyCount} anomalies. Last: ${description}`;
    }
  }

  suspend(machineId: string, reason: string): void {
    const identity = this.identities.get(machineId);
    if (identity) {
      identity.status = "suspended";
      identity.suspensionReason = reason;
    }
  }

  reactivate(machineId: string): void {
    const identity = this.identities.get(machineId);
    if (identity && identity.status === "suspended") {
      identity.status = "active";
      identity.suspensionReason = undefined;
      identity.anomalyCount = 0;
    }
  }

  revoke(machineId: string): void {
    const identity = this.identities.get(machineId);
    if (identity) identity.status = "revoked";
  }

  get(id: string): MachineIdentity | undefined {
    return this.identities.get(id);
  }

  listByType(type: MachineType): MachineIdentity[] {
    return Array.from(this.identities.values()).filter((m) => m.type === type);
  }

  listByWorkspace(workspaceId: string): MachineIdentity[] {
    return Array.from(this.identities.values()).filter((m) => m.workspaceId === workspaceId);
  }

  listActive(): MachineIdentity[] {
    return Array.from(this.identities.values()).filter((m) => m.status === "active");
  }

  private checkRateLimit(machineId: string, maxPerHour: number): boolean {
    const now = Date.now();
    const counter = this.operationCounts.get(machineId);

    if (!counter || now - counter.windowStart > 3600000) {
      this.operationCounts.set(machineId, { count: 1, windowStart: now });
      return true;
    }

    return counter.count < maxPerHour;
  }

  toSnapshot(): MachineIdentity[] {
    return Array.from(this.identities.values());
  }
}

/**
 * Provenance tracking for supply chain, research, and audit trails.
 * Maintains chain of custody and multi-party attestation records.
 */
export class ProvenanceTracker {
  private records = new Map<string, ProvenanceRecord>();

  createRecord(opts: {
    entityId: string;
    entityType: ProvenanceRecord["entityType"];
    initialHolder: CustodyEntry;
    metadata?: Record<string, unknown>;
  }): ProvenanceRecord {
    const record: ProvenanceRecord = {
      id: generateId("prv"),
      entityId: opts.entityId,
      entityType: opts.entityType,
      chainOfCustody: [opts.initialHolder],
      attestations: [],
      metadata: opts.metadata ?? {},
      createdAt: Date.now(),
      integrityHash: "",
    };

    this.records.set(record.id, record);
    return record;
  }

  transferCustody(recordId: string, to: CustodyEntry): void {
    const record = this.records.get(recordId);
    if (!record) throw new Error(`Provenance record not found: ${recordId}`);

    // Close current holder
    const current = record.chainOfCustody[record.chainOfCustody.length - 1];
    if (current && !current.releasedAt) {
      current.releasedAt = Date.now();
    }

    record.chainOfCustody.push(to);
  }

  addAttestation(recordId: string, attestation: Omit<Attestation, "id" | "revoked">): void {
    const record = this.records.get(recordId);
    if (!record) throw new Error(`Provenance record not found: ${recordId}`);

    record.attestations.push({
      ...attestation,
      id: generateId("att"),
      revoked: false,
    });
  }

  revokeAttestation(recordId: string, attestationId: string): void {
    const record = this.records.get(recordId);
    if (!record) return;
    const att = record.attestations.find((a) => a.id === attestationId);
    if (att) att.revoked = true;
  }

  getRecord(id: string): ProvenanceRecord | undefined {
    return this.records.get(id);
  }

  getByEntity(entityId: string): ProvenanceRecord | undefined {
    return Array.from(this.records.values()).find((r) => r.entityId === entityId);
  }

  verifyChainOfCustody(recordId: string): { valid: boolean; gaps: string[] } {
    const record = this.records.get(recordId);
    if (!record) return { valid: false, gaps: ["Record not found"] };

    const gaps: string[] = [];
    for (let i = 0; i < record.chainOfCustody.length - 1; i++) {
      const current = record.chainOfCustody[i];
      const next = record.chainOfCustody[i + 1];
      if (!current.releasedAt) {
        gaps.push(`Entry ${i}: No release timestamp`);
      } else if (next.receivedAt < current.releasedAt) {
        gaps.push(`Gap between entry ${i} and ${i + 1}: received before released`);
      }
    }

    return { valid: gaps.length === 0, gaps };
  }

  listAll(): ProvenanceRecord[] {
    return Array.from(this.records.values());
  }
}
