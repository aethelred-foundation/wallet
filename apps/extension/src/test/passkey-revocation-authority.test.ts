import { describe, expect, it } from "vitest";
import {
  PASSKEY_BINDING_GENERATION_KEY_PREFIX,
  PasskeyEphemeralAuthority,
  type PasskeyStringStorage,
} from "../background/passkey-ephemeral-authority";

class MemoryStorage implements PasskeyStringStorage {
  readonly values = new Map<string, string>();
  failSets = false;
  failDeletes = false;

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    if (this.failSets) throw new Error("set failed");
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    if (this.failDeletes) throw new Error("delete failed");
    this.values.delete(key);
  }
}

const SUBJECT_ID = "subject-wallet-owner";
const CREDENTIAL_ID = "credential-primary";

function makeAuthority() {
  const durable = new MemoryStorage();
  const ephemeral = new MemoryStorage();
  const authority = new PasskeyEphemeralAuthority(durable, ephemeral);
  return { authority, durable, ephemeral };
}

describe("PasskeyEphemeralAuthority revocation", () => {
  it("rejects consumption of a grant issued before credential removal", async () => {
    const { authority } = makeAuthority();
    const grant = await authority.issueUnlockGrant({
      token: "grant-token-with-at-least-thirty-two-characters",
      subjectId: SUBJECT_ID,
      credentialId: CREDENTIAL_ID,
      expiresAt: 10_000,
    });

    await authority.invalidateSubject(SUBJECT_ID);

    await expect(
      authority.consumeUnlockGrant(
        SUBJECT_ID,
        grant.token,
        [CREDENTIAL_ID],
        1,
      ),
    ).rejects.toThrow(/expired|revoked/i);
  });

  it("rejects an auth completion begun before removal even if session cleanup fails", async () => {
    const { authority, ephemeral } = makeAuthority();
    const challenge = await authority.storeAuthChallenge({
      id: "challenge-id",
      subjectId: SUBJECT_ID,
      challenge: "challenge-value",
      rpId: "chrome-extension://wallet-id",
      origin: "chrome-extension://wallet-id",
      credentialIds: [CREDENTIAL_ID],
      expiresAt: 10_000,
    });

    // Generation advancement is the security boundary. Deletion is best-
    // effort cleanup and cannot be the only thing that prevents a stale
    // service-worker ceremony from completing.
    ephemeral.failDeletes = true;
    await authority.invalidateSubject(SUBJECT_ID);
    ephemeral.failDeletes = false;

    const stale = await authority.takeAuthChallenge(SUBJECT_ID);
    expect(stale.id).toBe(challenge.id);
    await expect(
      authority.assertCurrentGeneration(
        SUBJECT_ID,
        stale.bindingGeneration,
      ),
    ).rejects.toThrow(/revoked/i);
  });

  it("invalidates an outstanding enrollment challenge on removal", async () => {
    const { authority, ephemeral } = makeAuthority();
    await authority.storeEnrollmentChallenge({
      id: "enrollment-id",
      subjectId: SUBJECT_ID,
      challenge: "enrollment-challenge",
      rpId: "chrome-extension://wallet-id",
      origin: "chrome-extension://wallet-id",
      vaultEpoch: 7,
      expiresAt: 10_000,
    });

    ephemeral.failDeletes = true;
    await authority.invalidateSubject(SUBJECT_ID);
    ephemeral.failDeletes = false;

    const stale = await authority.takeEnrollmentChallenge(SUBJECT_ID);
    await expect(
      authority.assertCurrentGeneration(
        SUBJECT_ID,
        stale.bindingGeneration,
      ),
    ).rejects.toThrow(/revoked/i);
  });

  it("binds an unlock grant to the exact enrolled credential", async () => {
    const { authority } = makeAuthority();
    const grant = await authority.issueUnlockGrant({
      token: "grant-token-with-at-least-thirty-two-characters",
      subjectId: SUBJECT_ID,
      credentialId: CREDENTIAL_ID,
      expiresAt: 10_000,
    });

    await expect(
      authority.consumeUnlockGrant(
        SUBJECT_ID,
        grant.token,
        ["different-credential"],
        1,
      ),
    ).rejects.toThrow(/does not match/i);
  });

  it("advances durable generation before relying on ephemeral deletion", async () => {
    const { authority, durable, ephemeral } = makeAuthority();
    ephemeral.failDeletes = true;

    await expect(authority.invalidateSubject(SUBJECT_ID)).resolves.toBeUndefined();
    expect(
      durable.values.get(
        `${PASSKEY_BINDING_GENERATION_KEY_PREFIX}${SUBJECT_ID}`,
      ),
    ).toBe("1");
  });

  it("fails before revocation when the durable generation cannot be written", async () => {
    const { authority, durable } = makeAuthority();
    durable.failSets = true;

    await expect(authority.invalidateSubject(SUBJECT_ID)).rejects.toThrow(
      /set failed/i,
    );
    expect(await authority.getBindingGeneration(SUBJECT_ID)).toBe(0);
  });
});
