/**
 * Compile-time exhaustiveness primitives.
 *
 * TypeScript's discriminated unions only stay safe when every `switch` ends
 * with a `default` arm that proves it has narrowed the union to `never`. If
 * a new variant is added to the union, the `assertNever` call site stops
 * type-checking — the bug surfaces at build time instead of hiding behind a
 * silent fallthrough.
 *
 * This module is the canonical home for that pattern in the wallet:
 *   - `assertNever` — throwing variant; use in critical paths where an
 *     unhandled variant represents a bug that MUST not ship.
 *   - `warnNever`   — logging variant; for surfaces (UI, telemetry labels)
 *     where an unknown variant should degrade gracefully but still be
 *     reported.
 *   - `match`       — an inlined exhaustive matcher; new code should prefer
 *     it over `switch` when returning a value from each arm.
 *
 * The helpers have zero runtime cost on the common path — the call site is
 * a dead branch that TypeScript eliminates at build time. The thrown /
 * logged form only fires when a runtime value sneaks past the type system
 * (for example, untrusted JSON decoded into a typed variable).
 *
 * @example Switch with exhaustiveness
 * ```ts
 * type Event = { kind: "a"; value: number } | { kind: "b"; label: string };
 *
 * function handle(e: Event): string {
 *   switch (e.kind) {
 *     case "a": return `a=${e.value}`;
 *     case "b": return `b=${e.label}`;
 *     default: return assertNever(e, "handle");
 *   }
 * }
 * ```
 *
 * @example Graceful degradation
 * ```ts
 * function badgeColor(status: Status, log: Logger): string {
 *   switch (status) {
 *     case "ok":   return "green";
 *     case "warn": return "amber";
 *     case "bad":  return "red";
 *     default:
 *       warnNever(status, "badgeColor", log);
 *       return "gray";
 *   }
 * }
 * ```
 *
 * @example Exhaustive matcher
 * ```ts
 * const label = match(tier, {
 *   personal: () => "Personal",
 *   workspace: () => "Workspace",
 *   enterprise: () => "Enterprise",
 *   sovereign: () => "Sovereign",
 * });
 * ```
 */

/**
 * Minimal structural type for the one logger method `warnNever` calls. Declared
 * here (rather than imported as `Logger` from `./logger`) to break the
 * cycle: `logger.ts` imports `assertNever` from this file, and this file
 * used to import the `Logger` type from `logger.ts`. madge surfaces that as
 * a module-level circular dependency even though TypeScript handles the
 * type-only edge fine at compile time — but the cycle is a real liability
 * in the module graph (eager evaluation order of class field initializers
 * can break subtly), so we break it structurally.
 *
 * Any `Logger` instance satisfies this shape; callers never need to pass
 * anything other than a full Logger, but the decoupling keeps the dep graph
 * acyclic.
 */
interface WarnableLogger {
  warn(
    code: string,
    message: string,
    attrs?: Record<string, unknown>,
  ): void;
}

/**
 * Tagged error raised by {@link assertNever}. Subclassed so error-handling
 * code can distinguish a non-exhaustive switch from a user / network / policy
 * failure. `ExhaustivenessError` always indicates a DEVELOPER bug — a union
 * variant was added without updating one of the consumers.
 */
export class ExhaustivenessError extends Error {
  readonly kind: "exhaustiveness" = "exhaustiveness";
  /** The runtime value that escaped the type system. */
  readonly value: unknown;
  /** Call-site hint passed to {@link assertNever}, if any. */
  readonly context?: string;

  constructor(message: string, value: unknown, context?: string) {
    super(message);
    this.name = "ExhaustivenessError";
    this.value = value;
    this.context = context;
  }
}

/**
 * Compile-time exhaustiveness marker. Call in the `default` arm of a switch
 * over a discriminated union. If TypeScript infers anything other than
 * `never` for `x` at the call site, the code will not compile — forcing
 * every union variant to be handled.
 *
 * Throws an {@link ExhaustivenessError} if reached at runtime (only possible
 * when an untyped value is cast into the union, e.g. via `JSON.parse`).
 *
 * @param x       The narrowed value; TypeScript should infer this as `never`.
 * @param context Optional human-readable label pointing at the call site
 *                (typically the name of the surrounding function or switch).
 */
export function assertNever(x: never, context?: string): never {
  const detail = context ? ` in ${context}` : "";
  throw new ExhaustivenessError(
    `Non-exhaustive switch${detail}: unexpected value ${safeStringify(x)}`,
    x,
    context,
  );
}

/**
 * Non-throwing variant of {@link assertNever}. Logs via the provided
 * observability logger and returns `undefined`. Use on non-critical paths
 * (UX labels, telemetry metadata) where a missing case should not crash
 * the process but should still surface in SRE dashboards.
 *
 * Prefer {@link assertNever} for critical paths (cryptographic checks,
 * policy evaluators, message dispatch) where a silent miss would be worse
 * than a crash.
 *
 * @param x       The narrowed value; TypeScript should infer this as `never`.
 * @param context Human-readable label identifying the call site.
 * @param logger  Observability logger that receives a `warn` record.
 */
export function warnNever(
  x: never,
  context: string,
  logger: WarnableLogger,
): void {
  logger.warn("exhaustiveness.miss", `Non-exhaustive switch in ${context}`, {
    context,
    value: safeStringify(x),
  });
}

/**
 * Exhaustive matcher over a string literal union. Equivalent to a `switch`
 * that returns a value from every arm — but the type system forces `cases`
 * to cover every variant of `K`, with no fallthrough and no implicit
 * `undefined`.
 *
 * Prefer `match()` in new code when every arm returns a value (label maps,
 * status-to-icon, tier-to-color). Use `switch + assertNever` when arms have
 * side effects or return different types.
 *
 * @example
 * ```ts
 * type Tier = "personal" | "workspace" | "enterprise" | "sovereign";
 *
 * const label = match(tier, {
 *   personal:   () => "Personal",
 *   workspace:  () => "Workspace",
 *   enterprise: () => "Enterprise",
 *   sovereign:  () => "Sovereign",
 * });
 * ```
 */
export function match<K extends string, R>(
  value: K,
  cases: Record<K, () => R>,
): R {
  const handler = cases[value];
  if (typeof handler !== "function") {
    throw new ExhaustivenessError(
      `match() received unknown variant ${safeStringify(value)}`,
      value,
    );
  }
  return handler();
}

/**
 * Best-effort stringifier for values that may not be representable as JSON
 * (symbols, bigints, circular references). Used inside thrown messages so
 * they never fail to render.
 *
 * @internal
 */
function safeStringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "number" || t === "boolean") return String(value);
  if (t === "bigint") return `${String(value)}n`;
  if (t === "symbol") return (value as symbol).toString();
  if (t === "function") return "[Function]";
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unrepresentable]";
    }
  }
}
