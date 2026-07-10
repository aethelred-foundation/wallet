/**
 * VARA (Virtual Assets Regulatory Authority — Abu Dhabi / Dubai) controls.
 *
 * VARA is the primary jurisdiction for an Aethelred deployment in the UAE,
 * and its rulebook imposes obligations distinct from FATF/MiCA. This module
 * implements the four VARA-specific controls as composable, testable
 * primitives that slot into the existing compliance pipeline:
 *
 *   (a) Registered wallet addresses — every address operated on behalf of a
 *       VARA-licensed entity must be registered to that licence.
 *   (b) Travel Rule at the AED 3,500 threshold (lower than the FATF default).
 *   (c) Proof-of-reserves for custodial wallets — reserves ≥ customer
 *       liabilities, attested with a Merkle root of customer balances.
 *   (d) Incident reporting within 24 hours of detection.
 *
 * Like the other compliance engines, state is held in-memory and exported via
 * {@link VaraComplianceEngine.toSnapshot}; persistence is the caller's
 * responsibility (the background service worker wires it to the datastore).
 */

function generateId(prefix: string): string {
  const rand = crypto
    .getRandomValues(new Uint8Array(8))
    .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
  return `${prefix}-${rand}`;
}

function normalizeAddress(address: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`VARA: invalid wallet address "${address}"`);
  }
  return address.toLowerCase() as `0x${string}`;
}

/** VARA Travel Rule threshold, in AED (vs. the FATF USD 1,000 default). */
export const VARA_TRAVEL_RULE_THRESHOLD_AED = 3500;

/** The AED is pegged to the USD at a fixed central-bank rate. */
export const AED_PER_USD = 3.6725;

/** VARA incident-reporting window: 24 hours from detection. */
export const VARA_INCIDENT_REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A wallet address registered to a VARA-licensed entity. */
export interface VaraEntityRegistration {
  readonly address: `0x${string}`;
  /** VARA licence identifier of the operating entity. */
  readonly licenseNumber: string;
  readonly entityName: string;
  readonly registeredAt: number;
  status: "active" | "revoked";
}

/** A proof-of-reserves attestation for a custodial asset. */
export interface ProofOfReserves {
  readonly id: string;
  readonly asset: string;
  /** Reserves actually held, in the asset's smallest base unit. */
  readonly reservesHeld: bigint;
  /** Sum of customer liabilities, in the same base unit. */
  readonly customerLiabilities: bigint;
  /** Merkle root committing to the customer-balance set (optional). */
  readonly liabilitiesRoot?: `0x${string}`;
  readonly attestor: string;
  readonly attestedAt: number;
  /** reservesHeld ≥ customerLiabilities. */
  readonly solvent: boolean;
  /** reserves / liabilities in basis points (10000 = 100%). */
  readonly reserveRatioBps: number;
}

export type VaraIncidentSeverity = "low" | "medium" | "high" | "critical";

/** A reportable incident under VARA's 24-hour rule. */
export interface VaraIncident {
  readonly id: string;
  readonly summary: string;
  readonly severity: VaraIncidentSeverity;
  readonly detectedAt: number;
  /** detectedAt + 24h — the regulator-reporting deadline. */
  readonly reportDeadline: number;
  status: "open" | "reported" | "closed";
  reportedAt?: number;
}

/** Result of a Travel Rule threshold check, carrying the evaluated amount. */
export interface VaraTravelRuleCheck {
  readonly required: boolean;
  readonly amountAed: number;
  readonly thresholdAed: number;
}

export class VaraComplianceEngine {
  private readonly registrations = new Map<`0x${string}`, VaraEntityRegistration>();
  private readonly reserves = new Map<string, ProofOfReserves>();
  private readonly incidents = new Map<string, VaraIncident>();

  // ── (a) Registered wallet addresses ──────────────────────────────

  registerAddress(opts: {
    address: string;
    licenseNumber: string;
    entityName: string;
    now?: number;
  }): VaraEntityRegistration {
    if (!opts.licenseNumber.trim()) throw new Error("VARA: licenseNumber is required");
    const registration: VaraEntityRegistration = {
      address: normalizeAddress(opts.address),
      licenseNumber: opts.licenseNumber,
      entityName: opts.entityName,
      registeredAt: opts.now ?? Date.now(),
      status: "active",
    };
    this.registrations.set(registration.address, registration);
    return registration;
  }

