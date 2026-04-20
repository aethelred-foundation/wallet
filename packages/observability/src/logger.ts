/**
 * Structured, machine-readable logging for the Aethelred Wallet.
 *
 * Design goals:
 *   - Every log line is a `LogRecord` with a required `code` — no free-form
 *     grep-heavy strings leak into SRE dashboards.
 *   - Sinks are pluggable: console (dev), chrome.storage ring buffer
 *     (post-mortem), or any user-supplied transport.
 *   - Zero-allocation fast path when a log is below `minLevel`: we skip
 *     even constructing the attribute object.
 *   - Child loggers (`withContext`, `withCorrelation`) never mutate their
 *     parent. Context merges top-down and the resulting child is a
 *     lightweight wrapper that reuses the parent's sinks.
 *   - No PII. `code` is machine-readable; free-form `message` is for humans
 *     and MUST NOT contain secrets or user identifiers. Attribute keys are
 *     designed around stable labels (chainId, method, origin), never raw
 *     addresses or amounts.
 *
 * @example
 * ```ts
 * const logger = new Logger({
 *   component: "background",
 *   sinks: [CONSOLE_SINK],
 *   minLevel: "info",
 * });
 * logger.info("boot.ready", "Background service worker ready.", { version: "0.9.0" });
 *
 * const scoped = logger.withCorrelation("req-abc123");
 * scoped.warn("rpc.request.retry", "Retrying RPC call.", { attempt: 2, method: "eth_call" });
 * ```
 */

/** Severity, in ascending order of importance. */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0,
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

/**
 * A fully-formed log record, ready for a sink.
 *
 * Records are JSON-serializable — `attributes` is flat and primitive-only,
 * and `error` is normalized (never a raw `Error` reference). This keeps
 * the on-wire shape compatible with OTLP LogRecord and most SaaS log
 * ingest formats.
 */
export interface LogRecord {
  level: LogLevel;
  /** Milliseconds since Unix epoch. */
  timestamp: number;
  /** Free-form human-readable description. SHOULD NOT contain PII. */
  message: string;
  /** Stable machine-readable code, e.g. `"rpc.request.failed"`. REQUIRED. */
  code: string;
  /** The component that emitted the log (e.g. `"background"`, `"rpc-client"`). */
  component: string;
  /** Correlation identifier, typically set per user action / request. */
  correlationId?: string;
  /** W3C TraceContext trace id, if emitted inside an active span. */
  traceId?: string;
  /** W3C TraceContext span id, if emitted inside an active span. */
  spanId?: string;
  /** Flat key/value attributes. Values are JSON primitives. */
  attributes: Record<string, string | number | boolean | null>;
  /** Normalized error payload when `level` is `"error"` or `"fatal"`. */
  error?: {
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
}

/**
 * A transport that consumes log records. Sinks MUST NOT throw — they should
 * swallow transport errors (and optionally re-emit on a dead-letter sink) to
 * protect the critical path from being derailed by a broken logger.
 */
export interface LogSink {
  write(record: LogRecord): void;
  /** Optional: flush buffered records. */
  flush?(): Promise<void>;
}

/**
 * Logger construction options.
 */
export interface LoggerConfig {
  /** Component name emitted on every record. */
  component: string;
  /** At least one sink. Zero sinks is allowed but makes the logger a no-op. */
  sinks: LogSink[];
  /** Minimum severity to deliver. Defaults to `"info"`. */
  minLevel?: LogLevel;
  /** Base context merged into every child logger. */
  context?: Record<string, string | number | boolean>;
  /** Correlation id applied to every record. */
  correlationId?: string;
  /** Current trace/span ids (usually injected by the tracer). */
  traceId?: string;
  spanId?: string;
}

/**
 * Primary logger entry point. Create once per component and derive scoped
 * children with `withContext` / `withCorrelation`.
 *
 * @example
 * ```ts
 * const log = new Logger({ component: "rpc-client", sinks: [CONSOLE_SINK] });
 * const scoped = log.withContext({ chainId: "0x1" });
 * scoped.error("rpc.request.failed", "RPC call failed", {
 *   method: "eth_call",
 *   error: new Error("timeout"),
 * });
 * ```
 */
export class Logger {
  private readonly component: string;
  private readonly sinks: LogSink[];
  private readonly minLevelValue: number;
  private readonly minLevel: LogLevel;
  private readonly context: Record<string, string | number | boolean>;
  private readonly correlationId?: string;
  private readonly traceId?: string;
  private readonly spanId?: string;

  constructor(config: LoggerConfig) {
    this.component = config.component;
    this.sinks = config.sinks;
    this.minLevel = config.minLevel ?? "info";
    this.minLevelValue = LEVEL_ORDER[this.minLevel];
    this.context = { ...(config.context ?? {}) };
    this.correlationId = config.correlationId;
    this.traceId = config.traceId;
    this.spanId = config.spanId;
  }

