/**
 * Enforcement-contract test for the background signing gate.
 *
 * `handlePrepareTx` builds the pipeline exactly this way and calls
 * `authorizeOrThrow` between Simulate and Approve; a thrown
 * AuthorizationBlockedError returns an error before a draft is created, so
 * `execute-tx` can never sign it. This test models that prepare→sign flow and
 * asserts the load-bearing guarantee: **a sanctioned destination means the
 * signature is never generated**, and the gate fails closed on a vendor error.
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildInstitutionalAuthorizationPipeline,
  LiveScreeningGate,
  AuthorizationBlockedError,
  type ScreeningProvider,
} from "@aethelred/wallet-compliance";

const SANCTIONED = "0xBADc0ffEE0000000000000000000000000000bad" as `0x${string}`;
const CLEAN = "0x000000000000000000000000000000000000c1ea" as `0x${string}`;

function ofacProvider(): ScreeningProvider {
  const list = new Set([SANCTIONED.toLowerCase()]);
  return {
    name: "ofac",
    async screenAddress(address) {
      const hit = list.has(address.toLowerCase());
      return { address, riskScore: hit ? 100 : 0, severity: hit ? "severe" : "low", categories: hit ? ["sanctions"] : [], provider: "ofac", screenedAt: 0 };
    },
  };
}
function downProvider(): ScreeningProvider {
  return { name: "down", async screenAddress() { throw new Error("vendor 503"); } };
}

/** Faithful model of the background prepare→sign flow with the compliance gate. */
async function prepareAndMaybeSign(provider: ScreeningProvider, to: `0x${string}`, sign: () => Promise<string>) {
  const pipeline = buildInstitutionalAuthorizationPipeline("enterprise", {
    screening: new LiveScreeningGate(provider),
  });
  try {
    await pipeline.authorizeOrThrow({
      transactionId: "prepare-test",
      destinationAddress: to,
      amountUsd: 0,
      tier: "enterprise",
      subjectId: "treasury",
    });
  } catch (err) {
    if (err instanceof AuthorizationBlockedError) return { blocked: true as const, reason: err.message };
    return { blocked: true as const, reason: `gate-unavailable: ${(err as Error).message}` }; // fail-closed
  }
  return { blocked: false as const, signature: await sign() };
}

describe("compliance gate halts signing", () => {
  it("a sanctioned destination is blocked and the signature is NEVER generated", async () => {
    const sign = vi.fn(async () => "0xSIGNATURE");
    const result = await prepareAndMaybeSign(ofacProvider(), SANCTIONED, sign);
    expect(result.blocked).toBe(true);
    expect(sign).not.toHaveBeenCalled(); // the load-bearing guarantee
  });

  it("a clean destination proceeds and the signature IS generated", async () => {
    const sign = vi.fn(async () => "0xSIGNATURE");
    const result = await prepareAndMaybeSign(ofacProvider(), CLEAN, sign);
    expect(result.blocked).toBe(false);
    expect(sign).toHaveBeenCalledOnce();
  });

  it("fails closed when the screening vendor is unavailable (no signature)", async () => {
    const sign = vi.fn(async () => "0xSIGNATURE");
    const result = await prepareAndMaybeSign(downProvider(), CLEAN, sign);
    expect(result.blocked).toBe(true);
    expect(sign).not.toHaveBeenCalled();
  });
});
