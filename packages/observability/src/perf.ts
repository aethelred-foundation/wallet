/**
 * Performance instrumentation primitives + SLO catalog.
 *
 * `PerformanceBudget` wraps any sync or async function and reports whether
 * the execution landed inside the budget. The intent is to bolt SLO
 * enforcement directly onto hot paths — if a critical step regresses, the
 * budget fails locally during tests long before it hits production.
 *
 * `recordLatency` is the one-liner helper that pairs with `Meter.histogram`
 * — call it once at the start of a unit of work and the returned `end()`
 * closure records the elapsed time when invoked.
 *
 * @example
 * ```ts
 * import { PerformanceBudget, SLO_CATALOG } from "@aethelred/wallet-observability";
 *
 * const budget = new PerformanceBudget("popup.cold_start", SLO_CATALOG.popup_cold_start.budgetMs);
 * const { result, tookMs, withinBudget } = await budget.measure(() => renderPopup());
 * if (!withinBudget) logger.warn("slo.popup.cold_start.exceeded", "Cold start too slow", { tookMs });
 * ```
 */

import type { Meter } from "./metrics";

/**
 * Named SLO entry. `budgetMs` is the target (conventionally p95); `window`
 * describes what the budget applies to.
 */
export interface Slo {
  /** Stable machine-readable name — used as a metric label. */
  name: string;
  /** Performance budget in milliseconds at p95. */
  budgetMs: number;
  /** Description of what the SLO measures. */
  description: string;
  /** Rolling window over which p95 is computed. */
  window: "1m" | "5m" | "1h" | "24h";
}

/**
 * Canonical SLO catalog for the wallet. These targets match the operational
 * ceiling we advertise to enterprise customers.
 *
 * @example
 * ```ts
 * const slo = SLO_CATALOG.rpc_request;
 * logger.info("slo.config", "Loaded SLO", { name: slo.name, budgetMs: slo.budgetMs });
 * ```
 */
export const SLO_CATALOG: Record<string, Slo> = {
  popup_cold_start: {
    name: "popup.cold_start",
    budgetMs: 800,
    description: "Time from user click on browser action to popup first paint.",
    window: "5m",
  },
  rpc_request: {
    name: "rpc.request",
    budgetMs: 2000,
    description: "Round-trip time for a single JSON-RPC request (incl. retries).",
    window: "5m",
  },
  signer_sign: {
    name: "signer.sign",
    budgetMs: 500,
    description: "Time to produce a signature, EXCLUDING biometric/user wait.",
    window: "5m",
  },
  audit_record: {
    name: "audit.record",
    budgetMs: 5,
    description: "Time to hash and persist one audit event.",
    window: "1m",
  },
  merkle_finalize_batch: {
    name: "merkle.finalize_batch",
    budgetMs: 50,
    description: "Time to finalize a merkle batch (hash all leaves + root).",
    window: "5m",
  },
  policy_evaluate: {
    name: "policy.evaluate",
    budgetMs: 20,
    description: "Time to evaluate a policy bundle against a request.",
    window: "5m",
  },
  workflow_step: {
    name: "workflow.step",
    budgetMs: 100,
    description: "Time to advance an approval workflow by one step.",
    window: "5m",
  },
  simulation_run: {
    name: "simulation.run",
    budgetMs: 1500,
    description: "Time to simulate a transaction via RPC.",
    window: "5m",
  },
} as const;

/**
 * Result of a single PerformanceBudget.measure call.
 */
export interface MeasureResult<T> {
  /** The function's return value. */
  result: T;
  /** Wall-clock duration in milliseconds. */
  tookMs: number;
  /** True when `tookMs <= budgetMs`. */
  withinBudget: boolean;
}

/**
 * Wraps a function in a performance budget check. Use this in tests to
 * prevent regressions on hot paths.
 *
 * @example
 * ```ts
 * const budget = new PerformanceBudget("audit.record", 5);
 * const { tookMs, withinBudget } = await budget.measure(() => capture.record({ ... }));
 * expect(withinBudget).toBe(true);
 * ```
 */
export class PerformanceBudget {
  readonly name: string;
  readonly budgetMs: number;

  constructor(name: string, budgetMs: number) {
    this.name = name;
    this.budgetMs = budgetMs;
  }

  async measure<T>(fn: () => T | Promise<T>): Promise<MeasureResult<T>> {
    const start = now();
    const result = await fn();
    const tookMs = now() - start;
    return { result, tookMs, withinBudget: tookMs <= this.budgetMs };
  }
}

/**
 * Start a latency measurement. Returns a closure that, when called, records
 * the elapsed time into the given histogram.
 *
 * @example
 * ```ts
 * const latency = meter.histogram("rpc.latency", "RPC latency", "ms");
 * const end = recordLatency(meter, "rpc.latency", { method: "eth_call" });
 * try {
 *   return await rpcCall();
 * } finally {
 *   end();
 * }
 * ```
 */
export function recordLatency(
  meter: Meter,
  name: string,
  labels?: Record<string, string>
): { end(): number } {
  const start = now();
  const histogram = meter.histogram(name);
  return {
    end(): number {
      const ms = now() - start;
      histogram.record(ms, labels);
      return ms;
    },
  };
}

/**
 * High-resolution monotonic clock reading. Falls back to Date.now() when
 * `performance.now` isn't available (e.g. old Node or test harness).
 */
function now(): number {
  if (typeof globalThis !== "undefined") {
    const perf = (globalThis as { performance?: { now?: () => number } }).performance;
    if (perf && typeof perf.now === "function") return perf.now();
  }
  return Date.now();
}
