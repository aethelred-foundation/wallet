/**
 * Tests for the PENDING_TRAVEL_RULE exchange state machine: a transfer is held
 * awaiting the beneficiary VASP, may only proceed once accepted, and times out
 * if unanswered. Transport (the mTLS handshake) is faked.
 */

import { describe, it, expect, vi } from "vitest";
import {
  TravelRuleInteropEngine,
  TravelRuleExchangeManager,
  TravelRuleExchangeError,
  TravelRuleInteropError,
  type TravelRuleTransport,
} from "@aethelred/wallet-compliance";

const T0 = 1_750_000_000_000;

function record(over: Record<string, unknown> = {}): any {
  return {
    id: "tr", transactionId: "tx-1",
    originator: { name: "Alice", accountNumber: "0x" + "11".repeat(20), geographicAddress: "AE" },
    beneficiary: { name: "Bob", accountNumber: "0x" + "22".repeat(20) },
    amount: "5000", currency: "USDC", assetType: "stablecoin", transferDate: T0,
    originatingVasp: { name: "Aethelred", jurisdiction: "AE" }, beneficiaryVasp: { name: "NoblePay", jurisdiction: "AE" },
    screeningResult: { sanctionsMatch: false, pepMatch: false, adverseMediaMatch: false, riskScore: 1, screenedAt: 0, provider: "x" },
    threshold: "below", status: "pending", ...over,
  };
}

function engineWith(send: TravelRuleTransport["send"]): TravelRuleInteropEngine {
  const engine = new TravelRuleInteropEngine();
  engine.registerTransport({ protocol: "trisa", send });
  return engine;
}

describe("initiate", () => {
  it("transmits and opens an awaiting-beneficiary exchange (held: mayProceed false)", async () => {
    const send = vi.fn(async () => ({ accepted: true, reference: "trisa-ref-1" }));
    const mgr = new TravelRuleExchangeManager(engineWith(send));
    const ex = await mgr.initiate(record(), "trisa", T0);
    expect(ex.state).toBe("awaiting-beneficiary");
    expect(ex.reference).toBe("trisa-ref-1");
    expect(send).toHaveBeenCalledOnce();
    expect(mgr.mayProceed(ex.id)).toBe(false);
  });

  it("marks the exchange rejected if the transport fails to send", async () => {
    const mgr = new TravelRuleExchangeManager(engineWith(async () => ({ accepted: false, error: "vasp unreachable" })));
    const ex = await mgr.initiate(record(), "trisa", T0);
    expect(ex.state).toBe("rejected");
    expect(ex.reason).toMatch(/unreachable/);
  });

  it("refuses to initiate with an incomplete IVMS101 payload (above threshold)", async () => {
    const mgr = new TravelRuleExchangeManager(engineWith(async () => ({ accepted: true })));
    const bad = record({ threshold: "above", originator: { name: "A", accountNumber: "0x" + "11".repeat(20) } });
    await expect(mgr.initiate(bad, "trisa", T0)).rejects.toBeInstanceOf(TravelRuleInteropError);
  });

  it("throws when no transport is registered for the protocol", async () => {
    const mgr = new TravelRuleExchangeManager(new TravelRuleInteropEngine());
    await expect(mgr.initiate(record(), "openvasp", T0)).rejects.toBeInstanceOf(TravelRuleInteropError);
  });
});

describe("beneficiary response", () => {
  async function open() {
    const mgr = new TravelRuleExchangeManager(engineWith(async () => ({ accepted: true })));
    const ex = await mgr.initiate(record(), "trisa", T0);
    return { mgr, id: ex.id };
  }

  it("accept → the transfer may proceed", async () => {
    const { mgr, id } = await open();
    mgr.recordBeneficiaryResponse(id, true, T0 + 1000);
    expect(mgr.get(id)?.state).toBe("accepted");
    expect(mgr.mayProceed(id)).toBe(true);
  });

  it("reject → still cannot proceed", async () => {
    const { mgr, id } = await open();
    mgr.recordBeneficiaryResponse(id, false, T0 + 1000, "beneficiary declined");
    expect(mgr.get(id)?.state).toBe("rejected");
    expect(mgr.mayProceed(id)).toBe(false);
  });

  it("cannot respond twice / to an unknown exchange", async () => {
    const { mgr, id } = await open();
    mgr.recordBeneficiaryResponse(id, true);
    expect(() => mgr.recordBeneficiaryResponse(id, false)).toThrow(/cannot record/);
    expect(() => mgr.recordBeneficiaryResponse("nope", true)).toThrow(TravelRuleExchangeError);
  });
});

describe("timeout", () => {
  it("times out an unanswered exchange past its deadline", async () => {
    const mgr = new TravelRuleExchangeManager(engineWith(async () => ({ accepted: true })), { timeoutMs: 1000 });
    const ex = await mgr.initiate(record(), "trisa", T0);
    expect(mgr.expireStale(T0 + 500)).toHaveLength(0); // within window
    const expired = mgr.expireStale(T0 + 2000);
    expect(expired.map((e) => e.id)).toContain(ex.id);
    expect(mgr.get(ex.id)?.state).toBe("timed-out");
    expect(mgr.mayProceed(ex.id)).toBe(false);
    expect(mgr.listByTransaction("tx-1")).toHaveLength(1);
  });
});
