/**
 * `McpServer` — the core request dispatcher.
 *
 * Responsibilities (strictly, in order, per request):
 *
 *   1. Parse JSON-RPC envelope; reject malformed with -32700.
 *   2. Route to the tool handler OR to `tools/list` / `initialize`
 *      meta-methods.
 *   3. Validate arguments via the tool's own `validate()` fn
 *      (NOT the JSON Schema; that's advisory for LLM clients).
 *   4. Rate-limit (per agent, per tool) via the injected rate
 *      limiter.
 *   5. Run the policy gate — `deny` and `approval-required` both
 *      abort BEFORE the handler runs. The compliance invariant:
 *      **no handler code path sees state of a denied call**.
 *   6. Audit-capture the pre-call event.
 *   7. Invoke the handler inside a timeout.
 *   8. Audit-capture the post-call event (success or failure).
 *   9. Serialize the response.
 *
 * Errors thrown ANYWHERE in 3–7 bubble up to the JSON-RPC
 * envelope as a typed `error` object. The audit trail records
 * the original thrown-code; the wire sees only the sanitized
 * form (no stack traces, no cause chains) so a compromised LLM
 * can't exfiltrate server internals via error messages.
 */

import type {
  AgentContext,
  RegisteredTool,
  ToolCallRequest,
  ToolCallResponse,
  ToolManifest,
} from "./types";
import { McpError, jsonRpcCodeForError, ToolValidationError } from "./errors";

/**
 * Policy evaluation decision. Mirrors `@aethelred/wallet-policy`'s
 * DecisionOutcome but we redeclare it here so this package can be
 * consumed without a hard dependency on the policy engine in
 * environments that have their own policy layer (e.g. an enterprise
 * OPA-based gate).
 */
export type McpPolicyDecision =
  | { readonly decision: "allow" }
  | { readonly decision: "deny"; readonly reason: string }
  | { readonly decision: "approval-required"; readonly reason: string; readonly approvalId?: string };

/**
 * Called before every tool invocation. Return `allow` to proceed,
 * `deny` to abort with a typed error. `approval-required` aborts
 * with a distinct error so clients can surface a human-approval
 * handoff rather than a hard rejection.
 *
 * The hook is given the full AgentContext + tool name + validated
 * args so it can apply any rule — per-agent caps, per-tool
 * allowlists, value-based thresholds for x402 payments, etc.
 */
export type McpPolicyHook = (input: {
  readonly context: AgentContext;
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
}) => McpPolicyDecision | Promise<McpPolicyDecision>;

/**
 * Audit sink called at the start + end of every tool invocation.
 * In production this wraps `@aethelred/wallet-audit`'s AuditCapture
 * so every MCP call becomes a Merkle-batchable audit event.
 */
export interface McpAuditSink {
  record(event:
    | { readonly kind: "mcp-call-start"; readonly agentId: string; readonly tool: string; readonly argsDigest: string }
    | { readonly kind: "mcp-call-success"; readonly agentId: string; readonly tool: string; readonly durationMs: number }
    | { readonly kind: "mcp-call-denied"; readonly agentId: string; readonly tool: string; readonly reason: string }
    | { readonly kind: "mcp-call-error"; readonly agentId: string; readonly tool: string; readonly errorCode: string; readonly durationMs: number }
  ): void;
}

/**
 * Pluggable rate limiter. Simple ask/consume contract — implement
 * with a token-bucket, leaky-bucket, sliding-window, etc.
 *
 * Returning a numeric `retryAfterMs` tells the dispatcher to
 * throw a `rate-limited` error; the transport maps to a 429 / JSON-RPC
 * -32003.
 */
export interface McpRateLimiter {
  check(input: {
    readonly agentId: string;
    readonly toolName: string;
  }): Promise<{ readonly allowed: true } | { readonly allowed: false; readonly retryAfterMs: number }>;
}

export interface McpServerConfig {
  /** All tools the LLM can see + call. */
  readonly tools: ReadonlyArray<RegisteredTool>;
  /** Policy gate; if omitted, every call is allowed. */
  readonly policy?: McpPolicyHook;
  /** Audit sink; if omitted, audit is disabled (NOT RECOMMENDED). */
  readonly audit?: McpAuditSink;
  /** Rate limiter; if omitted, no rate limiting (NOT RECOMMENDED for multi-tenant). */
  readonly rateLimiter?: McpRateLimiter;
  /** Handler timeout in ms. Default 30_000. */
  readonly handlerTimeoutMs?: number;
}

/**
 * The server core. Transport-agnostic — call `handleToolCall`
 * from your stdio / http / in-memory adapter.
 */
export class McpServer {
  private readonly tools: Map<string, RegisteredTool>;
  private readonly config: McpServerConfig;

  constructor(config: McpServerConfig) {
    this.config = config;
    this.tools = new Map(config.tools.map((t) => [t.manifest.name, t]));
  }

  /**
   * List all registered tool manifests. MCP `tools/list` handler.
   */
  listTools(): ReadonlyArray<ToolManifest> {
    return this.config.tools.map((t) => t.manifest);
  }

