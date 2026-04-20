/**
 * OpenTelemetry-compatible tracing primitives with ZERO SDK dependencies.
 *
 * We implement the shape (Span / Tracer / SpanExporter / SpanProcessor) but
 * don't import `@opentelemetry/*`. This keeps the critical-path bundle
 * small while letting downstream consumers plug a real OTLP exporter if
 * they want richer backends.
 *
 * W3C TraceContext compliance: trace ids are 32 hex chars, span ids 16.
 * `traceparent` / `tracestate` serialization follows RFC-style headers so
 * this can propagate across HTTP to any OTel collector.
 *
 * @example
 * ```ts
 * const tracer = new BasicTracer({
 *   exporter: new ConsoleSpanExporter(),
 *   resource: { "service.name": "wallet-extension" },
 * });
 *
 * await tracer.withSpan("rpc.request", async (span) => {
 *   span.setAttribute("rpc.method", "eth_call");
 *   return await rpcCall();
 * });
 * ```
 */

/** Span kind mirrors OTel semantics. */
export type SpanKind = "internal" | "client" | "server" | "producer" | "consumer";

/** Span status mirrors OTel semantics. */
export type SpanStatus = "unset" | "ok" | "error";

/**
 * A live or completed span. Mutating methods (`setAttribute`, `addEvent`,
 * `setStatus`, `end`) are no-ops after `end` is called — this matches the
 * OTel contract.
 */
export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startTime: number;
  readonly endTime?: number;
  readonly status: SpanStatus;
  readonly statusDescription?: string;
  readonly attributes: Record<string, string | number | boolean>;
  readonly events: Array<{ name: string; time: number; attributes: Record<string, unknown> }>;
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: "ok" | "error", description?: string): void;
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  end(): void;
  /** W3C traceparent header value for cross-process propagation. */
  toTraceparent(): string;
}

/**
 * Options accepted by Tracer.startSpan and Tracer.withSpan.
 */
export interface StartSpanOptions {
  parent?: Span | TraceContext;
  attributes?: Record<string, unknown>;
  kind?: SpanKind;
}

/**
 * A primary tracer. Exactly one should be instantiated per component.
 */
export interface Tracer {
  startSpan(name: string, options?: StartSpanOptions): Span;
  withSpan<T>(
    name: string,
    fn: (span: Span) => T | Promise<T>,
    options?: StartSpanOptions
  ): Promise<T>;
  /** Resource attributes merged into every span export (e.g. service.name). */
  getResource(): Record<string, string>;
}

/**
 * Receiver for completed spans.
 */
export interface SpanExporter {
  /** Export the provided spans. MUST NOT throw synchronously — return a rejected promise on error. */
  export(spans: Span[]): Promise<void>;
  /** Flush any pending state (e.g. HTTP in-flight) and release resources. */
  shutdown(): Promise<void>;
}

/**
 * A processor sits between the tracer and the exporter. The default
 * BatchSpanProcessor batches spans and flushes on interval or size.
 */
export interface SpanProcessor {
  onEnd(span: Span): void;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Parsed W3C TraceContext (subset we use). version is always 00 today.
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  flags: number; // 1 = sampled
}

// ─── ID generation ────────────────────────────────────────────────

const CRYPTO_GLOBAL: Crypto | undefined =
  typeof globalThis !== "undefined" && typeof globalThis.crypto !== "undefined"
    ? (globalThis.crypto as Crypto)
    : undefined;

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  if (CRYPTO_GLOBAL?.getRandomValues) {
    CRYPTO_GLOBAL.getRandomValues(buf);
  } else {
    for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < bytes; i++) out += buf[i].toString(16).padStart(2, "0");
  return out;
}

/** Generate a W3C-compliant 128-bit (32 hex chars) trace id. */
export function generateTraceId(): string {
  return randomHex(16);
}

/** Generate a W3C-compliant 64-bit (16 hex chars) span id. */
export function generateSpanId(): string {
  return randomHex(8);
}

// ─── W3C traceparent ──────────────────────────────────────────────

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * Parse a W3C traceparent header. Returns null on invalid input.
 *
 * @example
 * ```ts
 * const ctx = parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
 * if (ctx) logger.withSpan(ctx.traceId, ctx.spanId);
 * ```
 */
