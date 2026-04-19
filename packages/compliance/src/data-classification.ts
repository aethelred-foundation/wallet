import type { DataClassification, ClassificationLevel, ConsentRecord } from "./types";

function generateId(prefix: string): string {
  return `${prefix}-${crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
}

// Handling instructions by classification level
const HANDLING_RULES: Record<ClassificationLevel, { encryption: boolean; retention: number; instructions: string[] }> = {
  "public": { encryption: false, retention: 365, instructions: ["No restrictions on distribution"] },
  "internal": { encryption: false, retention: 730, instructions: ["Limit to organization members"] },
  "confidential": { encryption: true, retention: 1825, instructions: ["Encrypt at rest", "Access logging required", "No external sharing without approval"] },
  "restricted": { encryption: true, retention: 2555, instructions: ["Encrypt at rest and in transit", "Access logging required", "Dual-control access", "No copying"] },
  "top-secret": { encryption: true, retention: 3650, instructions: ["End-to-end encryption", "Hardware-backed storage", "Dual-control access", "Air-gapped processing", "No external network"] },
  "phi": { encryption: true, retention: 2190, instructions: ["HIPAA Safe Harbor", "Minimum necessary access", "Access logging", "Breach notification within 60 days", "BAA required for third parties"] },
  "pii": { encryption: true, retention: 1095, instructions: ["GDPR Article 5 compliance", "Purpose limitation", "Data minimization", "Right to erasure"] },
  "spii": { encryption: true, retention: 1825, instructions: ["Enhanced access controls", "Encryption required", "Multi-factor authentication for access", "Breach notification within 72 hours"] },
  "cui": { encryption: true, retention: 2555, instructions: ["NIST 800-171 controls", "Access control", "Audit logging", "Marking required", "Incident reporting within 72 hours"] },
  "classified": { encryption: true, retention: 3650, instructions: ["NIST 800-53 High controls", "FIPS 140-2 validated crypto", "Air-gapped storage", "Personnel clearance required", "Need-to-know access"] },
};

/**
 * Data classification engine for regulated data handling.
 * Enforces classification-appropriate controls for HIPAA, defense,
 * GDPR, and other regulatory requirements.
 */
export class DataClassificationEngine {
  private classifications = new Map<string, DataClassification>();
  private consents = new Map<string, ConsentRecord>();

  classify(opts: {
    resourceId: string;
    resourceType: DataClassification["resourceType"];
    level: ClassificationLevel;
    labels?: string[];
    roles?: string[];
    subjects?: string[];
    createdBy: string;
  }): DataClassification {
    const rules = HANDLING_RULES[opts.level];
    const classification: DataClassification = {
      id: generateId("cls"),
      resourceId: opts.resourceId,
      resourceType: opts.resourceType,
      level: opts.level,
      labels: opts.labels ?? [],
      handlingInstructions: rules.instructions,
      retentionDays: rules.retention,
      encryptionRequired: rules.encryption,
      accessControl: {
        roles: opts.roles ?? ["owner"],
        subjects: opts.subjects ?? [],
        conditions: [],
      },
      createdAt: Date.now(),
      createdBy: opts.createdBy,
    };

    this.classifications.set(classification.id, classification);
    return classification;
  }

  getClassification(resourceId: string): DataClassification | undefined {
    return Array.from(this.classifications.values()).find((c) => c.resourceId === resourceId);
  }

  getHandlingInstructions(level: ClassificationLevel): string[] {
    return HANDLING_RULES[level]?.instructions ?? [];
  }

  isEncryptionRequired(level: ClassificationLevel): boolean {
    return HANDLING_RULES[level]?.encryption ?? true;
  }

  getRetentionDays(level: ClassificationLevel): number {
    return HANDLING_RULES[level]?.retention ?? 365;
  }

  checkAccess(resourceId: string, subjectId: string, role: string): { allowed: boolean; reason?: string } {
    const classification = this.getClassification(resourceId);
    if (!classification) return { allowed: true }; // Unclassified = open

    if (classification.accessControl.subjects.length > 0 && !classification.accessControl.subjects.includes(subjectId)) {
      return { allowed: false, reason: `Subject ${subjectId} not in access list for ${classification.level} resource` };
    }

    if (classification.accessControl.roles.length > 0 && !classification.accessControl.roles.includes(role)) {
      return { allowed: false, reason: `Role ${role} not authorized for ${classification.level} resource` };
    }

    return { allowed: true };
  }

  // ─── Consent Management (GDPR/HIPAA) ────────────────────────────

  grantConsent(opts: {
    subjectId: string;
    grantedTo: string;
    purpose: string;
    legalBasis: ConsentRecord["legalBasis"];
    dataCategories: string[];
    processingActivities: string[];
    retentionPeriod: number;
    crossBorderTransfer?: boolean;
    transferDestinations?: string[];
  }): ConsentRecord {
    const consent: ConsentRecord = {
      id: generateId("cns"),
      subjectId: opts.subjectId,
      grantedTo: opts.grantedTo,
      purpose: opts.purpose,
      legalBasis: opts.legalBasis,
      dataCategories: opts.dataCategories,
      processingActivities: opts.processingActivities,
      retentionPeriod: opts.retentionPeriod,
      crossBorderTransfer: opts.crossBorderTransfer ?? false,
      transferDestinations: opts.transferDestinations,
      status: "active",
      grantedAt: Date.now(),
      expiresAt: Date.now() + opts.retentionPeriod * 24 * 60 * 60 * 1000,
      evidenceHash: "",
    };

    this.consents.set(consent.id, consent);
    return consent;
  }

  withdrawConsent(consentId: string): ConsentRecord {
    const consent = this.consents.get(consentId);
    if (!consent) throw new Error(`Consent not found: ${consentId}`);
    consent.status = "withdrawn";
    consent.withdrawnAt = Date.now();
    return consent;
  }

  getActiveConsents(subjectId: string): ConsentRecord[] {
    return Array.from(this.consents.values()).filter(
      (c) => c.subjectId === subjectId && c.status === "active" && (!c.expiresAt || c.expiresAt > Date.now())
    );
  }

  hasConsent(subjectId: string, purpose: string): boolean {
    return this.getActiveConsents(subjectId).some((c) => c.purpose === purpose);
  }

  listAllClassifications(): DataClassification[] {
    return Array.from(this.classifications.values());
  }

  listAllConsents(): ConsentRecord[] {
    return Array.from(this.consents.values());
  }
}