  /** True iff the address is registered AND active. */
  isRegistered(address: string): boolean {
    return this.registrations.get(normalizeAddress(address))?.status === "active";
  }

  getRegistration(address: string): VaraEntityRegistration | undefined {
    return this.registrations.get(normalizeAddress(address));
  }

  revokeAddress(address: string): VaraEntityRegistration {
    const reg = this.registrations.get(normalizeAddress(address));
    if (!reg) throw new Error(`VARA: address not registered: ${address}`);
    reg.status = "revoked";
    return reg;
  }

  // ── (b) AED 3,500 Travel Rule threshold ──────────────────────────

  requiresTravelRule(amountAed: number): VaraTravelRuleCheck {
    return {
      required: amountAed >= VARA_TRAVEL_RULE_THRESHOLD_AED,
      amountAed,
      thresholdAed: VARA_TRAVEL_RULE_THRESHOLD_AED,
    };
  }

  requiresTravelRuleUsd(amountUsd: number, aedPerUsd: number = AED_PER_USD): VaraTravelRuleCheck {
    return this.requiresTravelRule(amountUsd * aedPerUsd);
  }

  // ── (c) Proof-of-reserves for custodial wallets ──────────────────

  attestReserves(opts: {
    asset: string;
    reservesHeld: bigint;
    customerLiabilities: bigint;
    liabilitiesRoot?: `0x${string}`;
    attestor: string;
    now?: number;
  }): ProofOfReserves {
    if (opts.reservesHeld < 0n || opts.customerLiabilities < 0n) {
      throw new Error("VARA: reserves and liabilities must be non-negative");
    }
    const { reservesHeld, customerLiabilities } = opts;
    const reserveRatioBps =
      customerLiabilities === 0n
        ? reservesHeld === 0n
          ? 0
          : Number.MAX_SAFE_INTEGER
        : Number((reservesHeld * 10000n) / customerLiabilities);

    const attestation: ProofOfReserves = {
      id: generateId("por"),
      asset: opts.asset,
      reservesHeld,
      customerLiabilities,
      liabilitiesRoot: opts.liabilitiesRoot,
      attestor: opts.attestor,
      attestedAt: opts.now ?? Date.now(),
      solvent: reservesHeld >= customerLiabilities,
      reserveRatioBps,
    };
    this.reserves.set(attestation.id, attestation);
    return attestation;
  }

  getReserves(id: string): ProofOfReserves | undefined {
    return this.reserves.get(id);
  }

  /** The most recent attestation for an asset, if any. */
  latestReservesForAsset(asset: string): ProofOfReserves | undefined {
    return Array.from(this.reserves.values())
      .filter((r) => r.asset === asset)
      .sort((a, b) => b.attestedAt - a.attestedAt)[0];
  }

  // ── (d) 24-hour incident reporting ───────────────────────────────

  reportIncident(opts: {
    summary: string;
    severity: VaraIncidentSeverity;
    detectedAt?: number;
  }): VaraIncident {
    const detectedAt = opts.detectedAt ?? Date.now();
    const incident: VaraIncident = {
      id: generateId("inc"),
      summary: opts.summary,
      severity: opts.severity,
      detectedAt,
      reportDeadline: detectedAt + VARA_INCIDENT_REPORT_WINDOW_MS,
      status: "open",
    };
    this.incidents.set(incident.id, incident);
    return incident;
  }

  markIncidentReported(id: string, now: number = Date.now()): VaraIncident {
    const incident = this.incidents.get(id);
    if (!incident) throw new Error(`VARA: incident not found: ${id}`);
    incident.status = "reported";
    incident.reportedAt = now;
    return incident;
  }

  /** True iff still open and past the 24-hour deadline. */
  isIncidentOverdue(id: string, now: number = Date.now()): boolean {
    const incident = this.incidents.get(id);
    if (!incident) throw new Error(`VARA: incident not found: ${id}`);
    return incident.status === "open" && now > incident.reportDeadline;
  }

  listOverdueIncidents(now: number = Date.now()): VaraIncident[] {
    return Array.from(this.incidents.values()).filter(
      (i) => i.status === "open" && now > i.reportDeadline,
    );
  }

  toSnapshot(): {
    registrations: VaraEntityRegistration[];
    reserves: ProofOfReserves[];
    incidents: VaraIncident[];
  } {
    return {
      registrations: Array.from(this.registrations.values()),
      reserves: Array.from(this.reserves.values()),
      incidents: Array.from(this.incidents.values()),
    };
  }
}
