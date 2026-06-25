/**
 * Travel Rule interoperability — IVMS101 + protocol-agnostic transport.
 *
 * MiCA's Transfer of Funds Regulation (and FATF Recommendation 16) require
 * CASP-to-CASP exchange of originator/beneficiary data, with no minimum
 * threshold in the EU. The wire formats are protocol-specific (TRISA gRPC,
 * OpenVASP, Sygna Bridge, Notabene) but they all carry the **IVMS101**
 * (interVASP Messaging Standard) payload. This module builds and validates
 * that payload and hands it to a pluggable {@link TravelRuleTransport}, so
 * the wallet is protocol-agnostic: implement one transport per network and
 * the compliance logic is unchanged.
 *
 * Pairs with {@link TravelRuleEngine} (which owns the record lifecycle) —
 * this module is the *interop* boundary the engine was missing.
 */

import type { TravelRuleData, TravelRuleParty, VaspInfo } from "./types";

function generateId(prefix: string): string {
  return `${prefix}-${crypto
    .getRandomValues(new Uint8Array(8))
    .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
}

/** Travel-rule protocols that carry an IVMS101 payload. */
export type TravelRuleProtocol = "trisa" | "openvasp" | "sygna" | "notabene";

/** An IVMS101 person (natural or legal) — the originator/beneficiary. */
export interface Ivms101Person {
  readonly kind: "natural" | "legal";
  /** Primary identifier (surname / legal name). */
  readonly name: string;
  readonly accountNumber: string;
  readonly geographicAddress?: string;
  readonly nationalId?: string;
  readonly dateOfBirth?: string;
  readonly placeOfBirth?: string;
  /** Legal Entity Identifier (legal persons). */
  readonly lei?: string;
}

export interface Ivms101Vasp {
  readonly name: string;
  readonly lei?: string;
  readonly jurisdiction: string;
  readonly registrationNumber?: string;
}

/** A faithful IVMS101 subset — the interoperable travel-rule payload. */
export interface Ivms101Message {
  readonly originator: { readonly persons: Ivms101Person[]; readonly accountNumbers: string[] };
  readonly beneficiary: { readonly persons: Ivms101Person[]; readonly accountNumbers: string[] };
  readonly originatingVasp?: Ivms101Vasp;
  readonly beneficiaryVasp?: Ivms101Vasp;
  readonly payloadMetadata: {
    readonly transactionId: string;
    readonly amount: string;
    readonly currency: string;
    readonly assetType: string;
    readonly transferDate: number;
  };
}

/** An envelope ready to hand to a protocol transport. */
export interface TravelRuleEnvelope {
  readonly messageId: string;
  readonly protocol: TravelRuleProtocol;
  readonly ivms101: Ivms101Message;
  readonly createdAt: number;
}

export interface TransportResult {
  readonly accepted: boolean;
  /** Counterparty/transport reference (e.g. TRISA envelope id). */
  readonly reference?: string;
  readonly error?: string;
}

/** Pluggable per-protocol transport (TRISA / OpenVASP / Sygna / Notabene). */
export interface TravelRuleTransport {
  readonly protocol: TravelRuleProtocol;
  send(envelope: TravelRuleEnvelope): Promise<TransportResult>;
}

export interface Ivms101Validation {
  readonly valid: boolean;
  readonly missing: string[];
}

function personFromParty(party: TravelRuleParty): Ivms101Person {
  return {
    kind: party.legalEntityId ? "legal" : "natural",
    name: party.name,
    accountNumber: party.accountNumber,
    geographicAddress: party.geographicAddress,
    nationalId: party.nationalId,
    dateOfBirth: party.dateOfBirth,
    placeOfBirth: party.placeOfBirth,
    lei: party.legalEntityId,
  };
}

function vaspFromInfo(info: VaspInfo): Ivms101Vasp {
  return {
    name: info.name,
    lei: info.lei,
    jurisdiction: info.jurisdiction,
    registrationNumber: info.registrationNumber,
  };
}

/** Map a {@link TravelRuleData} record into an IVMS101 message. */
export function buildIvms101Message(record: TravelRuleData): Ivms101Message {
  return {
    originator: {
      persons: [personFromParty(record.originator)],
      accountNumbers: [record.originator.accountNumber],
    },
    beneficiary: {
      persons: [personFromParty(record.beneficiary)],
      accountNumbers: [record.beneficiary.accountNumber],
    },
    originatingVasp: record.originatingVasp ? vaspFromInfo(record.originatingVasp) : undefined,
    beneficiaryVasp: record.beneficiaryVasp ? vaspFromInfo(record.beneficiaryVasp) : undefined,
    payloadMetadata: {
      transactionId: record.transactionId,
      amount: record.amount,
      currency: record.currency,
      assetType: record.assetType,
      transferDate: record.transferDate,
    },
  };
}

/**
 * Validate an IVMS101 message. Always requires originator/beneficiary name +
 * account and both VASPs. When `aboveThreshold`, FATF R.16 additionally
 * requires originator identifying info: a physical address, a national id,
 * or date-and-place of birth.
 */
export function validateIvms101(msg: Ivms101Message, aboveThreshold = false): Ivms101Validation {
  const missing: string[] = [];
  const orig = msg.originator.persons[0];
  const benef = msg.beneficiary.persons[0];

  if (!orig?.name) missing.push("originator.name");
  if (!orig?.accountNumber) missing.push("originator.accountNumber");
  if (!benef?.name) missing.push("beneficiary.name");
  if (!benef?.accountNumber) missing.push("beneficiary.accountNumber");
  if (!msg.originatingVasp?.name) missing.push("originatingVasp.name");
  if (!msg.beneficiaryVasp?.name) missing.push("beneficiaryVasp.name");

  if (aboveThreshold && orig) {
    const hasIdentifier =
      Boolean(orig.geographicAddress) ||
      Boolean(orig.nationalId) ||
      (Boolean(orig.dateOfBirth) && Boolean(orig.placeOfBirth));
    if (!hasIdentifier) {
      missing.push("originator.identifier(address|nationalId|dob+pob)");
    }
  }

  return { valid: missing.length === 0, missing };
}

export class TravelRuleInteropError extends Error {
  readonly missing: string[];
  constructor(message: string, missing: string[]) {
    super(message);
    this.name = "TravelRuleInteropError";
    this.missing = missing;
  }
}

/** Default transport — accepts nothing; warns it is unwired. */
export class NoopTravelRuleTransport implements TravelRuleTransport {
  readonly protocol: TravelRuleProtocol = "trisa";
  async send(): Promise<TransportResult> {
    console.warn("[travel-rule-interop] NoopTravelRuleTransport — wire a TRISA/OpenVASP transport before production.");
    return { accepted: false, error: "no transport configured" };
  }
}

/**
 * Protocol-agnostic travel-rule interop engine. Builds + validates IVMS101
 * envelopes and routes them through registered transports.
 */
export class TravelRuleInteropEngine {
  private readonly transports = new Map<TravelRuleProtocol, TravelRuleTransport>();

  registerTransport(transport: TravelRuleTransport): void {
    this.transports.set(transport.protocol, transport);
  }

  supportedProtocols(): TravelRuleProtocol[] {
    return [...this.transports.keys()];
  }

  /**
   * Build a validated envelope for transmission. Throws
   * {@link TravelRuleInteropError} if the IVMS101 payload is missing
   * fields required at the record's threshold.
   */
  prepareEnvelope(record: TravelRuleData, protocol: TravelRuleProtocol): TravelRuleEnvelope {
    const ivms101 = buildIvms101Message(record);
    const validation = validateIvms101(ivms101, record.threshold === "above");
    if (!validation.valid) {
      throw new TravelRuleInteropError(
        `IVMS101 payload incomplete: ${validation.missing.join(", ")}`,
        validation.missing,
      );
    }
    return { messageId: generateId("tr-msg"), protocol, ivms101, createdAt: Date.now() };
  }

  /** Build + transmit in one step via the registered transport. */
  async transmit(record: TravelRuleData, protocol: TravelRuleProtocol): Promise<TransportResult> {
    const transport = this.transports.get(protocol);
    if (!transport) {
      throw new TravelRuleInteropError(`No transport registered for protocol "${protocol}"`, []);
    }
    return transport.send(this.prepareEnvelope(record, protocol));
  }

  /**
   * Validate an inbound IVMS101 message received from a counterparty VASP.
   * Returns the parse/validation result without throwing, so callers can
   * route invalid inbound messages to manual review.
   */
  ingest(msg: Ivms101Message, aboveThreshold = false): Ivms101Validation {
    return validateIvms101(msg, aboveThreshold);
  }
}
