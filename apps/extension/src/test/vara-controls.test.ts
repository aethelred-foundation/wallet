/**
 * Tests for the VARA (Abu Dhabi / Dubai) jurisdiction controls:
 * registered addresses, the AED 3,500 Travel Rule threshold, custodial
 * proof-of-reserves, and the 24-hour incident-reporting rule.
 */

import { describe, it, expect } from "vitest";
import {
  VaraComplianceEngine,
  VARA_TRAVEL_RULE_THRESHOLD_AED,
  VARA_INCIDENT_REPORT_WINDOW_MS,
  AED_PER_USD,
} from "@aethelred/wallet-compliance";

const ADDR = "0xAbC0000000000000000000000000000000001234";
const T0 = 1_750_000_000_000; // fixed clock for deterministic deadlines

describe("VARA registered addresses (control a)", () => {
  it("registers and looks up case-insensitively", () => {
    const e = new VaraComplianceEngine();
    e.registerAddress({ address: ADDR, licenseNumber: "VARA-VA-0042", entityName: "Aethelred Custody FZE", now: T0 });
    expect(e.isRegistered(ADDR.toLowerCase())).toBe(true);
    expect(e.isRegistered(ADDR.toUpperCase().replace("0X", "0x"))).toBe(true);
    expect(e.getRegistration(ADDR)?.licenseNumber).toBe("VARA-VA-0042");
  });

  it("treats unknown addresses as unregistered", () => {
    const e = new VaraComplianceEngine();
    expect(e.isRegistered("0x" + "00".repeat(20))).toBe(false);
  });

  it("revokes a registration", () => {
    const e = new VaraComplianceEngine();
    e.registerAddress({ address: ADDR, licenseNumber: "VARA-VA-0042", entityName: "X" });
    expect(e.isRegistered(ADDR)).toBe(true);
    const revoked = e.revokeAddress(ADDR);
    expect(revoked.status).toBe("revoked");
    expect(e.isRegistered(ADDR)).toBe(false);
  });

  it("rejects malformed addresses and empty licences", () => {
    const e = new VaraComplianceEngine();
    expect(() => e.registerAddress({ address: "0xnothex", licenseNumber: "L", entityName: "X" })).toThrow(/invalid wallet address/);
    expect(() => e.registerAddress({ address: ADDR, licenseNumber: "  ", entityName: "X" })).toThrow(/licenseNumber/);
    expect(() => e.revokeAddress("0x" + "00".repeat(20))).toThrow(/not registered/);
  });
});

describe("VARA Travel Rule threshold (control b)", () => {
  const e = new VaraComplianceEngine();

  it("uses the AED 3,500 threshold", () => {
    expect(VARA_TRAVEL_RULE_THRESHOLD_AED).toBe(3500);
    expect(e.requiresTravelRule(3500).required).toBe(true);
    expect(e.requiresTravelRule(3499.99).required).toBe(false);
    expect(e.requiresTravelRule(10000)).toEqual({ required: true, amountAed: 10000, thresholdAed: 3500 });
  });

  it("converts USD at the pegged rate", () => {
    expect(AED_PER_USD).toBeCloseTo(3.6725, 4);
    // 1000 USD → 3672.5 AED ≥ 3500 → required
    expect(e.requiresTravelRuleUsd(1000).required).toBe(true);
    // 900 USD → 3305.25 AED < 3500 → not required
    expect(e.requiresTravelRuleUsd(900).required).toBe(false);
    expect(e.requiresTravelRuleUsd(1000, 4).amountAed).toBe(4000);
  });
});

