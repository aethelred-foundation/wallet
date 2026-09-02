/**
 * EIP-191 personal_sign recovery-byte normalization.
 *
 * Custody backends return the raw secp256k1 recovery id (0/1) as the final
 * signature byte, but EIP-191 consumers (viem/ethers `recoverMessageAddress`)
 * reject v < 27. Signer.signMessage must ship v as 27/28 — without it, every
 * message-signature login/registration flow (ZeroID's included) fails at
 * public-key recovery on the dApp side. Transaction signing computes its own
 * v elsewhere and must stay untouched.
 */

import { describe, expect, it } from "vitest";
import { Signer, type PolicyDecisionToken } from "@aethelred/wallet-core";
import type { MasterKey } from "@aethelred/wallet-core";
import type { CustodyBackend } from "@aethelred/wallet-core";

const unlockedMasterKey = {
  isLocked: () => false,
  captureUnlockedEpoch: () => 1,
  assertUnlockedAtEpoch: (epoch: number) => {
    if (epoch !== 1) throw new Error("stale vault epoch");
  },
} as unknown as MasterKey;

function allowToken(): PolicyDecisionToken {
  return { intentId: "intent-1", outcome: "allow", timestamp: Date.now() };
}

function custodyReturning(signature: Uint8Array): CustodyBackend {
  return {
    sign: async () => signature,
  } as unknown as CustodyBackend;
}

function messageRequest() {
  return {
    keySlotId: "slot-1",
    data: new TextEncoder().encode("zeroid registration"),
    type: "message" as const,
  };
}

describe("Signer EIP-191 v normalization", () => {
  it.each([
    [0, 27],
    [1, 28],
  ])("lifts a raw recovery id %i to v = %i", async (rawV, expectedV) => {
    const sig = new Uint8Array(65);
    sig[64] = rawV;
    const signer = new Signer(unlockedMasterKey, custodyReturning(sig));

    const { signature } = await signer.signMessage(messageRequest(), allowToken());
    expect(signature.length).toBe(65);
    expect(signature[64]).toBe(expectedV);
  });

  it.each([27, 28])("leaves an already-normalized v = %i untouched", async (v) => {
    const sig = new Uint8Array(65);
    sig[64] = v;
    const signer = new Signer(unlockedMasterKey, custodyReturning(sig));

    const { signature } = await signer.signMessage(messageRequest(), allowToken());
    expect(signature[64]).toBe(v);
  });

  it("does not touch signatures that are not 65 bytes (hardware formats)", async () => {
    const sig = new Uint8Array(64);
    const signer = new Signer(unlockedMasterKey, custodyReturning(sig));

    const { signature } = await signer.signMessage(messageRequest(), allowToken());
    expect(signature.length).toBe(64);
  });

  it("keeps the transaction-digest path free of message-style v rewriting", async () => {
    // signTransaction must return custody output verbatim — v is computed
    // later when the wire transaction is assembled.
    const sig = new Uint8Array(65);
    sig[64] = 0;
    const signer = new Signer(unlockedMasterKey, custodyReturning(sig));

    const { signature } = await signer.signTransaction(messageRequest(), allowToken());
    expect(signature[64]).toBe(0);
  });
});
