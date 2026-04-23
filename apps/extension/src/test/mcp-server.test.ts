/**
 * Tests for `@aethelred/wallet-mcp-server`.
 *
 * The central invariant this suite pins: **no handler code path
 * executes for a policy-denied call.** That's the compliance
 * guarantee that differentiates this package from MoltPe's SaaS
 * MCP server, where the only gate is the API key.
 *
 * We use the in-memory transport so each test is a pure Promise
 * — no JSON-RPC serialization, no Node stdio, no HTTP listener.
 * Concrete deployments wire real transports separately.
 */

import { describe, expect, it, vi } from "vitest";

import {
  McpServer,
  createInMemoryTransport,
  defaultToolCatalog,
  makeCheckBalanceTool,
  McpError,
  ToolValidationError,
  type AgentContext,
  type McpAuditSink,
  type McpPolicyHook,
  type McpRateLimiter,
  type WalletRuntime,
} from "@aethelred/wallet-mcp-server";

function makeRuntime(overrides: Partial<WalletRuntime> = {}): WalletRuntime {
  return {
    getBalance: vi.fn().mockResolvedValue({ balance: "5000000", decimals: 6 }),
    listTransactions: vi.fn().mockResolvedValue([]),
    getAgentInfo: vi.fn().mockResolvedValue({
      agentId: "agent-1",
      addresses: { "base-mainnet": "0xabc" },
      dailyLimitUsd: 100,
      dailyUsedUsd: 2,
      teeAttested: true,
      attestationPlatform: "aws-nitro",
    }),
    sendPayment: vi.fn().mockResolvedValue({ txHash: "0xdead", pending: true }),
    callX402: vi.fn().mockResolvedValue({ status: 200, body: "ok" }),
    ...overrides,
  };
}

function makeAudit(): McpAuditSink & { events: Array<Parameters<McpAuditSink["record"]>[0]> } {
  const events: Array<Parameters<McpAuditSink["record"]>[0]> = [];
  return {
    events,
    record(e) {
      events.push(e);
    },
  };
}

const DEFAULT_CONTEXT: AgentContext = {
  agentId: "agent-1",
  origin: "test",
  receivedAt: Date.now(),
};

describe("McpServer — happy paths", () => {
  it("lists tool manifests", () => {
    const runtime = makeRuntime();
    const server = new McpServer({ tools: defaultToolCatalog(runtime) });
    const tools = server.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "check_balance",
      "list_transactions",
      "agent_info",
      "send_payment",
      "call_x402_endpoint",
    ]);
  });

  it("calls check_balance and returns the runtime's response", async () => {
    const runtime = makeRuntime();
    const server = new McpServer({ tools: defaultToolCatalog(runtime) });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    const res = await transport.call("check_balance", { network: "base-mainnet" });
    expect(res.error).toBeUndefined();
    expect(res.result?.content).toHaveLength(1);
    const body = JSON.parse((res.result!.content[0] as { text: string }).text);
    expect(body.balance).toBe("5000000");
    expect(body.usdc).toBe(5);
  });

  it("calls send_payment with validated args", async () => {
    const runtime = makeRuntime();
    const server = new McpServer({ tools: defaultToolCatalog(runtime) });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    const res = await transport.call("send_payment", {
      network: "base-mainnet",
      recipient: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      amount: "1000000",
    });
    expect(res.error).toBeUndefined();
    expect(runtime.sendPayment).toHaveBeenCalledOnce();
  });
});

