/**
 * Decision logic for the `export-private-key` bridge message.
 *
 * The handler lives here rather than inline in background.ts so the same
 * code runs under the integration harness: background.ts cannot be imported
 * from vitest, and a copy of the gate inside the harness would test the
 * copy. Everything the gate needs is injected — vault, keyring, audit — and
 * it returns the bridge response shape for the caller to send.
 *
 * Order of checks, and why
 * ────────────────────────
 *   1. Sender. Only an extension-origin page may ask. A content script
 *      speaks for a website, and no framing of the request makes a website
 *      a legitimate recipient of a private key.
 *   2. Lock state. Possession of an unlocked session is the floor.
 *   3. Payload shape. A malformed request is refused before any work.
 *   4. Backoff. Refused without touching the vault while a wrong-password
 *      delay is in force, so repeated guesses cost the guesser time and the
 *      wallet nothing.
 *   5. Account. Checked before the password so an unknown id cannot be used
 *      to test passwords without that test being counted.
 *   6. Password. Verified against the vault even though the session is
 *      already unlocked: an open popup on an unattended machine must not be
 *      enough to lift a key. A wrong password counts against the backoff.
 *   7. Custody. Refused by the backend when the key is not extractable.
 *
 * Every refusal is audited with a reason. A successful export is audited
 * with the address only — key material never enters the audit chain.
 */

import { PasswordAttemptLimiter } from "./password-attempt-limiter";

export type PrivateKeyExportAuditKind = "private-key-exported" | "private-key-export-refused";

export type PrivateKeyExportRefusalReason =
  | "untrusted-sender"
  | "locked"
  | "invalid-request"
  | "throttled"
  | "unknown-account"
  | "wrong-password"
  | "custody-refused";

export interface PrivateKeyExportGateDeps {
  isLocked(): boolean;
  verifyPassword(password: string): Promise<void>;
  findAccount(accountId: string): { id: string; address: string } | undefined;
  exportPrivateKey(accountId: string): Promise<string>;
  recordAudit(kind: PrivateKeyExportAuditKind, detail: Record<string, unknown>): void;
  passwordAttempts: PasswordAttemptLimiter;
}

export type PrivateKeyExportOutcome =
  | { result: { privateKey: string; address: string } }
  | { error: { code: number; message: string } };

export const PRIVATE_KEY_EXPORT_UNTRUSTED_SENDER_MESSAGE =
  "Private key export is only available to trusted wallet pages";

export async function gatePrivateKeyExport(
  deps: PrivateKeyExportGateDeps,
  payload: unknown,
  senderTrusted: boolean,
): Promise<PrivateKeyExportOutcome> {
  const body = (payload ?? {}) as { accountId?: unknown; password?: unknown };
  const accountId = typeof body.accountId === "string" ? body.accountId : undefined;

  const refuse = (
    reason: PrivateKeyExportRefusalReason,
    code: number,
    message: string,
    extra: Record<string, unknown> = {},
  ): PrivateKeyExportOutcome => {
    deps.recordAudit("private-key-export-refused", { accountId: accountId ?? null, reason, ...extra });
    return { error: { code, message } };
  };

  if (!senderTrusted) {
    return refuse("untrusted-sender", 4100, PRIVATE_KEY_EXPORT_UNTRUSTED_SENDER_MESSAGE);
  }

  if (deps.isLocked()) {
    return refuse("locked", 4100, "Unlock the wallet to export a private key");
  }

  if (!accountId) {
    return refuse("invalid-request", -32602, "accountId is required");
  }
  if (typeof body.password !== "string" || body.password.length === 0) {
    return refuse("invalid-request", -32602, "Password is required");
  }
  const password = body.password;

  const attempt = deps.passwordAttempts.check();
  if (!attempt.allowed) {
    const retryAfterSeconds = Math.ceil(attempt.retryAfterMs / 1_000);
    return refuse(
      "throttled",
      4100,
      `Too many incorrect passwords. Try again in ${retryAfterSeconds}s`,
      { retryAfterMs: attempt.retryAfterMs },
    );
  }

  const account = deps.findAccount(accountId);
  if (!account) {
    return refuse("unknown-account", 4100, "Account not found");
  }

  try {
    await deps.verifyPassword(password);
  } catch {
    const failure = deps.passwordAttempts.recordFailure();
    return refuse("wrong-password", 4100, "Incorrect password", {
      failures: failure.failures,
      retryAfterMs: failure.retryAfterMs,
    });
  }
  deps.passwordAttempts.recordSuccess();

  let privateKey: string;
  try {
    privateKey = await deps.exportPrivateKey(accountId);
  } catch (error) {
    return refuse("custody-refused", -32601, error instanceof Error ? error.message : "Export failed");
  }

  deps.recordAudit("private-key-exported", { accountId, address: account.address });
  return { result: { privateKey, address: account.address } };
}
