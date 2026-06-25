/**
 * Tests for Travel Rule interoperability — IVMS101 mapping/validation and
 * the protocol-agnostic transport routing (TRISA / OpenVASP / Sygna /
 * Notabene). Focus: the FATF R.16 above-threshold originator-identifier
 * rule and the prepare → transmit path with a fake transport.
 */

import { describe, it, expect, vi } from "vitest";
import {
  TravelRuleInteropEngine,
  TravelRuleInteropError,
  NoopTravelRuleTransport,
  buildIvms101Message,
  validateIvms101,
  type TravelRuleTransport,
} from "@aethelred/wallet-compliance";

// Local copy of the shapes we need (the package exports the runtime; the
// record type lives in the compliance types barrel).
function record(overrides: Record<string, unknown> = {}): any {
  return {
    id: "tr-1",
    transactionId: "0xabc",
    originator: { name: "Alice Example", accountNumber: "0x" + "11".repeat(20), geographicAddress: "1 Market St, AE" },
    beneficiary: { name: "Bob Example", accountNumber: "0x" + "22".repeat(20) },
    amount: "5000",
    currency: "USDC",
    assetType: "stablecoin",
    transferDate: 1_750_000_000_000,
    originatingVasp: { name: "Aethelred Custody FZE", jurisdiction: "AE", lei: "5493001KJTIIGC8Y1R12" },
    beneficiaryVasp: { name: "NoblePay", jurisdiction: "AE" },
    screeningResult: { sanctionsMatch: false, pepMatch: false, adverseMediaMatch: false, riskScore: 2, screenedAt: 0, provider: "fake" },
    threshold: "below",
    status: "pending",
    ...overrides,
  };
}

describe("buildIvms101Message", () => {
  it("maps originator/beneficiary/VASPs and metadata", () => {
    const msg = buildIvms101Message(record());
    expect(msg.originator.persons[0].name).toBe("Alice Example");
    expect(msg.originator.accountNumbers[0]).toBe("0x" + "11".repeat(20));
    expect(msg.beneficiary.persons[0].name).toBe("Bob Example");
    expect(msg.originatingVasp?.name).toBe("Aethelred Custody FZE");
    expect(msg.beneficiaryVasp?.jurisdiction).toBe("AE");
    expect(msg.payloadMetadata).toMatchObject({ amount: "5000", currency: "USDC", transactionId: "0xabc" });
  });

  it("classifies a party with an LEI as a legal person", () => {
    const msg = buildIvms101Message(record({ originator: { name: "ACME Corp", accountNumber: "0x" + "11".repeat(20), legalEntityId: "5493001KJTIIGC8Y1R12" } }));
    expect(msg.originator.persons[0].kind).toBe("legal");
    expect(msg.originator.persons[0].lei).toBe("5493001KJTIIGC8Y1R12");
  });
});

describe("validateIvms101 (FATF R.16)", () => {
  it("passes a complete below-threshold message", () => {
    expect(validateIvms101(buildIvms101Message(record())).valid).toBe(true);
  });

  it("flags missing VASP / party fields", () => {
    const v = validateIvms101(buildIvms101Message(record({ originatingVasp: undefined })));
    expect(v.valid).toBe(false);
    expect(v.missing).toContain("originatingVasp.name");
  });

  it("requires an originator identifier above threshold", () => {
    // above threshold, originator has NO address/nationalId/dob+pob
    const bare = record({ threshold: "above", originator: { name: "Alice", accountNumber: "0x" + "11".repeat(20) } });
    const v = validateIvms101(buildIvms101Message(bare), true);
    expect(v.valid).toBe(false);
    expect(v.missing.some((m) => m.startsWith("originator.identifier"))).toBe(true);
  });

  it("accepts any one of address / nationalId / dob+pob above threshold", () => {
    const acct = "0x" + "11".repeat(20);
    const addr = record({ threshold: "above", originator: { name: "A", accountNumber: acct, geographicAddress: "x" } });
    const nat = record({ threshold: "above", originator: { name: "A", accountNumber: acct, nationalId: "ID-1" } });
    const dob = record({ threshold: "above", originator: { name: "A", accountNumber: acct, dateOfBirth: "1990-01-01", placeOfBirth: "AE" } });
    for (const r of [addr, nat, dob]) {
      expect(validateIvms101(buildIvms101Message(r), true).valid).toBe(true);
    }
  });
});

describe("TravelRuleInteropEngine", () => {
  function fakeTransport(protocol: TravelRuleTransport["protocol"]) {
    const send = vi.fn(async () => ({ accepted: true, reference: "ref-1" }));
    return { transport: { protocol, send } as TravelRuleTransport, send };
  }

  it("prepares a validated envelope", () => {
    const engine = new TravelRuleInteropEngine();
    const env = engine.prepareEnvelope(record(), "trisa");
    expect(env.protocol).toBe("trisa");
    expect(env.messageId).toMatch(/^tr-msg-/);
    expect(env.ivms101.originator.persons[0].name).toBe("Alice Example");
  });

  it("refuses to prepare an incomplete above-threshold envelope", () => {
    const engine = new TravelRuleInteropEngine();
    const bad = record({ threshold: "above", originator: { name: "A", accountNumber: "0x" + "11".repeat(20) } });
    expect(() => engine.prepareEnvelope(bad, "openvasp")).toThrow(TravelRuleInteropError);
  });

  it("transmits through the registered transport and lists protocols", async () => {
    const engine = new TravelRuleInteropEngine();
    const { transport, send } = fakeTransport("trisa");
    engine.registerTransport(transport);
    expect(engine.supportedProtocols()).toEqual(["trisa"]);
    const res = await engine.transmit(record(), "trisa");
    expect(res).toEqual({ accepted: true, reference: "ref-1" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("throws when no transport is registered for the protocol", async () => {
    const engine = new TravelRuleInteropEngine();
    await expect(engine.transmit(record(), "sygna")).rejects.toBeInstanceOf(TravelRuleInteropError);
  });

  it("ingests an inbound message without throwing", () => {
    const engine = new TravelRuleInteropEngine();
    const v = engine.ingest(buildIvms101Message(record({ beneficiary: { name: "", accountNumber: "" } })));
    expect(v.valid).toBe(false);
    expect(v.missing).toContain("beneficiary.name");
  });

  it("NoopTravelRuleTransport accepts nothing", async () => {
    const res = await new NoopTravelRuleTransport().send();
    expect(res.accepted).toBe(false);
  });
});
