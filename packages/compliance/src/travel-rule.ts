import type { TravelRuleData, TravelRuleParty, VaspInfo, ScreeningResult } from "./types";

function generateId(): string {
  return `tr-${crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
}

const FATF_THRESHOLD_USD = 1000;

/**
 * FATF Travel Rule compliance engine.
 * Manages originator/beneficiary data collection, VASP coordination,
 * and threshold-based Travel Rule obligations.
 */
export class TravelRuleEngine {
  private records = new Map<string, TravelRuleData>();

  createRecord(opts: {
    transactionId: string;
    originator: TravelRuleParty;
    beneficiary: TravelRuleParty;
    amount: string;
    currency: string;
    assetType: TravelRuleData["assetType"];
    originatingVasp?: VaspInfo;
    beneficiaryVasp?: VaspInfo;
    screeningResult: ScreeningResult;
  }): TravelRuleData {
    const amountUsd = parseFloat(opts.amount);
    const record: TravelRuleData = {
      id: generateId(),
      transactionId: opts.transactionId,
      originator: opts.originator,
      beneficiary: opts.beneficiary,
      amount: opts.amount,
      currency: opts.currency,
      assetType: opts.assetType,
      transferDate: Date.now(),
      originatingVasp: opts.originatingVasp,
      beneficiaryVasp: opts.beneficiaryVasp,
      screeningResult: opts.screeningResult,
      threshold: amountUsd >= FATF_THRESHOLD_USD ? "above" : "below",
      status: "pending",
    };

    this.records.set(record.id, record);
    return record;
  }

  isRequired(amountUsd: number): boolean {
    return amountUsd >= FATF_THRESHOLD_USD;
  }

  validateOriginatorData(originator: TravelRuleParty): { valid: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!originator.name) missing.push("name");
    if (!originator.accountNumber) missing.push("accountNumber");
    // For above-threshold: additional fields required
    if (!originator.geographicAddress) missing.push("geographicAddress");
    return { valid: missing.length === 0, missing };
  }

  validateBeneficiaryData(beneficiary: TravelRuleParty): { valid: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!beneficiary.name) missing.push("name");
    if (!beneficiary.accountNumber) missing.push("accountNumber");
    return { valid: missing.length === 0, missing };
  }

  transmit(recordId: string): TravelRuleData {
    const record = this.records.get(recordId);
    if (!record) throw new Error(`Travel Rule record not found: ${recordId}`);
    // In production: transmit to beneficiary VASP via TRISA/OpenVASP/Shyft protocol
    record.status = "transmitted";
    return record;
  }

  confirm(recordId: string): TravelRuleData {
    const record = this.records.get(recordId);
    if (!record) throw new Error(`Travel Rule record not found: ${recordId}`);
    record.status = "confirmed";
    return record;
  }

  getRecord(id: string): TravelRuleData | undefined {
    return this.records.get(id);
  }

  listByTransaction(txId: string): TravelRuleData[] {
    return Array.from(this.records.values()).filter((r) => r.transactionId === txId);
  }

  listPending(): TravelRuleData[] {
    return Array.from(this.records.values()).filter((r) => r.status === "pending");
  }

  toSnapshot(): TravelRuleData[] {
    return Array.from(this.records.values());
  }
}