export function parseTraceparent(header: string): TraceContext | null {
  const match = TRACEPARENT_RE.exec(header.trim());
  if (!match) return null;
  const [, version, traceId, spanId, flagsHex] = match;
  // Version 00 is the only one we actively support; future versions MUST be
  // forwards-compatible per spec. We reject if it looks malformed.
  if (version === "ff") return null;
  if (traceId === "00000000000000000000000000000000") return null;
  if (spanId === "0000000000000000") return null;
  return { traceId, spanId, flags: parseInt(flagsHex, 16) };
}

/**
 * Serialize trace context to a W3C traceparent header value.
 *
 * @example
 * ```ts
 * const header = formatTraceparent({ traceId: span.traceId, spanId: span.spanId, flags: 1 });
 * fetch(url, { headers: { traceparent: header } });
 * ```
 */
export function formatTraceparent(ctx: TraceContext): string {
  const flagsHex = ctx.flags.toString(16).padStart(2, "0");
  return `00-${ctx.traceId}-${ctx.spanId}-${flagsHex}`;
}

// ─── Span implementation ──────────────────────────────────────────

class SpanImpl implements Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startTime: number;
  endTime?: number;
  status: SpanStatus = "unset";
  statusDescription?: string;
  readonly attributes: Record<string, string | number | boolean> = {};
  readonly events: Array<{ name: string; time: number; attributes: Record<string, unknown> }> = [];
  private ended = false;
  private readonly onEndCallback: (span: Span) => void;

  constructor(opts: {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: SpanKind;
    attributes: Record<string, string | number | boolean>;
    onEnd: (span: Span) => void;
  }) {
    this.traceId = opts.traceId;
    this.spanId = opts.spanId;
    this.parentSpanId = opts.parentSpanId;
    this.name = opts.name;
    this.kind = opts.kind;
    this.startTime = Date.now();
    this.attributes = { ...opts.attributes };
    this.onEndCallback = opts.onEnd;
  }

  setAttribute(key: string, value: string | number | boolean): void {
    if (this.ended) return;
    this.attributes[key] = value;
  }

  setStatus(status: "ok" | "error", description?: string): void {
    if (this.ended) return;
    this.status = status;
    this.statusDescription = description;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): void {
    if (this.ended) return;
    this.events.push({ name, time: Date.now(), attributes: attributes ?? {} });
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.endTime = Date.now();
    this.onEndCallback(this);
  }

  toTraceparent(): string {
    return formatTraceparent({ traceId: this.traceId, spanId: this.spanId, flags: 1 });
  }
}

// ─── Tracer implementation ────────────────────────────────────────

/**
 * Basic tracer with configurable processor + resource attributes. One per
 * component is typical (the extension background, the popup, a native app).
 *
 * @example
 * ```ts
 * const tracer = new BasicTracer({
 *   processor: new BatchSpanProcessor({ exporter: new ConsoleSpanExporter() }),
 *   resource: { "service.name": "wallet-extension", "service.version": "0.9.0" },
 * });
 * ```
 */
export class BasicTracer implements Tracer {
  private readonly processor: SpanProcessor;
  private readonly resource: Record<string, string>;

  constructor(opts: {
    processor?: SpanProcessor;
    exporter?: SpanExporter;
    resource?: Record<string, string>;
  }) {
    // Allow a plain exporter as shorthand for a default BatchSpanProcessor.
    this.processor =
      opts.processor ??
      (opts.exporter
        ? new BatchSpanProcessor({ exporter: opts.exporter })
        : new NoopSpanProcessor());
    this.resource = { ...(opts.resource ?? {}) };
  }

  startSpan(name: string, options: StartSpanOptions = {}): Span {
    const parent = options.parent;
    let traceId: string;
    let parentSpanId: string | undefined;

    if (parent && "traceId" in parent) {
      traceId = parent.traceId;
      parentSpanId = parent.spanId;
    } else {
      traceId = generateTraceId();
    }

    const spanId = generateSpanId();
    const attrs: Record<string, string | number | boolean> = {};
    if (options.attributes) {
      for (const key of Object.keys(options.attributes)) {
        const v = options.attributes[key];
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          attrs[key] = v;
        }
      }
    }

