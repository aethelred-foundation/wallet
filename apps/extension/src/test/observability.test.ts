/**
 * Tests for @aethelred/wallet-observability.
 *
 * Covers the five primitives (Logger / Tracer / Meter / AethelredError /
 * PerformanceBudget) and the OTLP wire-format serializer. Run with:
 *
 *     npx vitest run observability --reporter=basic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AethelredError,
  ALL_ERROR_CODES,
  BasicTracer,
  BufferedSink,
  CONSOLE_SINK,
  ChromeStorageSink,
  ConsoleSpanExporter,
  ERROR_CODES,
  InMemoryMeter,
  Logger,
  NoopSpanExporter,
  OtlpHttpSpanExporter,
  PerformanceBudget,
  SLO_CATALOG,
  domainOf,
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  isRegisteredErrorCode,
  parseTraceparent,
  recordLatency,
  type LogRecord,
  type LogSink,
  type Span,
} from "@aethelred/wallet-observability";

// ─── Logger ─────────────────────────────────────────────────────────

describe("Logger", () => {
  it("respects minLevel — below-threshold logs are dropped", () => {
    const records: LogRecord[] = [];
    const sink: LogSink = { write: (r) => records.push(r) };
    const log = new Logger({ component: "test", sinks: [sink], minLevel: "warn" });
    log.trace("x.trace", "trace");
    log.debug("x.debug", "debug");
    log.info("x.info", "info");
    log.warn("x.warn", "warn");
    log.error("x.error", "error");
    log.fatal("x.fatal", "fatal");
    expect(records.map((r) => r.level)).toEqual(["warn", "error", "fatal"]);
  });

  it("withContext returns a child that merges context without mutating parent", () => {
    const records: LogRecord[] = [];
    const sink: LogSink = { write: (r) => records.push(r) };
    const parent = new Logger({ component: "test", sinks: [sink], minLevel: "trace" });
    const child = parent.withContext({ chainId: "0x1", userTier: 3 });
    child.info("a.b", "child msg");
    parent.info("a.b", "parent msg");
    expect(records[0].attributes).toEqual({ chainId: "0x1", userTier: 3 });
    expect(records[1].attributes).toEqual({});
  });

  it("withCorrelation attaches correlation id", () => {
    const records: LogRecord[] = [];
    const sink: LogSink = { write: (r) => records.push(r) };
    const base = new Logger({ component: "test", sinks: [sink], minLevel: "trace" });
    const scoped = base.withCorrelation("req-123");
    scoped.info("a.b", "msg");
    expect(records[0].correlationId).toBe("req-123");
  });

  it("CONSOLE_SINK writes to console without throwing", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = new Logger({ component: "test", sinks: [CONSOLE_SINK], minLevel: "info" });
    expect(() => log.info("a.b", "msg", { x: 1 })).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("logger with zero sinks does not throw", () => {
    const log = new Logger({ component: "test", sinks: [], minLevel: "trace" });
    expect(() => log.error("x", "y", { error: new Error("z") })).not.toThrow();
  });

  it("normalizes Error values in attrs.error", () => {
    const records: LogRecord[] = [];
    const sink: LogSink = { write: (r) => records.push(r) };
    const log = new Logger({ component: "test", sinks: [sink], minLevel: "trace" });
    log.error("rpc.request.failed", "boom", { error: new Error("down") });
    expect(records[0].error?.name).toBe("Error");
    expect(records[0].error?.message).toBe("down");
  });
});

describe("BufferedSink", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes at configured interval", async () => {
    const received: LogRecord[] = [];
    const inner: LogSink = { write: (r) => received.push(r) };
    const buf = new BufferedSink({ inner, flushIntervalMs: 1000, maxBuffered: 10 });
    buf.start();
    const record: LogRecord = {
      level: "info",
      timestamp: Date.now(),
      message: "msg",
      code: "a.b",
      component: "test",
      attributes: {},
    };
    buf.write(record);
    expect(received.length).toBe(0);
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(received.length).toBe(1);
    buf.stop();
  });
});

describe("ChromeStorageSink", () => {
  it("writes to storage (mock chrome.storage.local)", async () => {
    const data: Record<string, unknown> = {};
    const storage = {
      get(key: string, cb: (items: Record<string, unknown>) => void) {
        cb({ [key]: data[key] });
      },
      set(items: Record<string, unknown>, cb?: () => void) {
        Object.assign(data, items);
        cb?.();
      },
    };
    const sink = new ChromeStorageSink({ storage, key: "aethelred:logs", capacity: 5 });
    const record: LogRecord = {
      level: "info",
      timestamp: Date.now(),
      message: "msg",
      code: "a.b",
      component: "test",
      attributes: {},
    };
    sink.write(record);
    await sink.flush();
    expect(Array.isArray(data["aethelred:logs"])).toBe(true);
    expect((data["aethelred:logs"] as LogRecord[]).length).toBe(1);
  });
});

// ─── Tracing ────────────────────────────────────────────────────────

describe("Tracing", () => {
  it("Span.end() stops timer and marks complete", async () => {
    const tracer = new BasicTracer({ exporter: new NoopSpanExporter() });
    const span = tracer.startSpan("test.span");
    expect(span.endTime).toBeUndefined();
    span.end();
    expect(span.endTime).toBeDefined();
    expect(span.endTime!).toBeGreaterThanOrEqual(span.startTime);
  });

  it("Tracer.withSpan auto-ends on success", async () => {
    let observed: Span | null = null;
    const tracer = new BasicTracer({ exporter: new NoopSpanExporter() });
    await tracer.withSpan("t", (span) => {
      observed = span;
      return 42;
    });
    expect(observed).not.toBeNull();
    expect(observed!.endTime).toBeDefined();
    expect(observed!.status).toBe("ok");
  });

  it("Tracer.withSpan auto-ends and marks status=error on throw", async () => {
    let observed: Span | null = null;
    const tracer = new BasicTracer({ exporter: new NoopSpanExporter() });
    await expect(
      tracer.withSpan("t", (span) => {
        observed = span;
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(observed!.status).toBe("error");
    expect(observed!.endTime).toBeDefined();
  });

  it("Tracer.withSpan adds exception event on throw", async () => {
    let observed: Span | null = null;
    const tracer = new BasicTracer({ exporter: new NoopSpanExporter() });
    await expect(
      tracer.withSpan("t", (span) => {
        observed = span;
        throw new Error("boom");
      })
    ).rejects.toThrow();
    expect(observed!.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("spans have unique traceId and spanId", () => {
    const tracer = new BasicTracer({ exporter: new NoopSpanExporter() });
    const a = tracer.startSpan("a");
    const b = tracer.startSpan("b");
    expect(a.traceId).not.toBe(b.traceId);
    expect(a.spanId).not.toBe(b.spanId);
  });

  it("child span inherits traceId, gets new spanId, sets parentSpanId", () => {
    const tracer = new BasicTracer({ exporter: new NoopSpanExporter() });
    const parent = tracer.startSpan("parent");
    const child = tracer.startSpan("child", { parent });
    expect(child.traceId).toBe(parent.traceId);
    expect(child.spanId).not.toBe(parent.spanId);
    expect(child.parentSpanId).toBe(parent.spanId);
  });

  it("trace context flows across synchronous span nesting", async () => {
    const tracer = new BasicTracer({ exporter: new NoopSpanExporter() });
    let innerTrace = "";
    let outerTrace = "";
    await tracer.withSpan("outer", async (outer) => {
      outerTrace = outer.traceId;
      await tracer.withSpan("inner", async (inner) => {
        innerTrace = inner.traceId;
      }, { parent: outer });
    });
    expect(innerTrace).toBe(outerTrace);
  });

  it("span.addEvent appends correctly", () => {
    const tracer = new BasicTracer({ exporter: new NoopSpanExporter() });
    const span = tracer.startSpan("test");
    span.addEvent("first", { k: 1 });
    span.addEvent("second", { k: 2 });
    expect(span.events).toHaveLength(2);
    expect(span.events[0].name).toBe("first");
    expect(span.events[1].attributes.k).toBe(2);
  });

  it("W3C traceparent header format parses correctly", () => {
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    const header = formatTraceparent({ traceId, spanId, flags: 1 });
    expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const parsed = parseTraceparent(header);
    expect(parsed).toEqual({ traceId, spanId, flags: 1 });
  });

  it("parseTraceparent rejects bad input", () => {
    expect(parseTraceparent("not a header")).toBeNull();
    expect(parseTraceparent("ff-0000-0000-00")).toBeNull();
    expect(
      parseTraceparent("00-00000000000000000000000000000000-0000000000000000-01")
    ).toBeNull();
  });

  it("NoopSpanExporter does not throw", async () => {
    const exporter = new NoopSpanExporter();
    const tracer = new BasicTracer({ exporter: new NoopSpanExporter() });
    const span = tracer.startSpan("t");
    span.end();
    await expect(exporter.export([span])).resolves.not.toThrow();
    await expect(exporter.shutdown()).resolves.not.toThrow();
  });

  it("OtlpHttpSpanExporter serializes an OTLP payload", () => {
    const exporter = new OtlpHttpSpanExporter({
      url: "http://localhost/v1/traces",
      resource: { "service.name": "wallet" },
    });
    const tracer = new BasicTracer({ exporter: new NoopSpanExporter() });
    const span = tracer.startSpan("rpc.request", { attributes: { "rpc.method": "eth_call" } });
    span.addEvent("retry", { attempt: 1 });
    span.setStatus("ok");
    span.end();
    const payload = exporter.toOtlpPayload([span]) as {
      resourceSpans: Array<{
        scopeSpans: Array<{
          spans: Array<{
            name: string;
            attributes: Array<{ key: string; value: unknown }>;
          }>;
        }>;
      }>;
    };
    expect(payload.resourceSpans[0].scopeSpans[0].spans[0].name).toBe("rpc.request");
    expect(payload.resourceSpans[0].scopeSpans[0].spans[0].attributes.length).toBeGreaterThan(0);
  });

  it("OtlpHttpSpanExporter batches and POSTs", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const exporter = new OtlpHttpSpanExporter({
        url: "http://localhost/v1/traces",
      });
      const tracer = new BasicTracer({ exporter: new NoopSpanExporter() });
      const span = tracer.startSpan("t");
      span.end();
      await exporter.export([span]);
      expect(fetchMock).toHaveBeenCalledOnce();
      const args = fetchMock.mock.calls[0] as unknown as [
        string,
        { method?: string; body?: string },
      ];
      expect(args[1].method).toBe("POST");
      expect(typeof args[1].body).toBe("string");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("ConsoleSpanExporter does not throw", async () => {
    const exporter = new ConsoleSpanExporter();
    const tracer = new BasicTracer({ exporter: new NoopSpanExporter() });
    const span = tracer.startSpan("t");
    span.end();
    await expect(exporter.export([span])).resolves.not.toThrow();
  });
});

// ─── Metrics ────────────────────────────────────────────────────────

describe("Metrics", () => {
  it("Counter increments by value", () => {
    const meter = new InMemoryMeter();
    const c = meter.counter("tx.sent");
    c.add(3, { chain: "0x1" });
    c.add(2, { chain: "0x1" });
    expect(c.getValue({ chain: "0x1" })).toBe(5);
    expect(c.getValue({ chain: "0x5" })).toBe(0);
  });

  it("Counter refuses to decrement", () => {
    const meter = new InMemoryMeter();
    const c = meter.counter("c");
    expect(() => c.add(-1)).toThrow();
  });

  it("Gauge replaces value", () => {
    const meter = new InMemoryMeter();
    const g = meter.gauge("queue.depth");
    g.set(10);
    g.set(3);
    expect(g.getValue()).toBe(3);
  });

  it("Histogram records and buckets correctly", () => {
    const meter = new InMemoryMeter();
    const h = meter.histogram("latency", "latency", "ms", [1, 5, 10]);
    h.record(0.5);
    h.record(3);
    h.record(7);
    h.record(20);
    const snap = h.getSnapshot();
    expect(snap).toBeDefined();
    expect(snap!.count).toBe(4);
    expect(snap!.sum).toBeCloseTo(30.5);
    // Buckets: [0.5<=1, 3<=5, 7<=10, 20>10 => +Inf]
    expect(snap!.buckets[0].count).toBe(1);
    expect(snap!.buckets[1].count).toBe(1);
    expect(snap!.buckets[2].count).toBe(1);
    expect(snap!.buckets[3].count).toBe(1);
  });

  it("InMemoryMeter exports OTLP format", () => {
    const meter = new InMemoryMeter();
    meter.counter("c").add(1);
    meter.gauge("g").set(5);
    meter.histogram("h", "h", "ms", [10]).record(3);
    const payload = meter.toOtlpPayload({ "service.name": "wallet" }) as {
      resourceMetrics: Array<{
        scopeMetrics: Array<{ metrics: Array<Record<string, unknown>> }>;
      }>;
    };
    expect(payload.resourceMetrics[0].scopeMetrics[0].metrics.length).toBe(3);
  });

  it("InMemoryMeter exports Prometheus format", () => {
    const meter = new InMemoryMeter();
    meter.counter("requests_total", "requests", "1").add(7, { status: "200" });
    meter.gauge("queue_depth", "depth", "1").set(4);
    const text = meter.toPrometheus();
    expect(text).toContain("# TYPE requests_total counter");
    expect(text).toContain('requests_total{status="200"} 7');
    expect(text).toContain("# TYPE queue_depth gauge");
    expect(text).toContain("queue_depth 4");
  });
});

// ─── Perf / Budgets ────────────────────────────────────────────────

describe("PerformanceBudget", () => {
  it("reports withinBudget: false when exceeded", async () => {
    const budget = new PerformanceBudget("slow.op", 1);
    const res = await budget.measure(async () => {
      await new Promise((r) => setTimeout(r, 15));
      return 1;
    });
    expect(res.result).toBe(1);
    expect(res.withinBudget).toBe(false);
    expect(res.tookMs).toBeGreaterThanOrEqual(10);
  });

  it("captures async timing", async () => {
    const budget = new PerformanceBudget("fast", 10_000);
    const res = await budget.measure(async () => 42);
    expect(res.result).toBe(42);
    expect(res.withinBudget).toBe(true);
  });

  it("recordLatency records into meter", () => {
    const meter = new InMemoryMeter();
    const handle = recordLatency(meter, "rpc.latency", { method: "eth_call" });
    const ms = handle.end();
    expect(ms).toBeGreaterThanOrEqual(0);
    const snap = meter.getHistogram("rpc.latency")!.getSnapshot({ method: "eth_call" });
    expect(snap?.count).toBe(1);
  });

  it("SLO catalog is well-formed", () => {
    for (const slo of Object.values(SLO_CATALOG)) {
      expect(slo.name).toMatch(/^[a-z][a-z0-9_.]+$/);
      expect(slo.budgetMs).toBeGreaterThan(0);
      expect(["1m", "5m", "1h", "24h"]).toContain(slo.window);
    }
  });
});

// ─── Errors ────────────────────────────────────────────────────────

describe("Error codes and AethelredError", () => {
  it("ERROR_CODES values are all unique strings", () => {
    const seen = new Set<string>();
    for (const code of ALL_ERROR_CODES) {
      expect(typeof code).toBe("string");
      expect(code).toMatch(/^[a-z][a-z0-9_.]+$/);
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThanOrEqual(80);
  });

  it("domainOf resolves known codes", () => {
    expect(domainOf(ERROR_CODES.rpc.REQUEST_TIMEOUT)).toBe("rpc");
    expect(domainOf(ERROR_CODES.signer.USER_REJECTED)).toBe("signer");
    expect(domainOf("not-a-real-code")).toBeNull();
  });

  it("isRegisteredErrorCode matches the catalog", () => {
    expect(isRegisteredErrorCode(ERROR_CODES.policy.SPEND_LIMIT_EXCEEDED)).toBe(true);
    expect(isRegisteredErrorCode("unknown")).toBe(false);
  });

  it("AethelredError extends Error correctly", () => {
    const err = new AethelredError({
      code: ERROR_CODES.rpc.REQUEST_TIMEOUT,
      category: "network-error",
      message: "timeout",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AethelredError");
    expect(err.code).toBe(ERROR_CODES.rpc.REQUEST_TIMEOUT);
    expect(err.category).toBe("network-error");
  });

  it("AethelredError.toLogRecord produces correct shape", () => {
    const err = new AethelredError({
      code: ERROR_CODES.audit.CHAIN_INTEGRITY_BROKEN,
      category: "integrity-failure",
      message: "tamper",
      correlationId: "req-1",
      attributes: { seq: 5 },
    });
    const record = err.toLogRecord();
    expect(record.level).toBe("fatal");
    expect(record.code).toBe(ERROR_CODES.audit.CHAIN_INTEGRITY_BROKEN);
    expect(record.correlationId).toBe("req-1");
    expect(record.attributes.category).toBe("integrity-failure");
    expect(record.attributes.seq).toBe(5);
  });

  it("Error with retryable hint propagates", () => {
    const err = new AethelredError({
      code: ERROR_CODES.rpc.RATE_LIMITED,
      category: "network-error",
      message: "429",
      hint: {
        userMessage: "Too busy — try again shortly",
        developerMessage: "Provider returned 429",
        retryable: true,
        retryAfterMs: 3000,
        escalateToSupport: false,
      },
    });
    expect(err.isRetryable()).toBe(true);
    expect(err.toPublicJson().retryAfterMs).toBe(3000);
  });

  it("AethelredError.wrap preserves existing instance", () => {
    const original = new AethelredError({
      code: ERROR_CODES.signer.USER_REJECTED,
      category: "user-error",
      message: "rejected",
    });
    const wrapped = AethelredError.wrap(original, {
      code: ERROR_CODES.rpc.REQUEST_FAILED,
      category: "network-error",
    });
    expect(wrapped).toBe(original);
  });
});
