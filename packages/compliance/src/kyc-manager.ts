import type { KycProfile, KycDocument, KycLevel, KycStatus, RiskFactor, RiskRating } from "./types";

function generateId(prefix: string): string {
  return `${prefix}-${crypto.getRandomValues(new Uint8Array(12)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
}

/**
 * KYC/AML identity verification manager.
 * Handles multi-level KYC (basic → institutional), document management,
 * risk assessment, and ongoing monitoring.
 */
export class KycManager {
  private profiles = new Map<string, KycProfile>();

  createProfile(subjectId: string, entityType: KycProfile["entityType"], jurisdiction: string): KycProfile {
    const profile: KycProfile = {
      id: generateId("kyc"),
      subjectId,
      level: "basic",
      status: "not-started",
      riskRating: "medium",
      entityType,
      jurisdiction,
      identityVerified: false,
      addressVerified: false,
      sourceOfFundsVerified: false,
      sanctionsScreened: false,
      pepScreened: false,
      documents: [],
      riskFactors: [],
    };
    this.profiles.set(profile.id, profile);
    return profile;
  }

  submitForVerification(profileId: string): KycProfile {
    const profile = this.getProfile(profileId);
    profile.status = "pending";
    profile.submittedAt = Date.now();
    return profile;
  }

  updateVerification(profileId: string, updates: {
    identityVerified?: boolean;
    addressVerified?: boolean;
    sourceOfFundsVerified?: boolean;
    sanctionsScreened?: boolean;
    pepScreened?: boolean;
  }): KycProfile {
    const profile = this.getProfile(profileId);
    Object.assign(profile, updates);
    profile.lastScreenedAt = Date.now();

    // Auto-determine status based on verification state
    if (updates.sanctionsScreened && profile.riskRating === "prohibited") {
      profile.status = "rejected";
    } else if (profile.identityVerified && profile.addressVerified && profile.sanctionsScreened) {
      profile.status = "verified";
      profile.verifiedAt = Date.now();
      profile.expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000; // 1 year
    }

    return profile;
  }

  upgradeLevel(profileId: string, newLevel: KycLevel): KycProfile {
    const profile = this.getProfile(profileId);
    const levelOrder: KycLevel[] = ["basic", "standard", "enhanced", "institutional"];
    const currentIdx = levelOrder.indexOf(profile.level);
    const newIdx = levelOrder.indexOf(newLevel);
    if (newIdx <= currentIdx) throw new Error(`Cannot downgrade from ${profile.level} to ${newLevel}`);

    profile.level = newLevel;
    // Enhanced and institutional require source of funds
    if (newLevel === "enhanced" || newLevel === "institutional") {
      if (!profile.sourceOfFundsVerified) {
        profile.status = "pending"; // Requires additional verification
      }
    }
    return profile;
  }

  addDocument(profileId: string, doc: Omit<KycDocument, "id" | "status" | "uploadedAt">): KycDocument {
    const profile = this.getProfile(profileId);
    const document: KycDocument = {
      id: generateId("doc"),
      ...doc,
      status: "pending",
      uploadedAt: Date.now(),
    };
    profile.documents.push(document);
    return document;
  }

  addRiskFactor(profileId: string, factor: Omit<RiskFactor, "detectedAt" | "mitigated">): void {
    const profile = this.getProfile(profileId);
    profile.riskFactors.push({
      ...factor,
      detectedAt: Date.now(),
      mitigated: false,
    });
    profile.riskRating = this.calculateRiskRating(profile);
  }

  assessRisk(profileId: string): RiskRating {
    const profile = this.getProfile(profileId);
    return this.calculateRiskRating(profile);
  }

  isVerified(profileId: string): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) return false;
    if (profile.status !== "verified") return false;
    if (profile.expiresAt && profile.expiresAt < Date.now()) return false;
    return true;
  }

  requiresEnhancedDueDiligence(profileId: string): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) return true;
    return profile.riskRating === "high" || profile.entityType === "trust" || profile.entityType === "dao";
  }

  getProfile(id: string): KycProfile {
    const profile = this.profiles.get(id);
    if (!profile) throw new Error(`KYC profile not found: ${id}`);
    return profile;
  }

  getBySubject(subjectId: string): KycProfile | undefined {
    return Array.from(this.profiles.values()).find((p) => p.subjectId === subjectId);
  }

  listProfiles(status?: KycStatus): KycProfile[] {
    const all = Array.from(this.profiles.values());
    return status ? all.filter((p) => p.status === status) : all;
  }

  private calculateRiskRating(profile: KycProfile): RiskRating {
    const activeFactors = profile.riskFactors.filter((f) => !f.mitigated);
    if (activeFactors.some((f) => f.level === "prohibited")) return "prohibited";
    if (activeFactors.some((f) => f.level === "high")) return "high";
    if (activeFactors.filter((f) => f.level === "medium").length >= 2) return "high";
    if (activeFactors.some((f) => f.level === "medium")) return "medium";
    return "low";
  }

  loadFromSnapshot(profiles: KycProfile[]): void {
    this.profiles.clear();
    for (const p of profiles) this.profiles.set(p.id, p);
  }

  toSnapshot(): KycProfile[] {
    return Array.from(this.profiles.values());
  }
}
