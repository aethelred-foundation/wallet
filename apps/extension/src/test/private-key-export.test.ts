/**
 * Private key export.
 *
 * The feature exists because an account created in this wallet is otherwise
 * unusable from a deployment script — the recovery phrase backs up the wallet,
 * but nothing hands a single account's key to a tool that needs one.
 *
 * The tests that matter here are the refusals. An export is the most dangerous
 * value the wallet holds, so what it must NOT do is more interesting than what
 * it does: it must never invent a key for a backend that has none, and it must
 * never widen from one account to the whole derivation tree.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { KeyManager, LocalCustodyBackend } from "@aethelred/wallet-core";

import { PasswordAttemptLimiter } from "../background/password-attempt-limiter";
import {
  createBackgroundHarness,
  findAuditEventsOfKind,
  TEST_PASSWORD,
  type BackgroundHarness,
} from "./integration/harness";

const MNEMONIC =
  "test test test test test test test test test test test junk".split(" ");

/**
 * Stand-in for EncryptedStorage. captureUnlockedEpoch is part of the contract:
 * the real implementation uses it to detect a lock happening mid-operation, so
 * a stub without it fails in a way that has nothing to do with the test.
 */
function memoryStorage() {
  const map = new Map<string, unknown>();
  return {
    captureUnlockedEpoch: () => 1,
    assertUnlockedAtEpoch: () => {},
    get: async <T,>(key: string) => (map.get(key) ?? null) as T | null,
    set: async (key: string, value: unknown) => void map.set(key, value),
    delete: async (key: string) => void map.delete(key),
  };
}

async function localWallet() {
  const storage = memoryStorage();
  const custody = new LocalCustodyBackend(storage as never);
  const manager = new KeyManager(custody as never, storage as never);
  await manager.importFromMnemonic(MNEMONIC, "Account 1");
  return { manager, custody };
}

