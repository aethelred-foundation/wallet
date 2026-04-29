/**
 * `AllowanceCacheMetricsRecorder` — pluggable telemetry interface
 * for the v3 venue's allowance-cache lookups.
 *
 * Three events the venue emits per cache lookup, matching the
 * three branches in `readAllowanceCache`:
 *
 *   1. **Hit** — cached entry exists AND its `recordedAt` is
 *      within `allowanceCacheTtlMs` of `now()`. The pre-flight
 *      `eth_call` is skipped; this is the optimization win the
 *      cache exists for.
 *
 *   2. **Miss** — no cached entry (cache backend's `get(...)`
 *      returned null OR threw). The venue falls through to a
 *      fresh `eth_call`.
 *
 *   3. **Stale** — cached entry exists BUT its `recordedAt` is
 *      older than `allowanceCacheTtlMs`. Treated as miss for
 *      correctness, but distinguished in metrics so operators
 *      can tell "TTL too short" (high stale rate, cache populated
 *      but expiring too fast) apart from "cache not populating"
 *      (high miss rate, `set()` may be failing or
 *      `skipApproveWhenSufficient` not enabled on agents).
 *
 * **No events when caching is disabled.** When
 * `allowanceCacheTtlMs` is undefined or zero, the cache is bypassed
 * entirely and no events are emitted. Operators who want to
 * count "lookups attempted vs satisfied" should add their own
 * outer counter at the call site.
 *
 * **Interface design rationale.** The v3 venue keeps a zero-runtime-
 * dep posture (hand-rolled ABI, no observability dep). Defining a
 * tiny 3-method interface here lets operators bridge to their meter
 * implementation (`@aethelred/wallet-observability`,
 * OpenTelemetry SDK, prom-client, etc.) without coupling the venue
 * package itself to any of them.
 *
 * @example Wiring to `@aethelred/wallet-observability`
 *
 * ```ts
 * import { InMemoryMeter } from "@aethelred/wallet-observability";
 *
 * const meter = new InMemoryMeter();
 * const hits = meter.counter(
 *   "aethelred_v3_allowance_cache_hits_total",
 *   "v3 venue allowance-cache lookups satisfied by a fresh entry",
 * );
 * const misses = meter.counter(
 *   "aethelred_v3_allowance_cache_misses_total",
 *   "v3 venue allowance-cache lookups that found nothing",
 * );
 * const stales = meter.counter(
 *   "aethelred_v3_allowance_cache_stales_total",
 *   "v3 venue allowance-cache lookups that found an expired entry",
 * );
 * const labels = { chain_id: "8453" };
 *
 * const recorder: AllowanceCacheMetricsRecorder = {
 *   recordHit: () => hits.add(1, labels),
 *   recordMiss: () => misses.add(1, labels),
 *   recordStale: () => stales.add(1, labels),
 * };
 *
 * const venue = new UniswapV3SwapVenue({
 *   ...,
 *   skipApproveWhenSufficient: true,
 *   allowanceCacheTtlMs: 300_000,
 *   allowanceCacheMetrics: recorder,
 * });
 * ```
 *
 * Operators wanting per-(owner,asset) breakdowns extend the
 * `labels` object inside their adapter — the venue passes nothing
 * extra, so the dimensionality is fully under operator control
 * (avoids accidental high-cardinality blowups).
 */
export interface AllowanceCacheMetricsRecorder {
  /**
   * Cache lookup found a non-stale entry; the eth_call to
   * `allowance(owner, spender)` is being skipped.
   */
  recordHit(): void;

  /**
   * Cache lookup found nothing — either the backend has no entry
   * or the backend's `get(...)` threw and the venue treated it as
   * miss (fail-closed). The venue falls through to a fresh
   * `eth_call`.
   */
  recordMiss(): void;

  /**
   * Cache lookup found an entry but it was older than the venue's
   * configured `allowanceCacheTtlMs`. Treated as miss for
   * correctness; counted separately so operators can distinguish
   * "TTL too short" from "cache not populating."
   */
  recordStale(): void;
}

/**
 * Default `AllowanceCacheMetricsRecorder` — a no-op. The venue
 * uses this when no recorder is configured so the cache code has
 * no `if (recorder)` branches at every call site.
 *
 * Methods are inlinable; the overhead of "call a no-op method"
 * is one V8 IC slot vs. one branch + property access. Either way,
 * negligible compared to the eth_call we're saving.
 */
export const NOOP_ALLOWANCE_CACHE_METRICS_RECORDER: AllowanceCacheMetricsRecorder =
  Object.freeze({
    recordHit() {},
    recordMiss() {},
    recordStale() {},
  });
