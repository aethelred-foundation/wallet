/**
 * Tests for the TEE-attested agent delegation scaffolding
 * (Moat #3 of the Aethelred Wallet).
 *
 * Covers:
 *   - AttestationVerifier.verifyStructure — nonce mismatch, expiry,
 *     platform allow-list, minimum security version, code-hash mismatch,
 *     sentinel rejection, extra-claim warnings.
 *   - AttestationVerifier.verifyQuote — structural pass + explicit TODO
 *     warning that signature-chain verification is not implemented.
 *   - AgentDelegationManager.openSession — attestation-first, expiry
 *     computation, agent id guard.
 *   - AgentDelegationManager.authorizeOperation — unknown session,
 *     expired session, call-not-allowed, spend-cap enforcement with
 *     sliding-window semantics, per-call attestation requirement,
 *     auto-revoke on measurement drift.
 *   - Revocation lifecycle, list/get filtering semantics.
 *
 * The suite uses a deterministic injected clock on both the verifier and
 * the delegation manager so every test is independent of wall-clock time.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentDelegationManager,
  AttestationVerifier,
  type AttestedAgent,
  type DelegationPolicy,
  type TeeQuote,
} from "@aethelred/wallet-compliance";

/* ─── Test fixtures ──────────────────────────────────────────────── */

const APPROVED_CODE_HASH: `0x${string}` = `0x${"ab".repeat(32)}`;
const DIFFERENT_CODE_HASH: `0x${string}` = `0x${"cd".repeat(32)}`;
const CONFIG_HASH: `0x${string}` = `0x${"12".repeat(32)}`;
const NONCE_A: `0x${string}` = `0x${"aa".repeat(32)}`;
const NONCE_B: `0x${string}` = `0x${"bb".repeat(32)}`;
const AGENT_SIG: `0x${string}` = `0x${"ee".repeat(64)}`;
const QUOTE_BLOB: `0x${string}` = `0x${"01".repeat(64)}`;

function buildQuote(overrides: Partial<TeeQuote> = {}): TeeQuote {
  return {
    platform: "aws-nitro",
    version: "4.0",
    quote: QUOTE_BLOB,
    measurements: {
      codeHash: APPROVED_CODE_HASH,
      configHash: CONFIG_HASH,
      platformSecurityVersion: "1.5.0",
    },
    generatedAt: 1_700_000_000_000,
    nonce: NONCE_A,
    ...overrides,
  };
}

function buildAttested(overrides: Partial<AttestedAgent> = {}): AttestedAgent {
  return {
    agentId: "mid-agent-1",
    modelIdentifier: "example-agent-1.0",
    approvedCodeHash: APPROVED_CODE_HASH,
    quote: buildQuote(),
    agentSignature: AGENT_SIG,
    ...overrides,
  };
}

function buildPolicy(overrides: Partial<DelegationPolicy> = {}): DelegationPolicy {
  return {
    maxSpendUsd: 1_500,
    windowMs: 60 * 60 * 1000, // 1h
    allowedCalls: [
      {
        chainId: 1,
        contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        selector: "0xa9059cbb",
        description: "ERC20 transfer",
      },
    ],
    attestationPerCall: false,
    maxAttestationAgeMs: 5 * 60 * 1000,
    autoRevokeOnDrift: true,
    ...overrides,
  };
}

/* ─── AttestationVerifier.verifyStructure ───────────────────────── */