describe("VARA proof-of-reserves (control c)", () => {
  it("flags solvency and computes the reserve ratio in bps", () => {
    const e = new VaraComplianceEngine();
    const solvent = e.attestReserves({ asset: "USDC", reservesHeld: 2_000_000n, customerLiabilities: 1_000_000n, attestor: "auditor-1" });
    expect(solvent.solvent).toBe(true);
    expect(solvent.reserveRatioBps).toBe(20000); // 200%

    const insolvent = e.attestReserves({ asset: "USDC", reservesHeld: 900_000n, customerLiabilities: 1_000_000n, attestor: "auditor-1" });
    expect(insolvent.solvent).toBe(false);
    expect(insolvent.reserveRatioBps).toBe(9000); // 90%
  });

  it("handles zero liabilities and rejects negatives", () => {
    const e = new VaraComplianceEngine();
    expect(e.attestReserves({ asset: "ETH", reservesHeld: 0n, customerLiabilities: 0n, attestor: "a" }).reserveRatioBps).toBe(0);
    expect(e.attestReserves({ asset: "ETH", reservesHeld: 5n, customerLiabilities: 0n, attestor: "a" }).reserveRatioBps).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => e.attestReserves({ asset: "ETH", reservesHeld: -1n, customerLiabilities: 0n, attestor: "a" })).toThrow(/non-negative/);
  });

  it("returns the latest attestation per asset", () => {
    const e = new VaraComplianceEngine();
    e.attestReserves({ asset: "USDC", reservesHeld: 1n, customerLiabilities: 1n, attestor: "a", now: T0 });
    e.attestReserves({ asset: "USDC", reservesHeld: 9n, customerLiabilities: 1n, attestor: "a", now: T0 + 1000 });
    expect(e.latestReservesForAsset("USDC")?.reservesHeld).toBe(9n);
    expect(e.latestReservesForAsset("DAI")).toBeUndefined();
  });
});

describe("VARA 24-hour incident reporting (control d)", () => {
  it("sets a 24-hour deadline and detects overdue", () => {
    const e = new VaraComplianceEngine();
    const inc = e.reportIncident({ summary: "Unauthorized signing attempt", severity: "high", detectedAt: T0 });
    expect(inc.reportDeadline).toBe(T0 + VARA_INCIDENT_REPORT_WINDOW_MS);
    expect(VARA_INCIDENT_REPORT_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    expect(e.isIncidentOverdue(inc.id, T0 + 1000)).toBe(false);
    expect(e.isIncidentOverdue(inc.id, T0 + VARA_INCIDENT_REPORT_WINDOW_MS + 1)).toBe(true);
  });

  it("stops counting as overdue once reported", () => {
    const e = new VaraComplianceEngine();
    const inc = e.reportIncident({ summary: "x", severity: "critical", detectedAt: T0 });
    e.markIncidentReported(inc.id, T0 + 60_000);
    const after = T0 + VARA_INCIDENT_REPORT_WINDOW_MS + 1;
    expect(e.isIncidentOverdue(inc.id, after)).toBe(false);
    expect(e.listOverdueIncidents(after)).toHaveLength(0);
  });

  it("lists overdue open incidents and throws on unknown ids", () => {
    const e = new VaraComplianceEngine();
    e.reportIncident({ summary: "a", severity: "low", detectedAt: T0 });
    e.reportIncident({ summary: "b", severity: "low", detectedAt: T0 });
    expect(e.listOverdueIncidents(T0 + VARA_INCIDENT_REPORT_WINDOW_MS + 1)).toHaveLength(2);
    expect(() => e.markIncidentReported("nope")).toThrow(/not found/);
    expect(() => e.isIncidentOverdue("nope")).toThrow(/not found/);
  });
});

describe("VaraComplianceEngine.toSnapshot", () => {
  it("exports all three control collections", () => {
    const e = new VaraComplianceEngine();
    e.registerAddress({ address: ADDR, licenseNumber: "L", entityName: "X" });
    e.attestReserves({ asset: "USDC", reservesHeld: 1n, customerLiabilities: 1n, attestor: "a" });
    e.reportIncident({ summary: "i", severity: "low" });
    const snap = e.toSnapshot();
    expect(snap.registrations).toHaveLength(1);
    expect(snap.reserves).toHaveLength(1);
    expect(snap.incidents).toHaveLength(1);
  });
});
