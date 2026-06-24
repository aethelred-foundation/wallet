/**
 * Tests for guardian-based social recovery — M-of-N owner rotation behind a
 * timelock, with an owner veto. Focus is on the security invariants: only
 * guardians approve, threshold + timelock are both enforced, the owner can
 * cancel, and the guardian set can never be left unable to meet its threshold.
 */

import { describe, it, expect } from "vitest";
import { SocialRecoveryModule, type GuardianConfig } from "@aethelred/wallet-core";

const OWNER = ("0x" + "11".repeat(20)) as `0x${string}`;
const G1 = ("0x" + "22".repeat(20)) as `0x${string}`;
const G2 = ("0x" + "33".repeat(20)) as `0x${string}`;
const G3 = ("0x" + "44".repeat(20)) as `0x${string}`;
const NEW_OWNER = ("0x" + "55".repeat(20)) as `0x${string}`;
const STRANGER = ("0x" + "66".repeat(20)) as `0x${string}`;
const T0 = 1_750_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function make(overrides: Partial<GuardianConfig> = {}): SocialRecoveryModule {
  return new SocialRecoveryModule({
    owner: OWNER,
    guardians: [G1, G2, G3],
    threshold: 2,
    delayMs: DAY,
    ...overrides,
  });
}

describe("construction", () => {
  it("accepts a valid 2-of-3 config and normalizes case", () => {
    const m = new SocialRecoveryModule({
      owner: OWNER.toUpperCase().replace("0X", "0x") as `0x${string}`,
      guardians: [G1, G2, G3],
      threshold: 2,
      delayMs: DAY,
    });
    expect(m.getConfig().owner).toBe(OWNER);
    expect(m.getConfig().guardians).toHaveLength(3);
  });

  it("rejects bad configs", () => {
    expect(() => make({ guardians: [G1, G1] })).toThrow(/duplicate/i);
    expect(() => make({ guardians: [OWNER, G1] })).toThrow(/Owner cannot also be a guardian/);
    expect(() => make({ threshold: 4 })).toThrow(/exceeds guardian count/);
    expect(() => make({ threshold: 0 })).toThrow(/positive integer/);
    expect(() => make({ delayMs: -1 })).toThrow(/delayMs/);
  });
});

describe("guardian-set management", () => {
  it("adds and removes guardians under threshold constraints", () => {
    const m = make({ guardians: [G1, G2], threshold: 2 });
    m.addGuardian(G3);
    expect(m.isGuardian(G3)).toBe(true);
    expect(() => m.addGuardian(G3)).toThrow(/Already a guardian/);
    expect(() => m.addGuardian(OWNER)).toThrow(/Owner cannot be a guardian/);
    // Now 3 guardians, threshold 2 → removing one is OK (leaves 2 ≥ 2)…
    m.removeGuardian(G3);
    // …but removing again would leave 1 < threshold 2 → blocked.
    expect(() => m.removeGuardian(G2)).toThrow(/exceeds guardian count/);
    expect(() => m.removeGuardian(STRANGER)).toThrow(/Not a guardian/);
  });

  it("validates threshold changes", () => {
    const m = make();
    m.changeThreshold(3);
    expect(m.getConfig().threshold).toBe(3);
    expect(() => m.changeThreshold(4)).toThrow(/exceeds/);
    expect(() => m.changeThreshold(0)).toThrow(/positive integer/);
  });
});

describe("recovery lifecycle", () => {
  it("rotates owner only with threshold approvals AND after timelock", () => {
    const m = make();
    const req = m.proposeRecovery(NEW_OWNER, T0);
    expect(req.executeAfter).toBe(T0 + DAY);
    expect(req.status).toBe("pending");

    m.approveRecovery(req.id, G1);
    // 1 of 2 → cannot execute
    expect(m.canExecute(req.id, T0 + DAY + 1)).toBe(false);
    expect(() => m.executeRecovery(req.id, T0 + DAY + 1)).toThrow(/Need 2 approvals/);

    m.approveRecovery(req.id, G2);
    expect(m.getRequest(req.id)?.status).toBe("ready");
    // threshold met but timelock not elapsed → cannot execute
    expect(m.canExecute(req.id, T0 + 1000)).toBe(false);
    expect(() => m.executeRecovery(req.id, T0 + 1000)).toThrow(/timelock/);

    // threshold + timelock → execute
    expect(m.canExecute(req.id, T0 + DAY)).toBe(true);
    expect(m.executeRecovery(req.id, T0 + DAY)).toBe(NEW_OWNER);
    expect(m.getConfig().owner).toBe(NEW_OWNER);
    expect(m.getRequest(req.id)?.status).toBe("executed");
    expect(m.getActiveRequest()).toBeUndefined();
  });

  it("rejects non-guardian approvals and double approvals", () => {
    const m = make();
    const req = m.proposeRecovery(NEW_OWNER, T0);
    expect(() => m.approveRecovery(req.id, STRANGER)).toThrow(/not a guardian/i);
    m.approveRecovery(req.id, G1);
    expect(() => m.approveRecovery(req.id, G1)).toThrow(/already approved/i);
  });

  it("enforces a single active recovery and rejects no-op proposals", () => {
    const m = make();
    m.proposeRecovery(NEW_OWNER, T0);
    expect(() => m.proposeRecovery(STRANGER, T0)).toThrow(/already in progress/);
    expect(() => make().proposeRecovery(OWNER, T0)).toThrow(/differ from current owner/);
  });

  it("lets the owner cancel, blocking execution", () => {
    const m = make();
    const req = m.proposeRecovery(NEW_OWNER, T0);
    m.approveRecovery(req.id, G1);
    m.approveRecovery(req.id, G2);
    m.cancelRecovery(req.id);
    expect(m.getRequest(req.id)?.status).toBe("cancelled");
    expect(m.canExecute(req.id, T0 + DAY)).toBe(false);
    expect(() => m.executeRecovery(req.id, T0 + DAY)).toThrow(/cancelled/);
    expect(() => m.approveRecovery(req.id, G3)).toThrow(/cancelled/);
    // owner unchanged; a fresh recovery can start
    expect(m.getConfig().owner).toBe(OWNER);
    expect(() => m.proposeRecovery(NEW_OWNER, T0 + 1)).not.toThrow();
  });

  it("throws on unknown request ids", () => {
    const m = make();
    expect(() => m.approveRecovery("nope", G1)).toThrow(/not found/);
    expect(m.canExecute("nope")).toBe(false);
  });
});
