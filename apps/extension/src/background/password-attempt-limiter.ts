/**
 * Wrong-password backoff shared by every surface that verifies the vault
 * password without unlocking it.
 *
 * Why it exists
 * ─────────────
 * `MasterKey.verifyPassword` answers "is this the password?" in constant
 * shape whether the wallet is locked or unlocked. Any handler that exposes
 * that answer to the popup — private-key export, recovery-phrase reveal —
 * is an oracle unless guesses are rate-limited: an attacker with a foothold
 * in the extension page could otherwise sweep a dictionary against the
 * vault at PBKDF2 speed. The limiter keeps a single failure count for the
 * vault (there is one password, so one counter) and imposes an exponential
 * delay once the free allowance is spent.
 *
 * Why it is in memory
 * ───────────────────
 * The service worker is evicted after idle and the count resets with it.
 * That bounds the guarantee at "a few guesses per worker lifetime" rather
 * than "a few guesses per install", which matches the surrounding wallet:
 * the unlocked session itself is also worker-scoped. Persisting the count
 * would need a storage write on every failure and is a separate decision.
 */

export interface PasswordAttemptLimiterOptions {
  /** Failures tolerated before any delay applies. */
  freeAttempts?: number;
  /** First delay after the free allowance, doubled per further failure. */
  baseDelayMs?: number;
  /** Ceiling for the doubled delay. */
  maxDelayMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export type PasswordAttemptCheck =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

export interface PasswordAttemptFailure {
  failures: number;
  retryAfterMs: number;
}

const DEFAULT_FREE_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 5 * 60 * 1_000;

export class PasswordAttemptLimiter {
  private failures = 0;
  private blockedUntil = 0;
  private readonly freeAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly now: () => number;

  constructor(options: PasswordAttemptLimiterOptions = {}) {
    this.freeAttempts = options.freeAttempts ?? DEFAULT_FREE_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.now = options.now ?? Date.now;
    if (this.freeAttempts < 0 || this.baseDelayMs <= 0 || this.maxDelayMs < this.baseDelayMs) {
      throw new RangeError("Invalid password attempt limiter configuration");
    }
  }

  /** Whether a password may be verified right now. */
  check(): PasswordAttemptCheck {
    const remaining = this.blockedUntil - this.now();
    return remaining > 0 ? { allowed: false, retryAfterMs: remaining } : { allowed: true };
  }

  /** Count a wrong password and return the delay now in force. */
  recordFailure(): PasswordAttemptFailure {
    this.failures += 1;
    const penalised = this.failures - this.freeAttempts;
    if (penalised <= 0) {
      return { failures: this.failures, retryAfterMs: 0 };
    }
    // 2^(penalised-1) grows without bound; clamp the exponent before the
    // multiplication so a long-running counter cannot overflow to Infinity.
    const exponent = Math.min(penalised - 1, 30);
    const retryAfterMs = Math.min(this.baseDelayMs * 2 ** exponent, this.maxDelayMs);
    this.blockedUntil = this.now() + retryAfterMs;
    return { failures: this.failures, retryAfterMs };
  }

  /** A correct password clears the count; the delay is a guess deterrent, not a lockout. */
  recordSuccess(): void {
    this.failures = 0;
    this.blockedUntil = 0;
  }

  getFailureCount(): number {
    return this.failures;
  }
}
