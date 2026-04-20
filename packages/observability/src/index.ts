/**
 * @aethelred/wallet-observability — zero-dependency observability primitives
 * for the Aethelred Wallet.
 *
 * Bundles structured logging, W3C TraceContext-compliant tracing, metrics,
 * an error taxonomy, and a canonical SLO catalog. Ships with no runtime
 * dependencies so it can be pulled into the extension service worker, the
 * popup, or the native apps without bloating the critical path.
 *
 * See the package README for module-by-module usage notes.
 */

export {
  CONSOLE_SINK,
  BufferedSink,
  ChromeStorageSink,
  Logger,
  type ChromeStorageLike,
  type LogLevel,
  type LogRecord,
  type LogSink,
  type LoggerConfig,
} from "./logger";

export {
  BasicTracer,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  NoopSpanExporter,
  NoopSpanProcessor,
  OtlpHttpSpanExporter,
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
  type Span,
  type SpanExporter,
  type SpanKind,
  type SpanProcessor,
  type SpanStatus,
  type StartSpanOptions,
  type TraceContext,
  type Tracer,
} from "./tracing";

export {
  DEFAULT_LATENCY_BUCKETS,
  InMemoryMeter,
  OtlpMetricsExporter,
  type Counter,
  type Gauge,
  type Histogram,
  type HistogramSnapshot,
  type Meter,
} from "./metrics";

export {
  AethelredError,
  type AethelredErrorOptions,
  type ErrorCategory,
  type ErrorRecoveryHint,
} from "./errors";

export {
  ALL_ERROR_CODES,
  AUDIT_ERROR_CODES,
  CREDENTIAL_ERROR_CODES,
  DAPP_ERROR_CODES,
  ERROR_CODES,
  IDENTITY_ERROR_CODES,
  NETWORK_ERROR_CODES,
  POLICY_ERROR_CODES,
  RPC_ERROR_CODES,
  SIGNER_ERROR_CODES,
  SIMULATION_ERROR_CODES,
  STORAGE_ERROR_CODES,
  TX_ERROR_CODES,
  WEBAUTHN_ERROR_CODES,
  WORKFLOW_ERROR_CODES,
  domainOf,
  isRegisteredErrorCode,
} from "./error-codes";

export {
  PerformanceBudget,
  SLO_CATALOG,
  recordLatency,
  type MeasureResult,
  type Slo,
} from "./perf";

export { ExhaustivenessError, assertNever, match, warnNever } from "./never";
