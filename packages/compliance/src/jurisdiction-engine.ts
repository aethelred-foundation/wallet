import type { JurisdictionConfig } from "./enterprise-types";

/**
 * Jurisdiction-aware compliance engine.
 * Maps regulatory requirements per country/region with AML thresholds,
 * KYC levels, sanctions lists, data residency, and filing requirements.
 */
export class JurisdictionEngine {
  private configs = new Map<string, JurisdictionConfig>();

  constructor() {
    this.seedDefaultConfigs();
  }

  getConfig(jurisdictionCode: string): JurisdictionConfig {
    const config = this.configs.get(jurisdictionCode.toUpperCase());
    if (!config) {
      // Default to strict config for unknown jurisdictions
      return this.configs.get("DEFAULT")!;
    }
    return config;
  }

  getAmlThreshold(jurisdictionCode: string): number {
    return this.getConfig(jurisdictionCode).amlThresholds.reportingThresholdUsd;
  }

  getTravelRuleThreshold(jurisdictionCode: string): number {
    return this.getConfig(jurisdictionCode).amlThresholds.travelRuleThresholdUsd;
  }

  getRequiredKycLevel(jurisdictionCode: string): string {
    return this.getConfig(jurisdictionCode).kycRequirements.minimumLevel;
  }

  getUboThreshold(jurisdictionCode: string): number {
    return this.getConfig(jurisdictionCode).kycRequirements.uboThresholdPercent;
  }

  getRequiredSanctionsLists(jurisdictionCode: string): string[] {
    return this.getConfig(jurisdictionCode).sanctionsLists;
  }

  isHighRisk(jurisdictionCode: string): boolean {
    const config = this.getConfig(jurisdictionCode);
    return config.riskLevel === "high" || config.riskLevel === "very-high" || config.riskLevel === "prohibited";
  }

  isProhibited(jurisdictionCode: string): boolean {
    return this.getConfig(jurisdictionCode).riskLevel === "prohibited";
  }

  requiresDataResidency(jurisdictionCode: string): boolean {
    return this.getConfig(jurisdictionCode).dataResidency.required;
  }

  requiresEnhancedDueDiligence(jurisdictionCode: string, entityType: string): boolean {
    const config = this.getConfig(jurisdictionCode);
    return config.kycRequirements.eddTriggers.includes(entityType) || this.isHighRisk(jurisdictionCode);
  }

  listAllJurisdictions(): JurisdictionConfig[] {
    return Array.from(this.configs.values()).filter((c) => c.code !== "DEFAULT");
  }

  listHighRisk(): JurisdictionConfig[] {
    return this.listAllJurisdictions().filter((c) => c.riskLevel === "high" || c.riskLevel === "very-high");
  }

  listProhibited(): JurisdictionConfig[] {
    return this.listAllJurisdictions().filter((c) => c.riskLevel === "prohibited");
  }

  addCustomConfig(config: JurisdictionConfig): void {
    this.configs.set(config.code.toUpperCase(), config);
  }