    return new SpanImpl({
      traceId,
      spanId,
      parentSpanId,
      name,
      kind: options.kind ?? "internal",
      attributes: attrs,
      onEnd: (span) => this.processor.onEnd(span),
    });
  }

  async withSpan<T>(
    name: string,
    fn: (span: Span) => T | Promise<T>,
    options?: StartSpanOptions
  ): Promise<T> {
    const span = this.startSpan(name, options);
    try {
      const result = await fn(span);
      if (span.status === "unset") span.setStatus("ok");
      return result;
    } catch (err) {
      span.setStatus("error", err instanceof Error ? err.message : String(err));
      span.addEvent("exception", {
        "exception.type": err instanceof Error ? err.name : "Error",
        "exception.message": err instanceof Error ? err.message : String(err),
        "exception.stacktrace": err instanceof Error ? err.stack : undefined,
      });
      throw err;
    } finally {
      span.end();
    }
  }

  getResource(): Record<string, string> {
    return { ...this.resource };
  }
}

// ─── Processors ───────────────────────────────────────────────────

/** Drops everything. Default when no exporter is configured. */
export class NoopSpanProcessor implements SpanProcessor {
  onEnd(): void {}
  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

/**
 * Batches ended spans and flushes on a timer or when the buffer crosses
 * maxQueueSize. This is the recommended processor for production — it
 * amortizes export cost and bounds memory.
 *
 * Defaults match what most teams actually want:
 *   - maxQueueSize: 500 spans (above this, oldest are dropped)
 *   - scheduledDelayMillis: 5000 (flush cadence)
 *
 * @example
 * ```ts
 * const proc = new BatchSpanProcessor({
 *   exporter: new OtlpHttpSpanExporter({ url: "http://collector:4318/v1/traces" }),
 *   maxQueueSize: 1000,
 *   scheduledDelayMillis: 2500,
 * });
 * ```
 */
export class BatchSpanProcessor implements SpanProcessor {
  private readonly exporter: SpanExporter;
  private readonly maxQueueSize: number;
  private readonly scheduledDelayMillis: number;
  private readonly queue: Span[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private droppedCount = 0;

  constructor(opts: {
    exporter: SpanExporter;
    maxQueueSize?: number;
    scheduledDelayMillis?: number;
    autoStart?: boolean;
  }) {
    this.exporter = opts.exporter;
    this.maxQueueSize = opts.maxQueueSize ?? 500;
    this.scheduledDelayMillis = opts.scheduledDelayMillis ?? 5000;
    if (opts.autoStart !== false) this.start();
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.forceFlush().catch(() => {});
    }, this.scheduledDelayMillis);
  }

  onEnd(span: Span): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
      this.droppedCount += 1;
    }
    this.queue.push(span);
  }

  async forceFlush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      await this.exporter.export(batch);
    } catch {
      // Drop batch on export failure; we avoid re-queueing to prevent runaway memory.
    }
  }

  async shutdown(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.forceFlush();
    await this.exporter.shutdown();
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }

  size(): number {
    return this.queue.length;
  }
}

// ─── Exporters ────────────────────────────────────────────────────

/** An exporter that discards all spans. Useful for tests and for opt-out paths. */
export class NoopSpanExporter implements SpanExporter {
  async export(_spans: Span[]): Promise<void> {}
  async shutdown(): Promise<void> {}
}

/**
 * Pretty-prints a tree of spans on the console. Handy during development
 * for eyeballing where time goes — prints indent, name, duration.
 *
 * @example
 * ```ts
 * const tracer = new BasicTracer({ exporter: new ConsoleSpanExporter() });
 * ```
 */