  /**
   * Derive a child logger with additional context attributes. The child
   * shares the parent's sinks and configuration; the parent is never
   * mutated.
   */
  withContext(ctx: Record<string, string | number | boolean>): Logger {
    return new Logger({
      component: this.component,
      sinks: this.sinks,
      minLevel: this.minLevel,
      context: { ...this.context, ...ctx },
      correlationId: this.correlationId,
      traceId: this.traceId,
      spanId: this.spanId,
    });
  }

  /**
   * Derive a child logger pinned to a correlation id. Typical usage: one
   * correlation id per user-initiated request, propagated through every
   * message and every RPC.
   */
  withCorrelation(id: string): Logger {
    return new Logger({
      component: this.component,
      sinks: this.sinks,
      minLevel: this.minLevel,
      context: this.context,
      correlationId: id,
      traceId: this.traceId,
      spanId: this.spanId,
    });
  }

  /**
   * Derive a child logger bound to an active span (populates traceId /
   * spanId on every record).
   */
  withSpan(traceId: string, spanId: string): Logger {
    return new Logger({
      component: this.component,
      sinks: this.sinks,
      minLevel: this.minLevel,
      context: this.context,
      correlationId: this.correlationId,
      traceId,
      spanId,
    });
  }

  trace(code: string, message: string, attrs?: Record<string, unknown>): void {
    this.emit("trace", code, message, attrs);
  }

  debug(code: string, message: string, attrs?: Record<string, unknown>): void {
    this.emit("debug", code, message, attrs);
  }

  info(code: string, message: string, attrs?: Record<string, unknown>): void {
    this.emit("info", code, message, attrs);
  }

  warn(code: string, message: string, attrs?: Record<string, unknown>): void {
    this.emit("warn", code, message, attrs);
  }

  error(
    code: string,
    message: string,
    attrs?: Record<string, unknown> & { error?: unknown }
  ): void {
    this.emit("error", code, message, attrs);
  }

  fatal(
    code: string,
    message: string,
    attrs?: Record<string, unknown> & { error?: unknown }
  ): void {
    this.emit("fatal", code, message, attrs);
  }

  /**
   * Flush all sinks that support flushing. Awaits each one; swallows errors
   * so one broken sink cannot block shutdown.
   */
  async flush(): Promise<void> {
    await Promise.all(
      this.sinks.map(async (sink) => {
        if (!sink.flush) return;
        try {
          await sink.flush();
        } catch {
          // Sinks must not throw; we ignore.
        }
      })
    );
  }

  private emit(
    level: LogLevel,
    code: string,
    message: string,
    attrs?: Record<string, unknown>
  ): void {
    // Zero-allocation fast path: below threshold, do nothing. We avoid even
    // touching `attrs` so callers can build them inline without cost.
    if (LEVEL_ORDER[level] < this.minLevelValue) return;
    if (this.sinks.length === 0) return;

    const flat = flattenAttributes(this.context, attrs);
    const record: LogRecord = {
      level,
      timestamp: Date.now(),
      message,
      code,
      component: this.component,
      attributes: flat.attributes,
    };
    if (this.correlationId) record.correlationId = this.correlationId;
    if (this.traceId) record.traceId = this.traceId;
    if (this.spanId) record.spanId = this.spanId;
    if (flat.error) record.error = flat.error;

    for (const sink of this.sinks) {
      try {
        sink.write(record);
      } catch {
        // Sinks must not throw; a broken sink cannot break the caller.
      }
    }
  }
}

/**
 * Merge base context with caller attributes, coercing anything non-primitive
 * to a string and extracting a normalized error payload if one is present.
 */
function flattenAttributes(
  base: Record<string, string | number | boolean>,
  raw?: Record<string, unknown>
): {
  attributes: Record<string, string | number | boolean | null>;
  error?: LogRecord["error"];
} {
  const out: Record<string, string | number | boolean | null> = { ...base };
  let error: LogRecord["error"] | undefined;
  if (!raw) return { attributes: out };

  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (key === "error" && value !== undefined) {
      error = normalizeError(value);
      continue;
    }
    out[key] = primitive(value);
  }
  return { attributes: out, error };
}

function primitive(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return v;
  }
  // Defensive: never leak an Error into attributes (stack is large + can
  // contain file paths). Anything non-primitive becomes a short string.
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function normalizeError(value: unknown): LogRecord["error"] {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: (value as { cause?: unknown }).cause,
    };
  }
  if (typeof value === "object" && value !== null) {
    const v = value as { name?: unknown; message?: unknown; stack?: unknown; cause?: unknown };
    return {
      name: typeof v.name === "string" ? v.name : "Error",
      message: typeof v.message === "string" ? v.message : JSON.stringify(v),
      stack: typeof v.stack === "string" ? v.stack : undefined,
      cause: v.cause,
    };
  }
  return { name: "Error", message: String(value) };
}

/**
 * Sink that writes to `console.{trace,debug,info,warn,error}`. Safe for the
 * extension service worker and for Node tests; never throws.
 *
 * @example
 * ```ts
 * const log = new Logger({ component: "popup", sinks: [CONSOLE_SINK] });
 * ```
 */
