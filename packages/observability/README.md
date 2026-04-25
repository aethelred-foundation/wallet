# @aethelred/wallet-observability

Zero-dependency observability primitives for the Aethelred Wallet. Ships as
a workspace-internal package that the extension service worker, the popup,
and the native apps can adopt without pulling the OpenTelemetry SDK into
the critical path.

Every primitive is designed to be OpenTelemetry-compatible on the wire
(OTLP/JSON, W3C TraceContext, Prometheus text) while staying small enough
for an MV3 extension bundle.

## What this package provides

| Module | What it does |
| --- | --- |
| `logger.ts` | Structured logging with stable machine codes, child loggers, pluggable sinks (console / buffered / chrome.storage ring buffer). |
| `tracing.ts` | Span / Tracer / SpanExporter primitives. W3C TraceContext helpers. Batch processor. Console + OTLP/HTTP exporters. |
| `metrics.ts` | Counter / Gauge / Histogram. Prometheus + OTLP/JSON serialization. |
| `solver-gas-histogram.ts` | `SolverGasHistogram` — per-solver gas distributions consuming intent-router `Fill` events. Bounded ring-buffer windows; exact nearest-rank percentiles (`p50` / `p95` / `p99` / mean / min / max / cumulative cost). |
| `errors.ts` | `AethelredError` class with category taxonomy + recovery hints. |
| `error-codes.ts` | Canonical catalog of every error code the wallet emits. |
| `perf.ts` | `PerformanceBudget`, `recordLatency` helper, and the SLO catalog. |

## Usage patterns

### Logging

```ts
import { Logger, CONSOLE_SINK } from "@aethelred/wallet-observability";

const logger = new Logger({
  component: "background",
  sinks: [CONSOLE_SINK],
  minLevel: "info",
});

logger.info("boot.ready", "Background initialized", { version: "0.9.0" });

const scoped = logger.withCorrelation("req-abc");
scoped.warn("rpc.request.retry", "Retrying RPC", { attempt: 2 });
```

Every record carries a `code` — the free-form `message` is for humans only.
Use `ERROR_CODES.*` paths for the code; never hand-type them.

### Tracing

```ts
import { BasicTracer, ConsoleSpanExporter } from "@aethelred/wallet-observability";

const tracer = new BasicTracer({
  exporter: new ConsoleSpanExporter(),
  resource: { "service.name": "wallet-extension" },
});

await tracer.withSpan("rpc.request", async (span) => {
  span.setAttribute("rpc.method", "eth_call");
  return await rpcCall();
}, { kind: "client" });
```

`withSpan` auto-ends on return, captures exceptions as span events, and
sets `status = "error"` on throw.

### Metrics

```ts
import { InMemoryMeter, DEFAULT_LATENCY_BUCKETS } from "@aethelred/wallet-observability";

const meter = new InMemoryMeter();
const counter = meter.counter("tx.broadcast", "Transactions broadcast", "1");
counter.add(1, { chain_id: "0x1", outcome: "success" });

const histogram = meter.histogram(
  "rpc.latency",
  "RPC latency",
  "ms",
  DEFAULT_LATENCY_BUCKETS,
);
histogram.record(42, { method: "eth_call" });

console.log(meter.toPrometheus());
```

### Errors

```ts
import { AethelredError, ERROR_CODES } from "@aethelred/wallet-observability";

throw new AethelredError({
  code: ERROR_CODES.policy.SPEND_LIMIT_EXCEEDED,
  category: "policy-rejected",
  message: "Transfer exceeds workspace spend cap",
  hint: {
    userMessage: "This exceeds the workspace spend limit.",
    developerMessage: "policy.limits.daily_spend_cents exceeded",
    retryable: false,
    escalateToSupport: true,
  },
});
```

`AethelredError.toLogRecord()` and `.toPublicJson()` ensure the error can
cross logger sinks and bridge boundaries safely.

### Performance budgets

```ts
import { PerformanceBudget, SLO_CATALOG } from "@aethelred/wallet-observability";

const budget = new PerformanceBudget(
  SLO_CATALOG.audit_record.name,
  SLO_CATALOG.audit_record.budgetMs,
);

const { tookMs, withinBudget } = await budget.measure(() => capture.record({ ... }));
if (!withinBudget) logger.warn("slo.audit.record.exceeded", "audit.record SLO burn", { tookMs });
```

### Per-solver gas histogram

