import type { TransactionScreening, RiskRating, ScreeningResult, SanctionsMatch } from "./types";

function generateId(): string {
  return `scr-${crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
}

// Known high-risk address patterns (in production: use Chainalysis/Elliptic API)
const HIGH_RISK_PREFIXES = new Set(["0x0000", "0xdead"]);

// Known mixer/tumbler contracts
const MIXER_ADDRESSES = new Set([
  "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b", // Tornado Cash Router
  "0x722122df12d4e14e13ac3b6895a86e84145b6967", // Tornado Cash Proxy
]);

// Sanctioned jurisdictions
const HIGH_RISK_JURISDICTIONS = new Set(["KP", "IR", "SY", "CU", "RU"]);

/**
 * Transaction screening engine for AML/CFT compliance.
 * Screens addresses against sanctions lists, mixer contracts,
 * high-risk patterns, and jurisdiction rules.
 */
export class TransactionScreeningEngine {
  private screenings = new Map<string, TransactionScreening>();

  async screenTransaction(opts: {
    fromAddress: string;
    toAddress: string;
    amount: string;
    asset: string;
    transactionHash?: string;
    /**
     * ISO 3166-1 alpha-2 code of the counterparty's jurisdiction if
     * known (derived from KYC data or exchange-provided hints). When
     * supplied, the screening engine cross-checks it against the FATF
     * high-risk list; this is a compliance requirement, not a nice-to-have.
     */
    counterpartyJurisdiction?: string;
  }): Promise<TransactionScreening> {
    const fromRisk = this.assessAddressRisk(opts.fromAddress);
    const toRisk = this.assessAddressRisk(opts.toAddress);

    const sanctionsFlag = this.checkSanctions(opts.toAddress);
    const mixerFlag = MIXER_ADDRESSES.has(opts.toAddress.toLowerCase());
    const unusualPattern = this.detectUnusualPattern(opts.amount, opts.asset);
    const highRiskJurisdiction = opts.counterpartyJurisdiction
      ? HIGH_RISK_JURISDICTIONS.has(opts.counterpartyJurisdiction.toUpperCase())
      : false;

    const overallRisk = this.computeOverallRisk(fromRisk, toRisk, sanctionsFlag, mixerFlag || highRiskJurisdiction);
    const decision = this.makeDecision(overallRisk, sanctionsFlag, mixerFlag || highRiskJurisdiction);

    const screening: TransactionScreening = {
      id: generateId(),
      transactionHash: opts.transactionHash,
      fromAddress: opts.fromAddress,
      toAddress: opts.toAddress,
      amount: opts.amount,
      asset: opts.asset,
      fromAddressRisk: fromRisk,
      toAddressRisk: toRisk,
      overallRisk,
      sanctionsFlag,
      mixerFlag,
      darknetFlag: false,
      highRiskJurisdiction,
      unusualPattern,
      decision,
      screenedAt: Date.now(),
    };

    this.screenings.set(screening.id, screening);
    return screening;
  }

  async screenAddress(address: string): Promise<ScreeningResult> {
    const sanctions = this.checkSanctionsDetailed(address);
    const riskScore = this.computeAddressRiskScore(address);

    return {
      sanctionsMatch: sanctions.length > 0,
      pepMatch: false, // Requires external PEP database
      adverseMediaMatch: false, // Requires media screening API
      riskScore,
      screenedAt: Date.now(),
      provider: "aethelred-internal",
      matchDetails: sanctions,
    };
  }

  reviewScreening(screeningId: string, reviewerId: string, decision: "approve" | "block", notes: string): TransactionScreening {
    const screening = this.screenings.get(screeningId);
    if (!screening) throw new Error(`Screening not found: ${screeningId}`);
    screening.decision = decision;
    screening.reviewedBy = reviewerId;
    screening.reviewedAt = Date.now();
    screening.reviewNotes = notes;
    return screening;
  }

  getScreening(id: string): TransactionScreening | undefined {
    return this.screenings.get(id);
  }

  listScreenings(decision?: TransactionScreening["decision"]): TransactionScreening[] {
    const all = Array.from(this.screenings.values());
    return decision ? all.filter((s) => s.decision === decision) : all;
  }

  listFlagged(): TransactionScreening[] {
    return Array.from(this.screenings.values()).filter(
      (s) => s.sanctionsFlag || s.mixerFlag || s.darknetFlag || s.decision === "review" || s.decision === "escalate"
    );
  }

  private assessAddressRisk(address: string): RiskRating {
    const lower = address.toLowerCase();
    if (MIXER_ADDRESSES.has(lower)) return "prohibited";
    if (HIGH_RISK_PREFIXES.has(lower.slice(0, 6))) return "high";
    return "low";
  }

  private checkSanctions(address: string): boolean {
    // In production: call Chainalysis/Elliptic/TRM Labs API
    return MIXER_ADDRESSES.has(address.toLowerCase());
  }

  private checkSanctionsDetailed(address: string): SanctionsMatch[] {
    if (MIXER_ADDRESSES.has(address.toLowerCase())) {
      return [{
        listName: "OFAC SDN",
        matchScore: 100,
        matchedName: "Tornado Cash",
        listDate: "2022-08-08",
      }];
    }
    return [];
  }

  private detectUnusualPattern(amount: string, asset: string): boolean {
    const value = parseFloat(amount);
    // Structuring detection: amounts just below reporting thresholds
    // Different assets have different structuring thresholds — stablecoins
    // track fiat CTR/EU-3k limits; native assets use volatility-scaled
    // thresholds. For now the heuristic is the same for all assets but
    // we keep the parameter so callers can trace which asset triggered.
    void asset;
    if (value > 9500 && value < 10000) return true; // $10K CTR threshold
    if (value > 2800 && value < 3000) return true; // €3K EU threshold
    return false;
  }

  private computeAddressRiskScore(address: string): number {
    let score = 20; // Base score
    if (MIXER_ADDRESSES.has(address.toLowerCase())) score = 100;
    if (HIGH_RISK_PREFIXES.has(address.toLowerCase().slice(0, 6))) score += 30;
    return Math.min(score, 100);
  }

  private computeOverallRisk(from: RiskRating, to: RiskRating, sanctions: boolean, mixer: boolean): RiskRating {
    if (sanctions || mixer) return "prohibited";
    if (from === "high" || to === "high") return "high";
    if (from === "medium" || to === "medium") return "medium";
    return "low";
  }

  private makeDecision(risk: RiskRating, sanctions: boolean, mixer: boolean): TransactionScreening["decision"] {
    if (sanctions || mixer || risk === "prohibited") return "block";
    if (risk === "high") return "escalate";
    if (risk === "medium") return "review";
    return "approve";
  }
}