describe("exportPrivateKey", () => {
  it("returns a 32-byte key as 0x-prefixed hex", async () => {
    const { manager } = await localWallet();
    const [account] = manager.getAccounts();

    const key = await manager.exportPrivateKey(account.id);

    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("returns the key that actually controls the account", async () => {
    // The check that makes this feature worth having: a key that does not
    // derive back to the displayed address would send a developer's funds
    // somewhere they did not intend.
    const { manager, custody } = await localWallet();
    const [account] = manager.getAccounts();

    const key = await manager.exportPrivateKey(account.id);
    const reimportStorage = memoryStorage();
    const reimportCustody = new LocalCustodyBackend(reimportStorage as never);
    const reimported = new KeyManager(
      reimportCustody as never,
      reimportStorage as never,
    );
    await reimported.importFromPrivateKey(
      Uint8Array.from(
        (key.slice(2).match(/../g) ?? []).map((b) => parseInt(b, 16)),
      ),
      "Reimported",
    );

    expect(reimported.getAccounts()[0].address.toLowerCase()).toBe(
      account.address.toLowerCase(),
    );
    expect(custody.capabilities.canExportPrivateKey).toBe(true);
  });

  it("exports ONE account, not the whole derivation tree", async () => {
    // Deliberately narrower than the recovery phrase. Two accounts from the
    // same mnemonic must not yield the same key.
    const { manager } = await localWallet();
    await manager.deriveNextAccount("Account 2");
    const [first, second] = manager.getAccounts();

    const keyOne = await manager.exportPrivateKey(first.id);
    const keyTwo = await manager.exportPrivateKey(second.id);

    expect(keyOne).not.toBe(keyTwo);
  });

  it("refuses an unknown account", async () => {
    const { manager } = await localWallet();
    await expect(manager.exportPrivateKey("no-such-account")).rejects.toThrow(
      /Account not found/u,
    );
  });

  it("refuses a backend whose key is not extractable", async () => {
    // A hardware or MPC slot has no key to hand over. Returning anything at
    // all — a placeholder, a derived value — would be worse than failing,
    // because the caller would carry it away believing it was a key.
    const { manager, custody } = await localWallet();
    const [account] = manager.getAccounts();

    Object.defineProperty(custody, "capabilities", {
      value: { ...custody.capabilities, canExportPrivateKey: false },
      configurable: true,
    });

    await expect(manager.exportPrivateKey(account.id)).rejects.toThrow(
      /not extractable/u,
    );
  });
});

/* ─── Bridge handler ─────────────────────────────────────────────────
 * The gate in background/private-key-export-gate.ts is the code the
 * service worker runs; the harness wires it to the same MasterKey,
 * KeyManager and AuditCapture classes. These tests are about what the
 * handler refuses, in what order, and what it writes to the audit chain —
 * the key itself was proven above.
 * ──────────────────────────────────────────────────────────────────── */

const PRIVATE_KEY_PATTERN = /0x[0-9a-f]{64}/iu;

describe("export-private-key bridge handler", () => {
  let harness: BackgroundHarness;
  let accountId: string;
  let address: string;

  beforeEach(async () => {
    harness = await createBackgroundHarness();
    const [account] = harness.getKnownAccounts();
    accountId = account.id;
    address = account.address;
  });

  afterEach(async () => {
    await harness.dispose();
  });

  function refusals() {
    return findAuditEventsOfKind(harness.getAuditEvents(), "private-key-export-refused");
  }

  function exports() {
    return findAuditEventsOfKind(harness.getAuditEvents(), "private-key-exported");
  }

  it("refuses while locked and audits the refusal", async () => {
    await harness.sendMessage("lock-request", {});

    const response = await harness.sendMessage("export-private-key", {
      accountId,
      password: TEST_PASSWORD,
    });

    expect(response.payload.error).toMatchObject({ code: 4100 });
    expect(response.payload.result).toBeUndefined();
    expect(refusals()).toHaveLength(1);
    expect(refusals()[0].detail).toMatchObject({ accountId, reason: "locked" });
    expect(exports()).toHaveLength(0);
  });

  it("refuses a wrong password even though the session is unlocked, and counts the attempt", async () => {
    const response = await harness.sendMessage("export-private-key", {
      accountId,
      password: "not-the-password",
    });

    expect(response.payload.error).toMatchObject({ code: 4100, message: "Incorrect password" });
    expect(refusals()).toHaveLength(1);
    expect(refusals()[0].detail).toMatchObject({ accountId, reason: "wrong-password", failures: 1 });
    expect(harness.getPasswordAttempts().getFailureCount()).toBe(1);
    expect(exports()).toHaveLength(0);
  });

  it("refuses without a password rather than treating the open session as consent", async () => {
    const response = await harness.sendMessage("export-private-key", { accountId });

    expect(response.payload.error).toMatchObject({ code: -32602 });
    expect(refusals()[0].detail).toMatchObject({ accountId, reason: "invalid-request" });
    expect(harness.getPasswordAttempts().getFailureCount()).toBe(0);
  });

  it("refuses while the wrong-password backoff is in force without consulting the vault", async () => {
    const limiter = harness.getPasswordAttempts();
    for (let i = 0; i < 4; i += 1) limiter.recordFailure();

    const response = await harness.sendMessage("export-private-key", {
      accountId,
      password: TEST_PASSWORD,
    });

    // The password was correct. It must still be refused, and the refusal
    // must not have counted as a further failure — the vault was never asked.
    expect(response.payload.error).toMatchObject({ code: 4100 });
    expect(response.payload.error?.message).toMatch(/try again in/iu);
    expect(refusals()[0].detail).toMatchObject({ reason: "throttled" });
    expect(limiter.getFailureCount()).toBe(4);
    expect(exports()).toHaveLength(0);
  });

  it("shares the backoff with unlock so export cannot be used as a password oracle", async () => {
    await harness.sendMessage("lock-request", {});
    await harness.sendMessage("unlock-request", { password: "guess-1" });
    await harness.sendMessage("unlock-request", { password: "guess-2" });
    await harness.sendMessage("unlock-request", { password: TEST_PASSWORD });
    // A correct unlock clears the count.
    expect(harness.getPasswordAttempts().getFailureCount()).toBe(0);

    await harness.sendMessage("export-private-key", { accountId, password: "guess-3" });
    expect(harness.getPasswordAttempts().getFailureCount()).toBe(1);
  });

  it("refuses an unknown account before verifying the password", async () => {
    const response = await harness.sendMessage("export-private-key", {
      accountId: "no-such-account",
      password: "irrelevant",
    });

    expect(response.payload.error).toMatchObject({ code: 4100, message: "Account not found" });
    expect(refusals()[0].detail).toMatchObject({
      accountId: "no-such-account",
      reason: "unknown-account",
    });
    // An unknown id must not be a free password probe.
    expect(harness.getPasswordAttempts().getFailureCount()).toBe(0);
  });

  it("refuses a content-script sender regardless of password", async () => {
    const response = await harness.sendMessage(
      "export-private-key",
      { accountId, password: TEST_PASSWORD },
      "https://dapp.test",
      "content-script",
    );

    expect(response.payload.error).toMatchObject({ code: 4100 });
    expect(refusals()[0].detail).toMatchObject({ accountId, reason: "untrusted-sender" });
    expect(exports()).toHaveLength(0);
  });

  it("exports with a fresh password and audits the address only", async () => {
    const response = await harness.sendMessage("export-private-key", {
      accountId,
      password: TEST_PASSWORD,
    });

    const result = response.payload.result as { privateKey: string; address: string };
    expect(result.privateKey).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(result.address.toLowerCase()).toBe(address.toLowerCase());

    expect(refusals()).toHaveLength(0);
    expect(exports()).toHaveLength(1);
    expect(exports()[0].detail).toEqual({ accountId, address });

    // Nothing in the audit chain may carry key material, in any field.
    const serialised = JSON.stringify(harness.getAuditEvents());
    expect(serialised).not.toMatch(PRIVATE_KEY_PATTERN);
    expect(serialised).not.toContain(result.privateKey);
    expect(serialised).not.toContain(TEST_PASSWORD);
  });
});

/* ─── Backoff ────────────────────────────────────────────────────── */

describe("PasswordAttemptLimiter", () => {
  function limiterAt(clock: { now: number }) {
    return new PasswordAttemptLimiter({
      freeAttempts: 2,
      baseDelayMs: 1_000,
      maxDelayMs: 8_000,
      now: () => clock.now,
    });
  }

  it("allows the free attempts without delay", () => {
    const clock = { now: 0 };
    const limiter = limiterAt(clock);

    expect(limiter.recordFailure()).toEqual({ failures: 1, retryAfterMs: 0 });
    expect(limiter.recordFailure()).toEqual({ failures: 2, retryAfterMs: 0 });
    expect(limiter.check()).toEqual({ allowed: true });
  });

  it("doubles the delay per failure past the allowance and clamps at the ceiling", () => {
    const clock = { now: 0 };
    const limiter = limiterAt(clock);
    limiter.recordFailure();
    limiter.recordFailure();

    expect(limiter.recordFailure().retryAfterMs).toBe(1_000);
    expect(limiter.check()).toEqual({ allowed: false, retryAfterMs: 1_000 });
    clock.now = 1_000;
    expect(limiter.check()).toEqual({ allowed: true });

    expect(limiter.recordFailure().retryAfterMs).toBe(2_000);
    clock.now += 2_000;
    expect(limiter.recordFailure().retryAfterMs).toBe(4_000);
    clock.now += 4_000;
    expect(limiter.recordFailure().retryAfterMs).toBe(8_000);
    clock.now += 8_000;
    expect(limiter.recordFailure().retryAfterMs).toBe(8_000);
  });

  it("reports the remaining delay rather than the full one", () => {
    const clock = { now: 0 };
    const limiter = limiterAt(clock);
    limiter.recordFailure();
    limiter.recordFailure();
    limiter.recordFailure();

    clock.now = 400;
    expect(limiter.check()).toEqual({ allowed: false, retryAfterMs: 600 });
  });

  it("clears on success", () => {
    const clock = { now: 0 };
    const limiter = limiterAt(clock);
    for (let i = 0; i < 4; i += 1) limiter.recordFailure();
    expect(limiter.check().allowed).toBe(false);

    limiter.recordSuccess();

    expect(limiter.check()).toEqual({ allowed: true });
    expect(limiter.getFailureCount()).toBe(0);
  });

  it("does not overflow after very many failures", () => {
    const clock = { now: 0 };
    const limiter = limiterAt(clock);
    let last = { failures: 0, retryAfterMs: 0 };
    for (let i = 0; i < 100; i += 1) last = limiter.recordFailure();

    expect(Number.isFinite(last.retryAfterMs)).toBe(true);
    expect(last.retryAfterMs).toBe(8_000);
  });

  it("rejects a configuration that cannot enforce anything", () => {
    expect(() => new PasswordAttemptLimiter({ baseDelayMs: 0 })).toThrow(RangeError);
    expect(() => new PasswordAttemptLimiter({ baseDelayMs: 10, maxDelayMs: 5 })).toThrow(RangeError);
    expect(() => new PasswordAttemptLimiter({ freeAttempts: -1 })).toThrow(RangeError);
  });
});