export const CONSOLE_SINK: LogSink = {
  write(record: LogRecord): void {
    const prefix = `[${record.component}] ${record.code}`;
    const payload = {
      attributes: record.attributes,
      correlationId: record.correlationId,
      traceId: record.traceId,
      spanId: record.spanId,
      error: record.error,
    };
    switch (record.level) {
      case "trace":
        // eslint-disable-next-line no-console
        console.debug(prefix, record.message, payload);
        return;
      case "debug":
        // eslint-disable-next-line no-console
        console.debug(prefix, record.message, payload);
        return;
      case "info":
        // eslint-disable-next-line no-console
        console.info(prefix, record.message, payload);
        return;
      case "warn":
        // eslint-disable-next-line no-console
        console.warn(prefix, record.message, payload);
        return;
      case "error":
      case "fatal":
        // eslint-disable-next-line no-console
        console.error(prefix, record.message, payload);
        return;
    }
  },
};

/**
 * A buffering sink that batches records and forwards to an inner sink on a
 * timer or when a size threshold is hit. Useful for network-bound sinks
 * (HTTP forwarders, OTLP exporters) where per-record POSTs would be wasteful.
 *
 * The buffer is bounded: when capacity is exceeded, the oldest records are
 * dropped (and a telemetry counter is incremented if one is attached).
 *
 * @example
 * ```ts
 * const buf = new BufferedSink({
 *   inner: CONSOLE_SINK,
 *   flushIntervalMs: 2000,
 *   maxBuffered: 500,
 * });
 * buf.start();
 * ```
 */
export class BufferedSink implements LogSink {
  private readonly inner: LogSink;
  private readonly flushIntervalMs: number;
  private readonly maxBuffered: number;
  private readonly buffer: LogRecord[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private droppedCount = 0;

  constructor(opts: { inner: LogSink; flushIntervalMs?: number; maxBuffered?: number }) {
    this.inner = opts.inner;
    this.flushIntervalMs = opts.flushIntervalMs ?? 2000;
    this.maxBuffered = opts.maxBuffered ?? 1000;
  }

  /** Start the flush interval. Safe to call multiple times. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.flush().catch(() => {});
    }, this.flushIntervalMs);
  }

  /** Stop the flush interval. Any buffered records remain in memory. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  write(record: LogRecord): void {
    if (this.buffer.length >= this.maxBuffered) {
      this.buffer.shift();
      this.droppedCount += 1;
    }
    this.buffer.push(record);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const records = this.buffer.splice(0, this.buffer.length);
    for (const record of records) {
      try {
        this.inner.write(record);
      } catch {
        // inner sink must not break the flush loop
      }
    }
    if (this.inner.flush) {
      try {
        await this.inner.flush();
      } catch {
        // inner flush must not break us either
      }
    }
  }

  /** Number of records dropped due to buffer overflow. */
  getDroppedCount(): number {
    return this.droppedCount;
  }

  /** Current in-memory buffer depth. Useful for SRE dashboards. */
  size(): number {
    return this.buffer.length;
  }
}

/**
 * Minimal shape of the `chrome.storage.local` API we actually use. Defined
 * here so the sink compiles in pure-Node test environments without pulling
 * `@types/chrome`.
 */
export interface ChromeStorageLike {
  get(key: string, callback: (items: Record<string, unknown>) => void): void;
  set(items: Record<string, unknown>, callback?: () => void): void;
}

/**
 * Persists a bounded ring buffer of log records into chrome.storage.local
 * (or any compatible key/value store). Used for post-mortem review in the
 * extension — "what happened in the 200 messages before the crash?"
 *
 * @example
 * ```ts
 * const sink = new ChromeStorageSink({
 *   storage: chrome.storage.local,
 *   key: "aethelred:logs",
 *   capacity: 500,
 * });
 * ```
 */
export class ChromeStorageSink implements LogSink {
  private readonly storage: ChromeStorageLike;
  private readonly key: string;
  private readonly capacity: number;
  private readonly pending: LogRecord[] = [];
  private flushing = false;

  constructor(opts: { storage: ChromeStorageLike; key: string; capacity?: number }) {
    this.storage = opts.storage;
    this.key = opts.key;
    this.capacity = opts.capacity ?? 500;
  }

  write(record: LogRecord): void {
    this.pending.push(record);
    // Coalesce writes — we don't block the caller on storage latency.
    if (!this.flushing) {
      this.flushing = true;
      queueMicrotask(() => {
        void this.flush().finally(() => {
          this.flushing = false;
        });
      });
    }
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0, this.pending.length);
    await new Promise<void>((resolve) => {
      try {
        this.storage.get(this.key, (items) => {
          const existing = Array.isArray(items[this.key])
            ? (items[this.key] as LogRecord[])
            : [];
          const merged = existing.concat(batch);
          const trimmed =
            merged.length > this.capacity ? merged.slice(merged.length - this.capacity) : merged;
          this.storage.set({ [this.key]: trimmed }, () => resolve());
        });
      } catch {
        resolve();
      }
    });
  }
}
