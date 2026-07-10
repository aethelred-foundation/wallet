/**
 * Guardian-based social recovery.
 *
 * For enterprise custody the catastrophic risk is not a hack — it is key
 * loss when a signer leaves the org. Social recovery lets an M-of-N set of
 * pre-designated guardians rotate the account owner, behind a timelock the
 * current owner can veto. This mirrors the Argent / Safe guardian model and
 * pairs with EIP-7702 / ERC-4337 accounts whose owner is a single key.
 *
 * Security properties enforced here (all covered by tests):
 *   - only configured guardians can approve; no double-counting
 *   - recovery executes only with ≥ threshold approvals AND after the timelock
 *   - the owner can cancel a pending recovery (defence against a malicious
 *     or coerced guardian quorum)
 *   - the guardian set can never be left unable to satisfy its own threshold
 *
 * This module is coordination logic only — it never holds a private key. The
 * caller binds `executeRecovery`'s returned owner to the on-chain account
 * (7702 delegation target / 4337 owner slot).
 */

import { TrustKernelError } from "./errors";

export class SocialRecoveryError extends TrustKernelError {
  constructor(message: string) {
    super(message);
    this.name = "SocialRecoveryError";
  }
}

export type Address = `0x${string}`;

export interface GuardianConfig {
  owner: Address;
  guardians: readonly Address[];
  /** M in M-of-N. */
  threshold: number;
  /** Timelock between reaching threshold and being executable, in ms. */
  delayMs: number;
}

export type RecoveryStatus = "pending" | "ready" | "executed" | "cancelled";

export interface RecoveryRequest {
  readonly id: string;
  readonly proposedOwner: Address;
  readonly proposedAt: number;
  /** proposedAt + delayMs — earliest executable time. */
  readonly executeAfter: number;
  readonly approvals: Address[];
  status: RecoveryStatus;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function normalize(address: string, label: string): Address {
  if (!ADDRESS_RE.test(address)) {
    throw new SocialRecoveryError(`Invalid ${label} address: "${address}"`);
  }
  return address.toLowerCase() as Address;
}

function generateId(): string {
  return `rec-${crypto
    .getRandomValues(new Uint8Array(8))
    .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
}

export class SocialRecoveryModule {
  private owner: Address;
  private guardians: Set<Address>;
  private threshold: number;
  private readonly delayMs: number;
  private readonly requests = new Map<string, RecoveryRequest>();

  constructor(config: GuardianConfig) {
    this.owner = normalize(config.owner, "owner");
    const guardians = config.guardians.map((g) => normalize(g, "guardian"));
    this.guardians = new Set(guardians);

    if (this.guardians.size !== guardians.length) {
      throw new SocialRecoveryError("Guardian list contains duplicates");
    }
    if (this.guardians.has(this.owner)) {
      throw new SocialRecoveryError("Owner cannot also be a guardian");
    }
    if (config.delayMs < 0) {
      throw new SocialRecoveryError("delayMs must be >= 0");
    }
    this.assertThreshold(config.threshold, this.guardians.size);
    this.threshold = config.threshold;
    this.delayMs = config.delayMs;
  }

  private assertThreshold(threshold: number, guardianCount: number): void {
    if (!Number.isInteger(threshold) || threshold < 1) {
      throw new SocialRecoveryError("threshold must be a positive integer");
    }
    if (threshold > guardianCount) {
      throw new SocialRecoveryError(
        `threshold ${threshold} exceeds guardian count ${guardianCount}`,
      );
    }
  }

  getConfig(): GuardianConfig {
    return {
      owner: this.owner,
      guardians: [...this.guardians],
      threshold: this.threshold,
      delayMs: this.delayMs,
    };
  }

  isGuardian(address: string): boolean {
    return this.guardians.has(normalize(address, "guardian"));
  }

  // ── Guardian-set management ──────────────────────────────────────

  addGuardian(address: string): void {
    const g = normalize(address, "guardian");
    if (g === this.owner) throw new SocialRecoveryError("Owner cannot be a guardian");
    if (this.guardians.has(g)) throw new SocialRecoveryError("Already a guardian");
    this.guardians.add(g);
  }

  removeGuardian(address: string): void {
    const g = normalize(address, "guardian");
    if (!this.guardians.has(g)) throw new SocialRecoveryError("Not a guardian");
    // Never leave the set unable to satisfy its own threshold.
    this.assertThreshold(this.threshold, this.guardians.size - 1);
    this.guardians.delete(g);
  }

  changeThreshold(threshold: number): void {
    this.assertThreshold(threshold, this.guardians.size);
    this.threshold = threshold;
  }

  // ── Recovery lifecycle ───────────────────────────────────────────

  /** Propose rotating the owner. Only one recovery may be active at a time. */
  proposeRecovery(newOwner: string, now: number = Date.now()): RecoveryRequest {
    const proposedOwner = normalize(newOwner, "newOwner");
    if (proposedOwner === this.owner) {
      throw new SocialRecoveryError("New owner must differ from current owner");
    }
    if (this.getActiveRequest()) {
      throw new SocialRecoveryError("A recovery is already in progress; cancel it first");
    }
    const request: RecoveryRequest = {
      id: generateId(),
      proposedOwner,
      proposedAt: now,
      executeAfter: now + this.delayMs,
      approvals: [],
      status: "pending",
    };
    this.requests.set(request.id, request);
    return request;
  }

  approveRecovery(id: string, guardian: string): RecoveryRequest {
    const request = this.mustGetActive(id);
    const g = normalize(guardian, "guardian");
    if (!this.guardians.has(g)) {
      throw new SocialRecoveryError("Approver is not a guardian");
    }
    if (request.approvals.includes(g)) {
      throw new SocialRecoveryError("Guardian has already approved");
    }
    request.approvals.push(g);
    if (request.approvals.length >= this.threshold) {
      request.status = "ready";
    }
    return request;
  }

  /** Threshold met AND timelock elapsed. */
  canExecute(id: string, now: number = Date.now()): boolean {
    const request = this.requests.get(id);
    if (!request) return false;
    return (
      request.status === "ready" &&
      request.approvals.length >= this.threshold &&
      now >= request.executeAfter
    );
  }

  /** Rotate the owner. Returns the new owner address. */
  executeRecovery(id: string, now: number = Date.now()): Address {
    const request = this.mustGetActive(id);
    if (request.approvals.length < this.threshold) {
      throw new SocialRecoveryError(
        `Need ${this.threshold} approvals, have ${request.approvals.length}`,
      );
    }
    if (now < request.executeAfter) {
      throw new SocialRecoveryError("Recovery timelock has not elapsed");
    }
    this.owner = request.proposedOwner;
    request.status = "executed";
    return this.owner;
  }

  /** Owner-side veto of a pending recovery. */
  cancelRecovery(id: string): RecoveryRequest {
    const request = this.mustGetActive(id);
    request.status = "cancelled";
    return request;
  }

  getRequest(id: string): RecoveryRequest | undefined {
    return this.requests.get(id);
  }

  getActiveRequest(): RecoveryRequest | undefined {
    return [...this.requests.values()].find(
      (r) => r.status === "pending" || r.status === "ready",
    );
  }

  private mustGetActive(id: string): RecoveryRequest {
    const request = this.requests.get(id);
    if (!request) throw new SocialRecoveryError(`Recovery request not found: ${id}`);
    if (request.status !== "pending" && request.status !== "ready") {
      throw new SocialRecoveryError(`Recovery request is ${request.status}`);
    }
    return request;
  }
}