describe("AttestationVerifier.verifyStructure", () => {
  const baseTime = 1_700_000_000_000;
  let verifier: AttestationVerifier;

  beforeEach(() => {
    verifier = new AttestationVerifier({
      clockSkewMs: 60_000,
      maxQuoteAgeMs: 10 * 60 * 1000,
      allowedPlatforms: ["aws-nitro", "intel-tdx", "amd-sev-snp"],
      minPlatformVersion: { "aws-nitro": "1.0.0" },
      now: () => baseTime,
    });
  });

  it("rejects a quote whose nonce does not match the challenge", () => {
    const attested = buildAttested({ quote: buildQuote({ nonce: NONCE_B }) });
    const result = verifier.verifyStructure(attested, NONCE_A);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("nonce-mismatch");
  });

  it("rejects a quote older than maxQuoteAgeMs + skew", () => {
    const attested = buildAttested({
      quote: buildQuote({ generatedAt: baseTime - 30 * 60 * 1000 }),
    });
    const result = verifier.verifyStructure(attested, NONCE_A);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("quote-expired");
  });

  it("rejects a quote from a disallowed platform", () => {
    const attested = buildAttested({
      quote: buildQuote({ platform: "software-simulated" }),
    });
    const result = verifier.verifyStructure(attested, NONCE_A);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("platform-unsupported");
  });

  it("rejects a code hash mismatch against the approved pin", () => {
    const attested = buildAttested({
      quote: buildQuote({
        measurements: {
          codeHash: DIFFERENT_CODE_HASH,
          configHash: CONFIG_HASH,
          platformSecurityVersion: "1.5.0",
        },
      }),
    });
    const result = verifier.verifyStructure(attested, NONCE_A);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("code-hash-mismatch");
  });

  it("rejects a platform security version below the configured floor", () => {
    const attested = buildAttested({
      quote: buildQuote({
        measurements: {
          codeHash: APPROVED_CODE_HASH,
          configHash: CONFIG_HASH,
          platformSecurityVersion: "0.0.1",
        },
      }),
    });
    const result = verifier.verifyStructure(attested, NONCE_A);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("platform-compromised");
  });

  it("collects a warning when extraClaims.debug is truthy", () => {
    const attested = buildAttested({
      quote: buildQuote({
        measurements: {
          codeHash: APPROVED_CODE_HASH,
          configHash: CONFIG_HASH,
          platformSecurityVersion: "1.5.0",
          extraClaims: { debug: "true" },
        },
      }),
    });
    const result = verifier.verifyStructure(attested, NONCE_A);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("SGX_DEBUG"))).toBe(true);
  });

  it("rejects a malformed hex field with quote-malformed", () => {
    const attested = buildAttested({
      // Deliberately wrong shape — casting to bypass compile-time check.
      approvedCodeHash: "not-hex" as `0x${string}`,
    });
    const result = verifier.verifyStructure(attested, NONCE_A);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("quote-malformed");
  });

  it("rejects a forbidden sentinel code hash (all-zero)", () => {
    const sentinel = `0x${"00".repeat(32)}` as `0x${string}`;
    const attested = buildAttested({
      approvedCodeHash: sentinel,
      quote: buildQuote({
        measurements: {
          codeHash: sentinel,
          configHash: CONFIG_HASH,
          platformSecurityVersion: "1.5.0",
        },
      }),
    });
    const result = verifier.verifyStructure(attested, NONCE_A);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("code-hash-mismatch");
  });

  it("returns valid=true on a well-formed quote that passes every check", () => {
    const attested = buildAttested();
    const result = verifier.verifyStructure(attested, NONCE_A);
    expect(result.valid).toBe(true);
    expect(result.attestedPlatform).toBe("aws-nitro");
  });
});

/* ─── AttestationVerifier.verifyQuote ───────────────────────────── */

describe("AttestationVerifier.verifyQuote", () => {
  const baseTime = 1_700_000_000_000;

  it("returns a structural pass plus a signature-chain-not-verified warning", async () => {
    const verifier = new AttestationVerifier({
      allowedPlatforms: ["aws-nitro"],
      now: () => baseTime,
    });
    const attested = buildAttested();
    const result = await verifier.verifyQuote(attested, NONCE_A);
    expect(result.valid).toBe(true);
    expect(
      result.warnings.some((w) =>
        w.includes("signature-chain-not-verified"),
      ),
    ).toBe(true);
  });
});

/* ─── AgentDelegationManager.openSession ────────────────────────── */