describe("McpServer — policy gate", () => {
  it("policy deny aborts BEFORE handler runs — compliance invariant", async () => {
    const runtime = makeRuntime();
    const denyPolicy: McpPolicyHook = vi.fn().mockResolvedValue({
      decision: "deny",
      reason: "daily cap reached",
    });
    const audit = makeAudit();
    const server = new McpServer({
      tools: defaultToolCatalog(runtime),
      policy: denyPolicy,
      audit,
    });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    const res = await transport.call("send_payment", {
      network: "base-mainnet",
      recipient: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      amount: "99999999",
    });
    expect(res.error).toBeDefined();
    expect(res.error!.data).toMatchObject({ aethelredCode: "policy-denied" });
    // CRITICAL: handler was NEVER called.
    expect(runtime.sendPayment).not.toHaveBeenCalled();
    // Audit records the denial.
    expect(audit.events.find((e) => e.kind === "mcp-call-denied")).toBeDefined();
  });

  it("approval-required surfaces as a distinct error code", async () => {
    const runtime = makeRuntime();
    const policy: McpPolicyHook = () => ({
      decision: "approval-required",
      reason: "amount over $100",
      approvalId: "appr-42",
    });
    const server = new McpServer({
      tools: defaultToolCatalog(runtime),
      policy,
    });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    const res = await transport.call("send_payment", {
      network: "base-mainnet",
      recipient: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      amount: "1000000",
    });
    expect(res.error?.data).toMatchObject({
      aethelredCode: "policy-approval-required",
      approvalId: "appr-42",
    });
    expect(runtime.sendPayment).not.toHaveBeenCalled();
  });

  it("policy allow lets the handler through", async () => {
    const runtime = makeRuntime();
    const policy: McpPolicyHook = () => ({ decision: "allow" });
    const server = new McpServer({
      tools: defaultToolCatalog(runtime),
      policy,
    });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    const res = await transport.call("check_balance", { network: "base-mainnet" });
    expect(res.error).toBeUndefined();
    expect(runtime.getBalance).toHaveBeenCalledOnce();
  });
});

describe("McpServer — validation", () => {
  it("unknown tool returns -32602 with typed code", async () => {
    const server = new McpServer({ tools: defaultToolCatalog(makeRuntime()) });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    const res = await transport.call("does_not_exist", {});
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.data).toMatchObject({ aethelredCode: "unknown-tool" });
  });

  it("missing required arg triggers validation-failed", async () => {
    const server = new McpServer({ tools: defaultToolCatalog(makeRuntime()) });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    const res = await transport.call("send_payment", {
      network: "base-mainnet",
      // missing recipient + amount
    });
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.data).toMatchObject({ aethelredCode: "validation-failed" });
  });

  it("non-hex recipient fails validation", async () => {
    const server = new McpServer({ tools: defaultToolCatalog(makeRuntime()) });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    const res = await transport.call("send_payment", {
      network: "base-mainnet",
      recipient: "not-an-address",
      amount: "1000",
    });
    expect(res.error?.data).toMatchObject({ aethelredCode: "validation-failed" });
  });
});

describe("McpServer — rate limiter", () => {
  it("throws rate-limited when the limiter denies", async () => {
    const runtime = makeRuntime();
    const limiter: McpRateLimiter = {
      check: vi.fn().mockResolvedValue({ allowed: false, retryAfterMs: 5000 }),
    };
    const server = new McpServer({
      tools: defaultToolCatalog(runtime),
      rateLimiter: limiter,
    });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    const res = await transport.call("check_balance", { network: "base-mainnet" });
    expect(res.error?.code).toBe(-32003);
    expect(res.error?.data).toMatchObject({ aethelredCode: "rate-limited", retryAfterMs: 5000 });
    expect(runtime.getBalance).not.toHaveBeenCalled();
  });

  it("lets calls through when the limiter allows", async () => {
    const runtime = makeRuntime();
    const limiter: McpRateLimiter = {
      check: vi.fn().mockResolvedValue({ allowed: true }),
    };
    const server = new McpServer({
      tools: defaultToolCatalog(runtime),
      rateLimiter: limiter,
    });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    const res = await transport.call("check_balance", { network: "base-mainnet" });
    expect(res.error).toBeUndefined();
  });
});