  private seedDefaultConfigs(): void {
    const configs: JurisdictionConfig[] = [
      {
        code: "AE", name: "United Arab Emirates", riskLevel: "low",
        kycRequirements: { minimumLevel: "enhanced", documentTypes: ["passport", "national-id", "utility-bill"], uboThresholdPercent: 25, eddTriggers: ["trust", "foundation", "dao"] },
        amlThresholds: { reportingThresholdLocal: 55000, reportingCurrency: "AED", reportingThresholdUsd: 15000, travelRuleThresholdUsd: 1000, ctrThresholdUsd: 15000 },
        sanctionsLists: ["OFAC SDN", "UN Consolidated", "UAE Local"],
        dataResidency: { required: true, allowedRegions: ["AE", "GCC"] },
        reportingRequirements: { sarRequired: true, ctrRequired: true, periodicReportingFrequency: "quarterly", regulatoryBody: "CBUAE", filingFormat: "goAML" },
      },
      {
        code: "US", name: "United States", riskLevel: "low",
        kycRequirements: { minimumLevel: "standard", documentTypes: ["passport", "drivers-license", "bank-statement"], uboThresholdPercent: 25, eddTriggers: ["trust", "shell-company", "high-value"] },
        amlThresholds: { reportingThresholdLocal: 10000, reportingCurrency: "USD", reportingThresholdUsd: 10000, travelRuleThresholdUsd: 3000, ctrThresholdUsd: 10000 },
        sanctionsLists: ["OFAC SDN", "OFAC Consolidated", "FinCEN 314a"],
        dataResidency: { required: false },
        reportingRequirements: { sarRequired: true, ctrRequired: true, periodicReportingFrequency: "quarterly", regulatoryBody: "FinCEN", filingFormat: "FinCEN XML" },
      },
      {
        code: "GB", name: "United Kingdom", riskLevel: "low",
        kycRequirements: { minimumLevel: "standard", documentTypes: ["passport", "national-id", "utility-bill"], uboThresholdPercent: 25, eddTriggers: ["pep", "high-risk-country", "complex-structure"] },
        amlThresholds: { reportingThresholdLocal: 10000, reportingCurrency: "GBP", reportingThresholdUsd: 12500, travelRuleThresholdUsd: 1000, ctrThresholdUsd: 12500 },
        sanctionsLists: ["OFSI Consolidated", "UN Consolidated", "EU Sanctions"],
        dataResidency: { required: false },
        reportingRequirements: { sarRequired: true, ctrRequired: false, regulatoryBody: "FCA", filingFormat: "DAML SAR" },
      },
      {
        code: "SG", name: "Singapore", riskLevel: "low",
        kycRequirements: { minimumLevel: "enhanced", documentTypes: ["passport", "national-id"], uboThresholdPercent: 25, eddTriggers: ["pep", "high-risk-country", "complex-ownership"] },
        amlThresholds: { reportingThresholdLocal: 20000, reportingCurrency: "SGD", reportingThresholdUsd: 15000, travelRuleThresholdUsd: 1500, ctrThresholdUsd: 15000 },
        sanctionsLists: ["UN Consolidated", "MAS Sanctions"],
        dataResidency: { required: false },
        reportingRequirements: { sarRequired: true, ctrRequired: true, regulatoryBody: "MAS", filingFormat: "STRO Format" },
      },
      {
        code: "EU", name: "European Union", riskLevel: "low",
        kycRequirements: { minimumLevel: "standard", documentTypes: ["passport", "national-id", "utility-bill"], uboThresholdPercent: 25, eddTriggers: ["pep", "high-risk-third-country", "complex-transaction"] },
        amlThresholds: { reportingThresholdLocal: 10000, reportingCurrency: "EUR", reportingThresholdUsd: 11000, travelRuleThresholdUsd: 1000, ctrThresholdUsd: 10000 },
        sanctionsLists: ["EU Consolidated", "UN Consolidated"],
        dataResidency: { required: true, allowedRegions: ["EU", "EEA"] },
        reportingRequirements: { sarRequired: true, ctrRequired: false, regulatoryBody: "National FIU", filingFormat: "goAML" },
      },
      {
        code: "KP", name: "North Korea", riskLevel: "prohibited",
        kycRequirements: { minimumLevel: "institutional", documentTypes: [], uboThresholdPercent: 0, eddTriggers: ["all"] },
        amlThresholds: { reportingThresholdLocal: 0, reportingCurrency: "KPW", reportingThresholdUsd: 0, travelRuleThresholdUsd: 0, ctrThresholdUsd: 0 },
        sanctionsLists: ["OFAC SDN", "UN Consolidated", "EU Sanctions"],
        dataResidency: { required: false },
        reportingRequirements: { sarRequired: true, ctrRequired: true, regulatoryBody: "N/A", filingFormat: "N/A" },
      },
      {
        code: "IR", name: "Iran", riskLevel: "prohibited",
        kycRequirements: { minimumLevel: "institutional", documentTypes: [], uboThresholdPercent: 0, eddTriggers: ["all"] },
        amlThresholds: { reportingThresholdLocal: 0, reportingCurrency: "IRR", reportingThresholdUsd: 0, travelRuleThresholdUsd: 0, ctrThresholdUsd: 0 },
        sanctionsLists: ["OFAC SDN", "UN Consolidated", "EU Sanctions"],
        dataResidency: { required: false },
        reportingRequirements: { sarRequired: true, ctrRequired: true, regulatoryBody: "N/A", filingFormat: "N/A" },
      },
    ];

    for (const config of configs) {
      this.configs.set(config.code, config);
    }

    // Default strict config for unknown jurisdictions
    this.configs.set("DEFAULT", {
      code: "DEFAULT", name: "Unknown Jurisdiction", riskLevel: "high",
      kycRequirements: { minimumLevel: "enhanced", documentTypes: ["passport"], uboThresholdPercent: 10, eddTriggers: ["all"] },
      amlThresholds: { reportingThresholdLocal: 1000, reportingCurrency: "USD", reportingThresholdUsd: 1000, travelRuleThresholdUsd: 1000, ctrThresholdUsd: 1000 },
      sanctionsLists: ["OFAC SDN", "UN Consolidated", "EU Sanctions"],
      dataResidency: { required: true },
      reportingRequirements: { sarRequired: true, ctrRequired: true, regulatoryBody: "Unknown", filingFormat: "JSON" },
    });
  }
}