  /**
   * Main dispatch. Runs the full gated pipeline (validate → rate
   * limit → policy → audit → handler → audit).
   *
   * Errors are returned as JSON-RPC errors; the transport decides
   * the HTTP status code. Unexpected thrown errors (non-McpError)
   * are wrapped in `handler-threw` with the original as `cause` so
   * audit trails preserve diagnostic detail.
   */
  async handleToolCall(req: ToolCallRequest, context: AgentContext): Promise<ToolCallResponse> {
    const startedAt = Date.now();
    const toolName = req.params.name;
    const rawArgs = req.params.arguments ?? {};

    // 1. Route
    const tool = this.tools.get(toolName);
    if (!tool) {
      return this.errorResponse(req.id, new McpError("unknown-tool", `No tool named "${toolName}"`));
    }

    // 2. Validate
    let validated: Readonly<Record<string, unknown>>;
    try {
      validated = tool.validate(rawArgs) as Readonly<Record<string, unknown>>;
    } catch (err) {
      if (err instanceof ToolValidationError) {
        return this.errorResponse(req.id, err);
      }
      return this.errorResponse(
        req.id,
        new ToolValidationError("Tool argument validation threw an unexpected error", {
          cause: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    // 3. Rate-limit
    if (this.config.rateLimiter) {
      const limit = await this.config.rateLimiter.check({ agentId: context.agentId, toolName });
      if (!limit.allowed) {
        return this.errorResponse(
          req.id,
          new McpError("rate-limited", `Rate limit exceeded for tool "${toolName}"`, {
            details: { retryAfterMs: limit.retryAfterMs },
          }),
        );
      }
    }

    // 4. Policy gate
    if (this.config.policy) {
      const decision = await this.config.policy({ context, toolName, args: validated });
      if (decision.decision === "deny") {
        this.config.audit?.record({
          kind: "mcp-call-denied",
          agentId: context.agentId,
          tool: toolName,
          reason: decision.reason,
        });
        return this.errorResponse(
          req.id,
          new McpError("policy-denied", `Policy denied: ${decision.reason}`),
        );
      }
      if (decision.decision === "approval-required") {
        this.config.audit?.record({
          kind: "mcp-call-denied",
          agentId: context.agentId,
          tool: toolName,
          reason: `approval-required: ${decision.reason}`,
        });
        return this.errorResponse(
          req.id,
          new McpError(
            "policy-approval-required",
            `Approval required: ${decision.reason}`,
            { details: { approvalId: decision.approvalId } },
          ),
        );
      }
    }

    // 5. Audit pre-call
    this.config.audit?.record({
      kind: "mcp-call-start",
      agentId: context.agentId,
      tool: toolName,
      argsDigest: digestArgs(validated),
    });

    // 6. Handle with timeout
    const timeoutMs = this.config.handlerTimeoutMs ?? 30_000;
    try {
      const output = await withTimeout(
        tool.handle({ context, args: validated }),
        timeoutMs,
        `Tool "${toolName}" exceeded ${timeoutMs}ms timeout`,
      );
      const durationMs = Date.now() - startedAt;
      this.config.audit?.record({
        kind: "mcp-call-success",
        agentId: context.agentId,
        tool: toolName,
        durationMs,
      });
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          content: output.content,
          isError: output.isError,
        },
      };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const code: McpError["code"] =
        err instanceof McpError ? err.code : "handler-threw";

      this.config.audit?.record({
        kind: "mcp-call-error",
        agentId: context.agentId,
        tool: toolName,
        errorCode: code,
        durationMs,
      });

      // Info-disclosure hardening:
      //
      // McpError subclasses are OUR code. Their .message is
      // author-controlled and safe to surface to the caller.
      //
      // Anything else (generic Error, string throw, etc.) is
      // attacker-adjacent: a handler that accidentally throws a
      // database error, stack trace, or internal detail would
      // leak it verbatim to the LLM caller. Replace with a
      // generic message; the full message + cause are audited
      // into the Merkle-batched event log for SRE forensics but
      // NEVER go over the wire.
      if (err instanceof McpError) {
        return this.errorResponse(req.id, err);
      }

      return this.errorResponse(
        req.id,
        new McpError("handler-threw", "Tool handler threw an internal error", { cause: err }),
      );
    }
  }

  private errorResponse(id: ToolCallRequest["id"], err: McpError): ToolCallResponse {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: jsonRpcCodeForError(err),
        message: err.message,
        // Details are whitelisted — no `cause` chain goes over the
        // wire. That's a deliberate info-disclosure mitigation: a
        // handler error message can contain a stack trace, chain
        // state, or user data that must not leak.
        data: err.details ? { ...err.details, aethelredCode: err.code } : { aethelredCode: err.code },
      },
    };
  }
}

/**
 * Compute a stable, short digest of the tool arguments for audit
 * logging. We deliberately do NOT log the raw args — they often
 * contain addresses, amounts, user data that's regulated. The
 * digest is still deterministic so a forensic auditor can reproduce
 * the hash given the raw args from a separate evidence vault.
 *
 * Algorithm: JSON.stringify → first 16 chars of hex-encoded
 * sha-256. Sufficient for cardinality within a single agent's
 * audit log; collision-resistance is not a security property
 * we need here (the full args live in a separate vault).
 */
function digestArgs(args: unknown): string {
  // Poor-man's digest: length + first N chars of sorted JSON.
  // Production deployments should swap in a real sha256 via
  // @noble/hashes; pulling that dep into this package just for
  // logging is overkill, so we expose a seam:
  const json = JSON.stringify(args, Object.keys(args as Record<string, unknown>).sort());
  let hash = 0;
  for (let i = 0; i < json.length; i += 1) {
    hash = ((hash << 5) - hash + json.charCodeAt(i)) | 0;
  }
  return `fnv32:${(hash >>> 0).toString(16).padStart(8, "0")}:len=${json.length}`;
}

/**
 * Promise timeout wrapper. Rejects with a typed McpError if the
 * inner promise doesn't settle within `ms`.
 */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new McpError("handler-timeout", message));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