export class ConsoleSpanExporter implements SpanExporter {
  async export(spans: Span[]): Promise<void> {
    // Group by trace id
    const byTrace = new Map<string, Span[]>();
    for (const span of spans) {
      const list = byTrace.get(span.traceId) ?? [];
      list.push(span);
      byTrace.set(span.traceId, list);
    }
    for (const [traceId, list] of byTrace.entries()) {
      // eslint-disable-next-line no-console
      console.groupCollapsed?.(`[trace ${traceId.slice(0, 8)}] ${list.length} spans`);
      for (const span of list.sort((a, b) => a.startTime - b.startTime)) {
        const duration =
          span.endTime !== undefined ? span.endTime - span.startTime : Date.now() - span.startTime;
        // eslint-disable-next-line no-console
        console.log(
          `  ${span.name} (${duration}ms) [${span.status}]`,
          { spanId: span.spanId.slice(0, 8), attributes: span.attributes }
        );
      }
      // eslint-disable-next-line no-console
      console.groupEnd?.();
    }
  }

  async shutdown(): Promise<void> {}
}

/**
 * Minimal OTLP/HTTP span exporter. Emits a JSON payload shaped per the
 * OTLP/JSON protobuf encoding spec.
 *
 * @example
 * ```ts
 * const exporter = new OtlpHttpSpanExporter({
 *   url: "https://collector.example.com/v1/traces",
 *   headers: { "x-api-key": "secret" },
 *   timeoutMs: 10_000,
 * });
 * ```
 */
export class OtlpHttpSpanExporter implements SpanExporter {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly resource: Record<string, string>;

  constructor(config: {
    url: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    resource?: Record<string, string>;
  }) {
    this.url = config.url;
    this.headers = { "content-type": "application/json", ...(config.headers ?? {}) };
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.resource = { ...(config.resource ?? {}) };
  }

  async export(spans: Span[]): Promise<void> {
    if (spans.length === 0) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const payload = this.toOtlpPayload(spans);
      const response = await fetch(this.url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`OTLP export failed: HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async shutdown(): Promise<void> {}

  /**
   * Serialize spans to the OTLP/JSON wire format. Exposed for tests.
   *
   * Produces a single ResourceSpans with a single ScopeSpans entry —
   * collectors accept any grouping.
   */
  toOtlpPayload(spans: Span[]): unknown {
    const attrList = (attrs: Record<string, string | number | boolean>) =>
      Object.keys(attrs).map((key) => {
        const value = attrs[key];
        let protoValue: unknown;
        if (typeof value === "string") protoValue = { stringValue: value };
        else if (typeof value === "number") {
          protoValue = Number.isInteger(value)
            ? { intValue: String(value) }
            : { doubleValue: value };
        } else if (typeof value === "boolean") protoValue = { boolValue: value };
        else protoValue = { stringValue: String(value) };
        return { key, value: protoValue };
      });

    return {
      resourceSpans: [
        {
          resource: {
            attributes: attrList(this.resource),
          },
          scopeSpans: [
            {
              scope: { name: "@aethelred/wallet-observability", version: "0.1.0" },
              spans: spans.map((span) => ({
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
                name: span.name,
                kind: kindToOtlp(span.kind),
                startTimeUnixNano: String(BigInt(span.startTime) * BigInt(1_000_000)),
                endTimeUnixNano:
                  span.endTime !== undefined
                    ? String(BigInt(span.endTime) * BigInt(1_000_000))
                    : String(BigInt(Date.now()) * BigInt(1_000_000)),
                attributes: attrList(span.attributes),
                events: span.events.map((ev) => ({
                  name: ev.name,
                  timeUnixNano: String(BigInt(ev.time) * BigInt(1_000_000)),
                  attributes: attrList(
                    Object.fromEntries(
                      Object.entries(ev.attributes)
                        .filter(
                          ([, v]) =>
                            typeof v === "string" ||
                            typeof v === "number" ||
                            typeof v === "boolean"
                        )
                        .map(([k, v]) => [k, v as string | number | boolean])
                    )
                  ),
                })),
                status: {
                  code: span.status === "ok" ? 1 : span.status === "error" ? 2 : 0,
                  message: span.statusDescription,
                },
              })),
            },
          ],
        },
      ],
    };
  }
}

function kindToOtlp(kind: SpanKind): number {
  switch (kind) {
    case "internal":
      return 1;
    case "server":
      return 2;
    case "client":
      return 3;
    case "producer":
      return 4;
    case "consumer":
      return 5;
  }
}