describe("AgentDelegationManager.openSession", () => {
  const baseTime = 1_700_000_000_000;
  let verifier: AttestationVerifier;
  let manager: AgentDelegationManager;

  beforeEach(() => {
    verifier = new AttestationVerifier({
      allowedPlatforms: ["aws-nitro"],
      now: () => baseTime,
    });
    manager = new AgentDelegationManager(verifier, { now: () => baseTime });
  });

  it("rejects when the presented attestation fails verification", async () => {
    const attested = buildAttested({
      quote: buildQuote({ nonce: NONCE_B }),
    });
    const result = await manager.openSession({
      agentId: "mid-agent-1",
      subjectId: "subj-1",
      policy: buildPolicy(),
      attested,
      expectedNonce: NONCE_A,
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("nonce-mismatch");
    }
  });

  it("creates a session with expiresAt = attestedAt + policy.windowMs", async () => {
    const policy = buildPolicy({ windowMs: 2 * 60 * 60 * 1000 });
    const attested = buildAttested();
    const result = await manager.openSession({
      agentId: "mid-agent-1",
      subjectId: "subj-1",
      policy,
      attested,
      expectedNonce: NONCE_A,
    });
    expect("sessionId" in result).toBe(true);
    if ("sessionId" in result) {
      expect(result.expiresAt).toBe(
        attested.quote.generatedAt + policy.windowMs,
      );
    }
  });

  it("rejects when opts.agentId does not match attested.agentId", async () => {
    const attested = buildAttested({ agentId: "mid-agent-1" });
    const result = await manager.openSession({
      agentId: "mid-agent-other",
      subjectId: "subj-1",
      policy: buildPolicy(),
      attested,
      expectedNonce: NONCE_A,
    });
    expect("error" in result).toBe(true);
  });
});

/* ─── AgentDelegationManager.authorizeOperation ─────────────────── */

describe("AgentDelegationManager.authorizeOperation", () => {
  const baseTime = 1_700_000_000_000;
  const contract: `0x${string}` =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const selector: `0x${string}` = "0xa9059cbb";
  let clock: number;
  let verifier: AttestationVerifier;
  let manager: AgentDelegationManager;

  async function openDefaultSession(
    policy: DelegationPolicy,
  ): Promise<string> {
    const attested = buildAttested({
      quote: buildQuote({ generatedAt: clock }),
    });
    const opened = await manager.openSession({
      agentId: "mid-agent-1",
      subjectId: "subj-1",
      policy,
      attested,
      expectedNonce: NONCE_A,
    });
    if ("error" in opened) throw new Error(opened.error);
    return opened.sessionId;
  }

  beforeEach(() => {
    clock = baseTime;
    verifier = new AttestationVerifier({
      allowedPlatforms: ["aws-nitro"],
      now: () => clock,
    });
    manager = new AgentDelegationManager(verifier, { now: () => clock });
  });

  it("rejects an unknown sessionId", async () => {
    const result = await manager.authorizeOperation({
      sessionId: "dlg-nope",
      chainId: 1,
      to: contract,
      selector,
      estimatedUsd: 10,
    });
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.reason).toBe("session-not-found");
  });

  it("rejects when the session has expired", async () => {
    const policy = buildPolicy({ windowMs: 60_000 });
    const sessionId = await openDefaultSession(policy);
    clock = baseTime + 120_000; // past expiry
    const result = await manager.authorizeOperation({
      sessionId,
      chainId: 1,
      to: contract,
      selector,
      estimatedUsd: 10,
    });
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.reason).toBe("session-expired");
  });

  it("rejects when the call is not in policy.allowedCalls", async () => {
    const sessionId = await openDefaultSession(buildPolicy());
    const result = await manager.authorizeOperation({
      sessionId,
      chainId: 1,
      to: contract,
      selector: "0xdeadbeef",
      estimatedUsd: 10,
    });
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.reason).toBe("call-not-allowed");
  });

  it("accepts when every policy check passes", async () => {
    const sessionId = await openDefaultSession(buildPolicy());
    const result = await manager.authorizeOperation({
      sessionId,
      chainId: 1,
      to: contract,
      selector,
      estimatedUsd: 10,
    });
    expect(result.authorized).toBe(true);
  });

  it("tracks spend across multiple operations in the same window", async () => {
    const sessionId = await openDefaultSession(buildPolicy());
    // Three $400 operations → total $1200, still under $1500 cap.
    for (let i = 0; i < 3; i += 1) {
      const r = await manager.authorizeOperation({
        sessionId,
        chainId: 1,
        to: contract,
        selector,
        estimatedUsd: 400,
      });
      expect(r.authorized).toBe(true);
    }
    // $400 more would push total to $1600 — reject.
    const r = await manager.authorizeOperation({
      sessionId,
      chainId: 1,
      to: contract,
      selector,
      estimatedUsd: 400,
    });
    expect(r.authorized).toBe(false);
    if (!r.authorized) expect(r.reason).toContain("spend-cap-exceeded");
  });

  it("rejects the 11th op when 10 prior ops of $150 already totaled $1500", async () => {
    const sessionId = await openDefaultSession(
      buildPolicy({ maxSpendUsd: 1_500 }),
    );
    for (let i = 0; i < 10; i += 1) {
      const r = await manager.authorizeOperation({
        sessionId,
        chainId: 1,
        to: contract,
        selector,
        estimatedUsd: 150,
      });
      expect(r.authorized).toBe(true);
    }
    const eleventh = await manager.authorizeOperation({
      sessionId,
      chainId: 1,
      to: contract,
      selector,
      estimatedUsd: 150,
    });
    expect(eleventh.authorized).toBe(false);
  });

  it("resets the spend window after the window has elapsed", async () => {
    const windowMs = 60_000;
    const policy = buildPolicy({
      maxSpendUsd: 500,
      windowMs,
    });
    // Open session with a very long expiry so only the spend window matters.
    const attested = buildAttested({
      quote: buildQuote({ generatedAt: clock }),
    });
    const longerLivedPolicy: DelegationPolicy = {
      ...policy,
      windowMs: 10 * 60 * 1000,
    };
    const opened = await manager.openSession({
      agentId: "mid-agent-1",
      subjectId: "subj-1",
      policy: longerLivedPolicy,
      attested,
      expectedNonce: NONCE_A,
    });
    if ("error" in opened) throw new Error(opened.error);
    const sessionId = opened.sessionId;

    // Patch the stored session to use the short spend window while leaving
    // the session's own expiry long.
    const internalSession = manager.getSession(sessionId);
    expect(internalSession).not.toBeNull();
    // We mutate the stored policy to simulate a tighter spend window than
    // the session lifetime; in production these would be one value.
    if (internalSession) internalSession.policy = { ...policy };

    // Spend to the cap.
    const first = await manager.authorizeOperation({
      sessionId,
      chainId: 1,
      to: contract,
      selector,
      estimatedUsd: 500,
    });
    expect(first.authorized).toBe(true);

    const second = await manager.authorizeOperation({
      sessionId,
      chainId: 1,
      to: contract,
      selector,
      estimatedUsd: 1,
    });
    expect(second.authorized).toBe(false);

    // Advance the clock past the window.
    clock = baseTime + windowMs + 1;
    const third = await manager.authorizeOperation({
      sessionId,
      chainId: 1,
      to: contract,
      selector,
      estimatedUsd: 400,
    });
    expect(third.authorized).toBe(true);
  });

  it("rejects when policy.attestationPerCall is true and no attestation provided", async () => {
    const policy = buildPolicy({
      attestationPerCall: true,
      maxAttestationAgeMs: 5 * 60 * 1000,
    });
    const sessionId = await openDefaultSession(policy);
    const result = await manager.authorizeOperation({
      sessionId,
      chainId: 1,
      to: contract,
      selector,
      estimatedUsd: 10,
    });
    expect(result.authorized).toBe(false);
    if (!result.authorized)
      expect(result.reason).toContain("attestation-required");
  });

  it("auto-revokes when measurements drift and autoRevokeOnDrift=true", async () => {
    const policy = buildPolicy({
      attestationPerCall: true,
      autoRevokeOnDrift: true,
    });
    const sessionId = await openDefaultSession(policy);

    const drifted = buildAttested({
      approvedCodeHash: DIFFERENT_CODE_HASH,
      quote: buildQuote({
        generatedAt: clock,
        measurements: {
          codeHash: DIFFERENT_CODE_HASH,
          configHash: CONFIG_HASH,
          platformSecurityVersion: "1.5.0",
        },
      }),
    });

    const result = await manager.authorizeOperation({
      sessionId,
      chainId: 1,
      to: contract,
      selector,
      estimatedUsd: 10,
      currentAttestation: drifted,
      expectedNonce: NONCE_A,
    });
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.reason).toBe("measurement-drift");

    const session = manager.getSession(sessionId);
    expect(session?.revoked?.reason).toBe("model-drift-detected");
    expect(session?.revoked?.actor).toBe("system");
  });

  it("does NOT auto-revoke when autoRevokeOnDrift=false", async () => {
    const policy = buildPolicy({
      attestationPerCall: true,
      autoRevokeOnDrift: false,
    });
    const sessionId = await openDefaultSession(policy);

    const drifted = buildAttested({
      approvedCodeHash: DIFFERENT_CODE_HASH,
      quote: buildQuote({
        generatedAt: clock,
        measurements: {
          codeHash: DIFFERENT_CODE_HASH,
          configHash: CONFIG_HASH,
          platformSecurityVersion: "1.5.0",
        },
      }),
    });

    const result = await manager.authorizeOperation({
      sessionId,
      chainId: 1,
      to: contract,
      selector,
      estimatedUsd: 10,
      currentAttestation: drifted,
      expectedNonce: NONCE_A,
    });
    expect(result.authorized).toBe(false);
    const session = manager.getSession(sessionId);
    expect(session?.revoked).toBeUndefined();
  });
});

