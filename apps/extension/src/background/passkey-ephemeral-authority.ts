/**
 * Durable revocation authority for one-time passkey ceremonies.
 *
 * Challenges and unlock grants live in session storage, but their revocation
 * generation lives in durable local storage. Advancing the generation before
 * deleting a credential makes every previously issued ceremony unusable even
 * when a session-storage delete fails or a service worker is terminated
 * between the revocation writes.
 */

export interface PasskeyStringStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const PASSKEY_ENROLLMENT_CHALLENGE_KEY_PREFIX =
  "passkey-enroll-challenge:";
export const PASSKEY_AUTH_CHALLENGE_KEY_PREFIX = "passkey-auth-challenge:";
export const PASSKEY_UNLOCK_GRANT_KEY_PREFIX = "passkey-unlock-grant:";
export const PASSKEY_BINDING_GENERATION_KEY_PREFIX =
  "passkey-binding-generation:";

export interface PasskeyEnrollmentChallengeRecord {
  id: string;
  subjectId: string;
  challenge: string;
  rpId: string;
  origin: string;
  /** Exact unlocked MasterKey lifetime in which enrollment began. */
  vaultEpoch: number;
  bindingGeneration: number;
  expiresAt: number;
}

export interface PasskeyAuthChallengeRecord {
  id: string;
  subjectId: string;
  challenge: string;
  rpId: string;
  origin: string;
  credentialIds: string[];
  bindingGeneration: number;
  expiresAt: number;
}

export interface PasskeyUnlockGrantRecord {
  token: string;
  subjectId: string;
  credentialId: string;
  bindingGeneration: number;
  expiresAt: number;
}

type WithoutBindingGeneration<T> = Omit<T, "bindingGeneration">;

function parseGeneration(raw: string | null): number {
  if (raw === null) return 0;
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) {
    throw new Error(
      "Passkey revocation state is invalid; restore this wallet with its recovery phrase",
    );
  }
  const generation = Number(raw);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error(
      "Passkey revocation state is invalid; restore this wallet with its recovery phrase",
    );
  }
  return generation;
}

function parseRecord<T>(raw: string | null, description: string): T {
  if (!raw) throw new Error(`${description} expired; try again`);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${description} state is invalid; try again`);
  }
}

export class PasskeyEphemeralAuthority {
  constructor(
    private readonly durableStorage: PasskeyStringStorage,
    private readonly ephemeralStorage: PasskeyStringStorage,
  ) {}

  async getBindingGeneration(subjectId: string): Promise<number> {
    return parseGeneration(
      await this.durableStorage.get(
        `${PASSKEY_BINDING_GENERATION_KEY_PREFIX}${subjectId}`,
      ),
    );
  }

  async assertCurrentGeneration(
    subjectId: string,
    expectedGeneration: number,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(expectedGeneration) ||
      expectedGeneration < 0 ||
      (await this.getBindingGeneration(subjectId)) !== expectedGeneration
    ) {
      throw new Error("Passkey verification was revoked; try again");
    }
  }

  async storeEnrollmentChallenge(
    record: WithoutBindingGeneration<PasskeyEnrollmentChallengeRecord>,
  ): Promise<PasskeyEnrollmentChallengeRecord> {
    const complete = {
      ...record,
      bindingGeneration: await this.getBindingGeneration(record.subjectId),
    };
    await this.ephemeralStorage.set(
      `${PASSKEY_ENROLLMENT_CHALLENGE_KEY_PREFIX}${record.subjectId}`,
      JSON.stringify(complete),
    );
    return complete;
  }

  async takeEnrollmentChallenge(
    subjectId: string,
  ): Promise<PasskeyEnrollmentChallengeRecord> {
    const key = `${PASSKEY_ENROLLMENT_CHALLENGE_KEY_PREFIX}${subjectId}`;
    const raw = await this.ephemeralStorage.get(key);
    await this.ephemeralStorage.delete(key);
    return parseRecord(raw, "Passkey enrollment challenge");
  }

  async storeAuthChallenge(
    record: WithoutBindingGeneration<PasskeyAuthChallengeRecord>,
  ): Promise<PasskeyAuthChallengeRecord> {
    const complete = {
      ...record,
      bindingGeneration: await this.getBindingGeneration(record.subjectId),
    };
    await this.ephemeralStorage.set(
      `${PASSKEY_AUTH_CHALLENGE_KEY_PREFIX}${record.subjectId}`,
      JSON.stringify(complete),
    );
    return complete;
  }

  async takeAuthChallenge(
    subjectId: string,
  ): Promise<PasskeyAuthChallengeRecord> {
    const key = `${PASSKEY_AUTH_CHALLENGE_KEY_PREFIX}${subjectId}`;
    const raw = await this.ephemeralStorage.get(key);
    await this.ephemeralStorage.delete(key);
    return parseRecord(raw, "Passkey challenge");
  }

  async issueUnlockGrant(
    record: WithoutBindingGeneration<PasskeyUnlockGrantRecord>,
  ): Promise<PasskeyUnlockGrantRecord> {
    const complete = {
      ...record,
      bindingGeneration: await this.getBindingGeneration(record.subjectId),
    };
    await this.ephemeralStorage.set(
      `${PASSKEY_UNLOCK_GRANT_KEY_PREFIX}${record.subjectId}`,
      JSON.stringify(complete),
    );
    return complete;
  }

  async consumeUnlockGrant(
    subjectId: string,
    suppliedToken: string,
    currentCredentialIds: readonly string[],
    now = Date.now(),
  ): Promise<PasskeyUnlockGrantRecord> {
    const key = `${PASSKEY_UNLOCK_GRANT_KEY_PREFIX}${subjectId}`;
    const raw = await this.ephemeralStorage.get(key);
    // Consume before validating so malformed, expired, and replayed grants are
    // one-time too.
    await this.ephemeralStorage.delete(key);
    const record = parseRecord<PasskeyUnlockGrantRecord>(
      raw,
      "Passkey verification",
    );
    await this.assertCurrentGeneration(subjectId, record.bindingGeneration);
    if (
      record.subjectId !== subjectId ||
      record.token !== suppliedToken ||
      record.expiresAt < now ||
      !currentCredentialIds.includes(record.credentialId)
    ) {
      throw new Error(
        "Passkey verification expired or does not match this wallet",
      );
    }
    return record;
  }

  /**
   * Invalidate every outstanding ceremony for a subject.
   *
   * The durable generation is advanced first. Session-key deletion is only
   * cleanup: even if it fails, stale records carry the previous generation
   * and fail closed at completion/consumption. A caller must invoke this while
   * holding the same passkey binding lock as the credential mutation.
   */
  async invalidateSubject(subjectId: string): Promise<void> {
    const generation = await this.getBindingGeneration(subjectId);
    if (generation === Number.MAX_SAFE_INTEGER) {
      throw new Error(
        "Passkey revocation state is exhausted; restore this wallet with its recovery phrase",
      );
    }
    await this.durableStorage.set(
      `${PASSKEY_BINDING_GENERATION_KEY_PREFIX}${subjectId}`,
      String(generation + 1),
    );

    await Promise.allSettled([
      this.ephemeralStorage.delete(
        `${PASSKEY_ENROLLMENT_CHALLENGE_KEY_PREFIX}${subjectId}`,
      ),
      this.ephemeralStorage.delete(
        `${PASSKEY_AUTH_CHALLENGE_KEY_PREFIX}${subjectId}`,
      ),
      this.ephemeralStorage.delete(
        `${PASSKEY_UNLOCK_GRANT_KEY_PREFIX}${subjectId}`,
      ),
    ]);
  }
}
