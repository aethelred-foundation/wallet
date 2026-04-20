/**
 * Typed error class + category taxonomy used across every wallet package.
 *
 * Every throw point in a critical path SHOULD wrap or raise `AethelredError`
 * with a code from `ERROR_CODES`. Downstream code can then discriminate on
 * `.category` without string-matching on `.message`.
 *
 * Design notes:
 *   - `category` is a narrow union, chosen so retry / escalation can be
 *     decided mechanically (e.g. "network-error" is retryable,
 *     "integrity-failure" never is).
 *   - `hint` is optional and contains both user-facing + developer-facing
 *     text plus machine-readable retry metadata.
 *   - `correlationId` carries from logs → spans → errors so a single
 *     request can be traced end-to-end across process boundaries.
 *   - `.cause` uses the standard ES2022 Error cause chain; we propagate
 *     the root error for debugging.
 *
 * @example
 * ```ts
 * import { AethelredError, ERROR_CODES } from "@aethelred/wallet-observability";
 *
 * throw new AethelredError({
 *   code: ERROR_CODES.rpc.REQUEST_TIMEOUT,
 *   category: "network-error",
 *   message: "eth_call timed out after 15s",
 *   correlationId: "req-abc",
 *   attributes: { method: "eth_call", chainId: "0x1" },
 *   hint: {
 *     userMessage: "Network is slow — try again in a moment.",
 *     developerMessage: "RPC request exceeded timeoutMs",
 *     retryable: true,
 *     retryAfterMs: 2000,
 *     escalateToSupport: false,
 *   },
 * });
 * ```
 */

import type { LogRecord, LogLevel } from "./logger";

/**
 * Error categories. Chosen so routing / retry / UX decisions are mechanical.
 */
export type ErrorCategory =
  /** User provided invalid input (malformed address, bad amount). Not retryable. */
  | "user-error"
  /** Transient network / RPC failure. Retryable after backoff. */
  | "network-error"
  /** Intentional policy denial (spend cap, blocklist). Not automatically retryable. */
  | "policy-rejected"
  /** Signature / hash / audit chain verification failed. NEVER retryable. */
  | "integrity-failure"
  /** A feature path that isn't built yet. Not retryable. */
  | "not-implemented"
  /** Missing SDK, missing permission, missing hardware. Retryable after fix. */
  | "dependency-error"
  /** Our bug. Not retryable; page SRE. */
  | "internal-error";

/**
 * Recovery instructions attached to an error. Every surface (popup / options /
 * native) uses these fields to decide what to show the user and whether to
 * auto-retry.
 */
export interface ErrorRecoveryHint {
  /** What to say to the user. MUST NOT contain stack traces or internal IDs. */
  userMessage: string;
  /** What went wrong technically. Goes to logs / bug reports. */
  developerMessage: string;
  /** Is an automatic retry safe? */
  retryable: boolean;
  /** Honor this before retrying, if provided. */
  retryAfterMs?: number;
  /** Flip on when human intervention is required (SIM swap, fraud alert). */
  escalateToSupport: boolean;
}

/**
 * Options accepted by the AethelredError constructor.
 */
export interface AethelredErrorOptions {
  /** Stable machine-readable code from the catalog. */
  code: string;
  /** How this error should be categorized for routing decisions. */
  category: ErrorCategory;
  /** Human-readable message. Avoid PII; see `hint.userMessage` for UX copy. */
  message: string;
  /** Recovery hint for UI surfaces + retry logic. */
  hint?: ErrorRecoveryHint;
  /** ES2022 standard cause chain root. */
  cause?: unknown;
  /** Correlation id set by the caller's logger / tracer. */
  correlationId?: string;
  /** Flat machine-readable attributes, similar to log attributes. */
  attributes?: Record<string, unknown>;
  /** Component emitting the error; defaults to "unknown". */
  component?: string;
}

/**
 * Base error class for every package in the monorepo. Sub-packages (chain,
 * audit, approval, etc.) may extend this OR construct it directly with
 * their own code from the registry.
 */
export class AethelredError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly hint?: ErrorRecoveryHint;
  readonly correlationId?: string;
  readonly attributes: Record<string, unknown>;
  readonly component: string;
  readonly createdAt: number;

  constructor(opts: AethelredErrorOptions) {
    super(opts.message, { cause: opts.cause });
    this.name = "AethelredError";
    this.code = opts.code;
    this.category = opts.category;
    this.hint = opts.hint;
    this.correlationId = opts.correlationId;
    this.attributes = { ...(opts.attributes ?? {}) };
    this.component = opts.component ?? "unknown";
    this.createdAt = Date.now();
  }

  /**
   * Normalize to a LogRecord suitable for `Logger.error`. Severity is
   * derived from category — integrity failures are always "fatal".
   */
  toLogRecord(): LogRecord {
    const level: LogLevel =
      this.category === "integrity-failure"
        ? "fatal"
        : this.category === "internal-error"
          ? "error"
          : "warn";

    const flatAttrs: Record<string, string | number | boolean | null> = { category: this.category };
    for (const key of Object.keys(this.attributes)) {
      const v = this.attributes[key];
      if (v === null || v === undefined) flatAttrs[key] = null;
      else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        flatAttrs[key] = v;
      } else if (v instanceof Error) flatAttrs[key] = v.message;
      else {
        try {
          flatAttrs[key] = JSON.stringify(v);
        } catch {
          flatAttrs[key] = String(v);
        }
      }
    }

    const record: LogRecord = {
      level,
      timestamp: this.createdAt,
      message: this.message,
      code: this.code,
      component: this.component,
      attributes: flatAttrs,
      error: {
        name: this.name,
        message: this.message,
        stack: this.stack,
        cause: (this as { cause?: unknown }).cause,
      },
    };
    if (this.correlationId) record.correlationId = this.correlationId;
    return record;
  }

  /**
   * Produce a user-safe JSON envelope for the extension UI / native bridge.
   * Strips stack, normalizes attributes. Use this when an error crosses
   * the process boundary.
   */
  toPublicJson(): Record<string, unknown> {
    return {
      code: this.code,
      category: this.category,
      message: this.hint?.userMessage ?? this.message,
      retryable: this.hint?.retryable ?? false,
      retryAfterMs: this.hint?.retryAfterMs,
      escalateToSupport: this.hint?.escalateToSupport ?? false,
      correlationId: this.correlationId,
    };
  }

  /**
   * Retry convenience — returns `true` when the category + hint combine to
   * indicate the caller SHOULD retry automatically.
   */
  isRetryable(): boolean {
    if (this.hint?.retryable === false) return false;
    if (this.hint?.retryable === true) return true;
    return this.category === "network-error" || this.category === "dependency-error";
  }

  /**
   * Wrap an unknown error into a `AethelredError` with sensible defaults.
   * If the value is already an `AethelredError`, it is returned unchanged.
   */
  static wrap(
    value: unknown,
    defaults: {
      code: string;
      category: ErrorCategory;
      component?: string;
      correlationId?: string;
    }
  ): AethelredError {
    if (value instanceof AethelredError) return value;
    const message =
      value instanceof Error ? value.message : typeof value === "string" ? value : String(value);
    return new AethelredError({
      code: defaults.code,
      category: defaults.category,
      message,
      cause: value,
      correlationId: defaults.correlationId,
      component: defaults.component,
    });
  }
}