```ts
import {
  SolverGasHistogram,
  fillToGasSample,
} from "@aethelred/wallet-observability";

const histogram = new SolverGasHistogram({ windowSize: 1024 });

// Wire into the intent-router's audit stream — every fulfilled
// intent feeds in. The `fillToGasSample` helper extracts the
// `gasUsed` + `gasCostWei` fields PR #80 lifted into Fill.metadata
// for transfer-solver and swap-solver; x402 fills (where the
// facilitator pays gas) return `null` and are skipped.
router.on("settlement-succeeded", ({ fill }) => {
  const sample = fillToGasSample(fill);
  if (sample) histogram.record(sample);
});

// Read at SLO-eval cadence (e.g. every 30s):
for (const [solverId, stats] of histogram.snapshots()) {
  console.log(
    `${solverId}: count=${stats.count} p50=${stats.p50} p95=${stats.p95} mean=${stats.mean}`,
  );
}
```

Window size bounds memory: a single solver's buffer is at most
`windowSize` `bigint` samples (default 1024). The cost totals
(`totalCostWei` + `costSampleCount`) are CUMULATIVE — not bound by
the window — so dashboards can chart lifetime spend honestly even
when the window has rotated past those samples.

The histogram is the cross-intent observability view that
complements PR #80's per-intent `Fill.metadata.gasUsed` signal.
The solver-trio demo (`@aethelred/wallet-integration`) renders it
under `--samples N`:

```bash
npm run demo:solvers -- --samples 10
# Per-solver gas histogram (across 10 samples × 3 kinds = 30 fills)
#   solver id              | count | min  | p50 | p95 | p99 | max | mean
#   transfer:base-mainnet  | 10    | 54k  | 60k | 66k | 66k | 66k | 60k
#   swap:stub:base-mainnet | 10    | 162k | 180k| 198k| 198k| 198k| 180k
```

## Wiring a real OTLP exporter

The package ships with stubs that keep the dev experience dependency-free.
To send to a real collector:

```ts
import {
  BasicTracer,
  BatchSpanProcessor,
  OtlpHttpSpanExporter,
} from "@aethelred/wallet-observability";

const exporter = new OtlpHttpSpanExporter({
  url: "https://collector.example.com/v1/traces",
  headers: { "x-api-key": token },
  timeoutMs: 10_000,
});

const tracer = new BasicTracer({
  processor: new BatchSpanProcessor({
    exporter,
    maxQueueSize: 1000,
    scheduledDelayMillis: 5000,
  }),
  resource: {
    "service.name": "wallet-extension",
    "service.version": "0.9.0",
  },
});
```

The OTLP/JSON payload follows the [OTLP specification](https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding)
— any OpenTelemetry Collector accepts it without additional configuration.

## W3C TraceContext

`parseTraceparent` / `formatTraceparent` handle the `traceparent` header.
Use them when the wallet posts to a backend that propagates trace context:

```ts
const header = formatTraceparent({ traceId: span.traceId, spanId: span.spanId, flags: 1 });
fetch(url, { headers: { traceparent: header } });
```

## SLO catalog

| Name | p95 target | What it measures |
| --- | --- | --- |
| `popup.cold_start` | 800 ms | Popup paint after browser-action click. |
| `rpc.request` | 2000 ms | JSON-RPC round-trip (includes retry). |
| `signer.sign` | 500 ms | Pure signing time (biometric wait excluded). |
| `audit.record` | 5 ms | Hash + persist one audit event. |
| `merkle.finalize_batch` | 50 ms | Finalize a merkle batch. |
| `policy.evaluate` | 20 ms | Evaluate policy bundle against one request. |
| `workflow.step` | 100 ms | Advance approval workflow by one step. |
| `simulation.run` | 1500 ms | Simulate a tx via RPC. |

## Discipline

- **Every log has a stable `code`** from `ERROR_CODES` or a domain-scoped
  sibling. No grep-dependent free-form strings.
- **No PII**, ever. Attribute keys are stable labels (`chainId`, `method`,
  `outcome`) — never raw addresses, amounts, or user identifiers.
- **Sinks never throw**; a broken sink must never break the caller.
- **Respect `minLevel`** on the zero-allocation fast path — below-threshold
  logs are dropped before attribute objects are built.
- **Child loggers never mutate parents**. `withContext` / `withCorrelation`
  / `withSpan` return new instances.

## Implementation notes

- Zero runtime dependencies. The only imports inside `src/` are from the
  standard library (`crypto.getRandomValues`, `AbortController`).
- Compiles cleanly against the repo's strict TypeScript settings
  (`strict`, `noUnusedLocals`, `noUnusedParameters`).
- Built for `ES2022` to match the rest of the monorepo.