describe("McpServer — error paths", () => {
  it("handler throw becomes handler-threw JSON-RPC error (with sanitized message)", async () => {
    const runtime = makeRuntime({
      getBalance: vi.fn().mockRejectedValue(new Error("rpc exploded")),
    });
    const server = new McpServer({ tools: defaultToolCatalog(runtime) });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    const res = await transport.call("check_balance", { network: "base-mainnet" });
    expect(res.error?.code).toBe(-32603);
    expect(res.error?.data).toMatchObject({ aethelredCode: "handler-threw" });
    // Info-disclosure hardening: raw Error messages are NOT echoed
    // to the LLM caller. The full detail lives in the audit log
    // for SRE forensics only.
    expect(res.error?.message).toBe("Tool handler threw an internal error");
    expect(res.error?.message).not.toContain("rpc exploded");
  });

  it("handler timeout fires typed error", async () => {
    const slowRuntime = makeRuntime({
      getBalance: vi.fn().mockImplementation(() => new Promise(() => {/* never */})),
    });
    const server = new McpServer({
      tools: defaultToolCatalog(slowRuntime),
      handlerTimeoutMs: 50,
    });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    const res = await transport.call("check_balance", { network: "base-mainnet" });
    expect(res.error?.data).toMatchObject({ aethelredCode: "handler-timeout" });
  });

  it("handler thrown McpError is preserved in code + message", async () => {
    const runtime = makeRuntime({
      getBalance: vi.fn().mockRejectedValue(
        new ToolValidationError("balance unavailable", { reason: "indexer lag" }),
      ),
    });
    const server = new McpServer({ tools: defaultToolCatalog(runtime) });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    const res = await transport.call("check_balance", { network: "base-mainnet" });
    expect(res.error?.data).toMatchObject({ aethelredCode: "validation-failed", reason: "indexer lag" });
  });

  it("error responses do NOT carry cause chains over the wire", async () => {
    // Info-disclosure guard: stack traces / underlying errors must
    // not leak to LLM-controlled callers.
    const underlying = new Error("SELECT * FROM pg_shadow; -- database truth");
    const runtime = makeRuntime({
      getBalance: vi.fn().mockRejectedValue(underlying),
    });
    const server = new McpServer({ tools: defaultToolCatalog(runtime) });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    const res = await transport.call("check_balance", { network: "base-mainnet" });
    expect(JSON.stringify(res.error)).not.toContain("SELECT *");
    expect(JSON.stringify(res.error)).not.toContain("pg_shadow");
  });
});

describe("McpServer — audit trail completeness", () => {
  it("successful call emits start + success events with duration", async () => {
    const runtime = makeRuntime();
    const audit = makeAudit();
    const server = new McpServer({ tools: defaultToolCatalog(runtime), audit });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    await transport.call("check_balance", { network: "base-mainnet" });
    expect(audit.events.map((e) => e.kind)).toEqual(["mcp-call-start", "mcp-call-success"]);
    const success = audit.events.find((e) => e.kind === "mcp-call-success");
    expect(success).toMatchObject({ tool: "check_balance", agentId: "agent-1" });
  });

  it("failed handler emits start + error events", async () => {
    const runtime = makeRuntime({
      getBalance: vi.fn().mockRejectedValue(new Error("fail")),
    });
    const audit = makeAudit();
    const server = new McpServer({ tools: defaultToolCatalog(runtime), audit });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    await transport.call("check_balance", { network: "base-mainnet" });
    expect(audit.events.map((e) => e.kind)).toEqual(["mcp-call-start", "mcp-call-error"]);
  });

  it("audit never sees raw args — only a digest", async () => {
    const audit = makeAudit();
    const server = new McpServer({ tools: defaultToolCatalog(makeRuntime()), audit });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    const SECRET_NETWORK = "base-sepolia-secret-flag-12345";
    // Intentional string that isn't in the enum — the validator
    // accepts it (the enum on the JSON Schema is advisory), the
    // runtime rejects downstream. We're testing that the audit
    // trail does NOT contain the raw arg string.
    await transport.call("check_balance", { network: SECRET_NETWORK }).catch(() => {});
    const startEvt = audit.events.find((e) => e.kind === "mcp-call-start");
    const audit_json = JSON.stringify(startEvt);
    // The digest is a 32-bit FNV hash — audit trails should only
    // preserve a digest of args, not the raw text. This protects
    // against regulated-data leakage.
    expect(audit_json).not.toContain(SECRET_NETWORK);
  });
});

describe("McpServer — individual tool factories compose cleanly", () => {
  it("can register just a single tool", async () => {
    const runtime = makeRuntime();
    const server = new McpServer({
      tools: [makeCheckBalanceTool(runtime)],
    });
    const transport = createInMemoryTransport({ server, defaultContext: DEFAULT_CONTEXT });
    expect(server.listTools()).toHaveLength(1);
    await transport.call("check_balance", { network: "base-mainnet" });
    expect(runtime.getBalance).toHaveBeenCalledOnce();
  });
});

describe("McpServer — McpError taxonomy discipline", () => {
  it("all thrown McpError subclasses carry a stable code", () => {
    const err = new ToolValidationError("test");
    expect(err).toBeInstanceOf(McpError);
    expect(err.code).toBe("validation-failed");
    expect(err.name).toBe("ToolValidationError");
  });
});
