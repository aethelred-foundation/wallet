# Changelog

All notable changes to `@aethelred/wallet-observability` land here. Entries
follow Keep a Changelog; the package is internal to the monorepo and
versions with the wallet release train.

## 0.1.0 — 2026-04-19

Initial release.

### Added

- `Logger` with pluggable sinks (`CONSOLE_SINK`, `BufferedSink`,
  `ChromeStorageSink`) and `withContext` / `withCorrelation` / `withSpan`
  child loggers.
- `BasicTracer`, `Span`, `BatchSpanProcessor`, `NoopSpanProcessor` tracing
  primitives with W3C TraceContext (`parseTraceparent`,
  `formatTraceparent`).
- `NoopSpanExporter`, `ConsoleSpanExporter`, `OtlpHttpSpanExporter`
  exporters. OTLP/JSON payload compliant with the OpenTelemetry spec.
- `InMemoryMeter` with `Counter`, `Gauge`, `Histogram`. Output in OTLP/JSON
  and Prometheus text exposition formats.
- `AethelredError` class + `ErrorCategory` taxonomy + `ErrorRecoveryHint`.
- `ERROR_CODES` catalog — 80+ stable codes across rpc, signer, policy,
  audit, workflow, credential, network, storage, webauthn, tx, dapp,
  identity, simulation domains.
- `PerformanceBudget.measure`, `recordLatency`, and a canonical `SLO_CATALOG`.
- 39 unit tests covering all primitives + OTLP serialization.

### Wired

- `packages/chain/src/rpc-client.ts` — every JSON-RPC call now runs
  inside a `tracer.withSpan("rpc.request", ...)` and emits a structured
  log with the appropriate error code on failure.
- `packages/audit/src/event-capture.ts` — every recorded event emits an
  info-level log (`audit.event.recorded`) once `setLogger` is called.
- `apps/extension/src/background.ts` — root `Logger` + `BasicTracer`
  instantiated at service-worker boot. The boot log line uses a generated
  trace id as correlation id.