/* ─── Revocation + listing semantics ─────────────────────────────── */

describe("AgentDelegationManager revoke + list", () => {
  const baseTime = 1_700_000_000_000;
  let clock: number;
  let manager: AgentDelegationManager;

  beforeEach(async () => {
    clock = baseTime;
    const verifier = new AttestationVerifier({
      allowedPlatforms: ["aws-nitro"],
      now: () => clock,
    });
    manager = new AgentDelegationManager(verifier, { now: () => clock });
  });

  async function openFor(
    agentId: string,
    subjectId = "subj-1",
    quoteOverrides: Partial<TeeQuote> = {},
  ): Promise<string> {
    const attested = buildAttested({
      agentId,
      quote: buildQuote({ generatedAt: clock, ...quoteOverrides }),
    });
    const opened = await manager.openSession({
      agentId,
      subjectId,
      policy: buildPolicy(),
      attested,
      expectedNonce: NONCE_A,
    });
    if ("error" in opened) throw new Error(opened.error);
    return opened.sessionId;
  }

  it("marks the session revoked with the given reason and actor", async () => {
    const sessionId = await openFor("mid-agent-1");
    await manager.revoke(sessionId, "operator-initiated", "subj-1", "manual");
    const session = manager.getSession(sessionId);
    expect(session?.revoked?.reason).toBe("operator-initiated");
    expect(session?.revoked?.actor).toBe("subj-1");
    expect(session?.revoked?.detail).toBe("manual");
  });

  it("is idempotent when revoking an already-revoked session", async () => {
    const sessionId = await openFor("mid-agent-1");
    await manager.revoke(sessionId, "operator-initiated", "subj-1");
    const firstRecord = manager.getSession(sessionId)?.revoked;
    await manager.revoke(sessionId, "policy-violation", "subj-2");
    const secondRecord = manager.getSession(sessionId)?.revoked;
    expect(secondRecord).toBe(firstRecord); // same object, not replaced
  });

  it("listSessions filters by agentId", async () => {
    await openFor("mid-agent-1");
    await openFor("mid-agent-2");
    const forOne = manager.listSessions("mid-agent-1");
    expect(forOne).toHaveLength(1);
    expect(forOne[0]!.agentId).toBe("mid-agent-1");
  });

  it("listSessions honors includeRevoked flag", async () => {
    const aliveId = await openFor("mid-agent-1");
    const revokedId = await openFor("mid-agent-1");
    await manager.revoke(revokedId, "operator-initiated", "subj-1");

    const defaultList = manager.listSessions("mid-agent-1");
    expect(defaultList.map((s) => s.id).sort()).toEqual([aliveId].sort());

    const fullList = manager.listSessions("mid-agent-1", true);
    expect(fullList.map((s) => s.id).sort()).toEqual(
      [aliveId, revokedId].sort(),
    );
  });

  it("getSession returns null for an unknown id", () => {
    expect(manager.getSession("dlg-unknown")).toBeNull();
  });
});
