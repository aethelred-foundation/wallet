import { describe, expect, it, vi } from "vitest";
import { CredentialStore } from "@aethelred/wallet-identity";

const BASE = {
  subjectId: "subject-1",
  credentialId: "credential-1",
  publicKeySpki: "public-key-1",
  rpId: "extension-id",
  label: "Primary",
};

describe("CredentialStore passkey invariants", () => {
  it("preserves clone-detection state when an identical credential is re-enrolled", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(200).mockReturnValueOnce(300);
    const store = new CredentialStore();
    store.enrollPasskey(BASE);
    store.bumpPasskeySignCounter(BASE.credentialId, 7);

    const enrolledAgain = store.enrollPasskey({ ...BASE, label: "Renamed" });
    expect(enrolledAgain.issuedAt).toBe(100);
    expect(enrolledAgain.metadata.signCounter).toBe(7);
    expect(enrolledAgain.metadata.lastUsedAt).toBe(200);
    vi.restoreAllMocks();
  });

  it("rejects credential-id reuse with different key material or subject", () => {
    const store = new CredentialStore();
    store.enrollPasskey(BASE);
    expect(() => store.enrollPasskey({ ...BASE, publicKeySpki: "attacker-key" })).toThrow(/different key material/i);
    expect(() => store.enrollPasskey({ ...BASE, subjectId: "subject-2" })).toThrow(/different key material/i);
  });

  it("renames without changing the public key or signature counter", () => {
    const store = new CredentialStore();
    store.enrollPasskey(BASE);
    store.bumpPasskeySignCounter(BASE.credentialId, 2);
    const renamed = store.renamePasskey(BASE.credentialId, "  Office YubiKey  ");

    expect(renamed.label).toBe("Office YubiKey");
    expect(renamed.metadata.label).toBe("Office YubiKey");
    expect(renamed.metadata.publicKeySpki).toBe(BASE.publicKeySpki);
    expect(renamed.metadata.signCounter).toBe(2);
  });
});
