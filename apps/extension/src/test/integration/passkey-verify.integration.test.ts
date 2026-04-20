/**
 * Integration: passkey enrollment + verification.
 *
 * The real WebAuthn API requires a user-gesture + authenticator, neither of
 * which jsdom supports. We drive the underlying CredentialStore directly via
 * `passkey-enroll` / `passkey-verify` bridge messages — the harness mirrors
 * the background handler's contract, including signature-counter regression
 * detection (which is what prevents cloned-authenticator attacks).
 *
 * Scenarios:
 *   - Fresh enrollment records credential-enrolled event
 *   - Valid verify bumps the counter + records credential-verified
 *   - Counter regression produces credential-verification-failed
 *   - Missing credential → credential-verification-failed with not-found reason
 *   - Re-enrolling the same credentialId updates label idempotently
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createBackgroundHarness, type BackgroundHarness } from "./harness";

const DEFAULT_CREDENTIAL_ID = "cred-abc123";
const DEFAULT_RP_ID = "wallet.aethelred.local";

async function enroll(harness: BackgroundHarness, opts: Partial<{
  credentialId: string;
  label: string;
  subjectId: string;
  publicKeySpki: string;
  rpId: string;
}> = {}) {
  return harness.sendMessage("passkey-enroll", {
    credentialId: opts.credentialId ?? DEFAULT_CREDENTIAL_ID,
    publicKeySpki: opts.publicKeySpki ?? "deadbeef",
    rpId: opts.rpId ?? DEFAULT_RP_ID,
    label: opts.label ?? "MacBook Touch ID",
    subjectId: opts.subjectId ?? "subj-wallet-owner",
  });
}

describe("passkey-verify integration", () => {
  let harness: BackgroundHarness;

  beforeEach(async () => {
    harness = await createBackgroundHarness();
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it("enroll records a credential-enrolled audit event", async () => {
    const res = await enroll(harness);
    expect((res.payload.result as { enrolled: boolean }).enrolled).toBe(true);
    const enrolled = harness
      .getAuditEvents()
      .filter((e) => e.kind === "credential-enrolled");
    expect(enrolled).toHaveLength(1);
    expect(enrolled[0].detail).toHaveProperty("credentialId", DEFAULT_CREDENTIAL_ID);
    expect(enrolled[0].detail).toHaveProperty("rpId", DEFAULT_RP_ID);
  });

  it("passkey stored with correct metadata (credentialId, publicKey, rpId)", async () => {
    await enroll(harness);
    const cred = harness.getCredentialStore().findPasskeyByCredentialId(DEFAULT_CREDENTIAL_ID);
    expect(cred).toBeDefined();
    expect(cred!.metadata.credentialId).toBe(DEFAULT_CREDENTIAL_ID);
    expect(cred!.metadata.rpId).toBe(DEFAULT_RP_ID);
    expect(cred!.metadata.signCounter).toBe(0);
  });

  it("verify with increasing counter succeeds + bumps counter", async () => {
    await enroll(harness);
    const res = await harness.sendMessage("passkey-verify", {
      credentialId: DEFAULT_CREDENTIAL_ID,
      newSignCounter: 1,
    });
    expect((res.payload.result as { verified: boolean }).verified).toBe(true);

    const cred = harness.getCredentialStore().findPasskeyByCredentialId(DEFAULT_CREDENTIAL_ID);
    expect(cred?.metadata.signCounter).toBe(1);

    // A second verify with higher counter continues to work
    const res2 = await harness.sendMessage("passkey-verify", {
      credentialId: DEFAULT_CREDENTIAL_ID,
      newSignCounter: 42,
    });
    expect((res2.payload.result as { verified: boolean }).verified).toBe(true);
    const cred2 = harness.getCredentialStore().findPasskeyByCredentialId(DEFAULT_CREDENTIAL_ID);
    expect(cred2?.metadata.signCounter).toBe(42);
  });

  it("credential-verified audit events fire for every verify", async () => {
    await enroll(harness);
    await harness.sendMessage("passkey-verify", {
      credentialId: DEFAULT_CREDENTIAL_ID,
      newSignCounter: 1,
    });
    await harness.sendMessage("passkey-verify", {
      credentialId: DEFAULT_CREDENTIAL_ID,
      newSignCounter: 2,
    });
    const verified = harness
      .getAuditEvents()
      .filter((e) => e.kind === "credential-verified");
    expect(verified).toHaveLength(2);
  });

  it("counter regression → credential-verification-failed", async () => {
    await enroll(harness);
    // Advance counter
    await harness.sendMessage("passkey-verify", {
      credentialId: DEFAULT_CREDENTIAL_ID,
      newSignCounter: 10,
    });
    // Regression — must fail
    const res = await harness.sendMessage("passkey-verify", {
      credentialId: DEFAULT_CREDENTIAL_ID,
      newSignCounter: 5,
    });
    expect(res.payload.error).toBeDefined();
    expect(res.payload.error?.message).toMatch(/counter regression/i);

    const failed = harness
      .getAuditEvents()
      .filter((e) => e.kind === "credential-verification-failed");
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed[failed.length - 1].detail.reason).toBe("counter-regression");
  });

  it("equal counter (replay) is treated as a regression", async () => {
    await enroll(harness);
    await harness.sendMessage("passkey-verify", {
      credentialId: DEFAULT_CREDENTIAL_ID,
      newSignCounter: 5,
    });
    const res = await harness.sendMessage("passkey-verify", {
      credentialId: DEFAULT_CREDENTIAL_ID,
      newSignCounter: 5,
    });
    expect(res.payload.error).toBeDefined();
  });

  it("verify against an unknown credential → not-found failure", async () => {
    const res = await harness.sendMessage("passkey-verify", {
      credentialId: "does-not-exist",
      newSignCounter: 1,
    });
    expect(res.payload.error).toBeDefined();
    expect(res.payload.error?.code).toBe(-32001);

    const failed = harness
      .getAuditEvents()
      .filter((e) => e.kind === "credential-verification-failed");
    expect(failed[failed.length - 1].detail.reason).toBe("not-found");
  });

  it("re-enrolling same credentialId is idempotent (updates label only)", async () => {
    await enroll(harness, { label: "Old Label" });
    await enroll(harness, { label: "New Label" });
    const list = harness.getCredentialStore().listPasskeys("subj-wallet-owner");
    expect(list).toHaveLength(1);
    expect(list[0].metadata.label).toBe("New Label");
  });

  it("listPasskeys filters by subject", async () => {
    await enroll(harness, { credentialId: "a", subjectId: "subj-a" });
    await enroll(harness, { credentialId: "b", subjectId: "subj-b" });
    const store = harness.getCredentialStore();
    expect(store.listPasskeys("subj-a")).toHaveLength(1);
    expect(store.listPasskeys("subj-b")).toHaveLength(1);
    expect(store.listPasskeys("subj-c")).toHaveLength(0);
  });

  it("listPasskeys orders newest-first", async () => {
    await enroll(harness, { credentialId: "old", label: "Old" });
    // Ensure the issuedAt timestamps differ so the sort is deterministic
    await new Promise((r) => setTimeout(r, 5));
    await enroll(harness, { credentialId: "new", label: "New" });
    const list = harness.getCredentialStore().listPasskeys("subj-wallet-owner");
    expect(list[0].metadata.label).toBe("New");
    expect(list[1].metadata.label).toBe("Old");
  });

  it("removePasskey removes by credentialId", async () => {
    await enroll(harness);
    const store = harness.getCredentialStore();
    expect(store.findPasskeyByCredentialId(DEFAULT_CREDENTIAL_ID)).toBeDefined();
    store.removePasskey(DEFAULT_CREDENTIAL_ID);
    expect(store.findPasskeyByCredentialId(DEFAULT_CREDENTIAL_ID)).toBeUndefined();
  });
});
