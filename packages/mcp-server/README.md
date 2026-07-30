# @aethelred/wallet-mcp-server

**Self-hosted MCP server for direct automation-client wallet tool calls.**

The compliance-native alternative to MoltPe's SaaS-hosted MCP. Every tool call is routed through the policy engine BEFORE any signing key is touched; no customer data leaves the enterprise perimeter.

## Why self-hosted matters

MoltPe's MCP endpoint lives at `moltpe.com/mcp`. Every tool call from every customer's automation client terminates at their servers. For regulated enterprise workloads that is a non-starter:

| Concern | MoltPe (SaaS) | Aethelred (self-hosted) |
|---|---|---|
| Where tool arguments land | moltpe.com | Your VPC / Nitro enclave / on-prem |
| Where signing keys live | MoltPe + your half of Shamir | Wherever your custody backend puts them |
| Who sees customer data in tool args | MoltPe | Only your own infra |
| SOC-2 / HIPAA / MiCA / GDPR boundary | Crosses to MoltPe | Stays inside your boundary |
| Policy-gate before signing | API key only | Full PolicyEngine + per-tool rules + rate limit + audit |
| Transport choice | Their choice | Your choice (stdio, HTTP, in-memory, custom) |
| Deployment | SaaS | Node / Cloudflare Workers / Nitro enclave / wherever |

## Architecture

```
       Automation client (desktop / IDE / service)
          ↓ MCP JSON-RPC (stdio or streamable HTTP)
       ToolDispatcher.call(toolName, args)
          ↓
       [1] Validator  (RegisteredTool.validate)      ← typed + runtime
       [2] Rate limiter (per agent × tool)
       [3] PolicyEngine.evaluate(context)            ← compliance gate
           ↓ allow | deny | approval-required
       [4] AuditCapture.record(pre-call)             ← args digest only
       [5] Handler  (your WalletRuntime impl)        ← signs/broadcasts
       [6] AuditCapture.record(post-call)            ← success | error
          ↓
       ← JSON-RPC response (sanitized — no info disclosure)
```

The compliance invariant: **no handler code path ever executes for a policy-denied call.** Rate-limit + policy-deny + approval-required all abort before step 5. This is what makes the server safe to expose to a partially trusted automation client.

## Built-in tool surface (MoltPe parity)

Five tools out of the box — the same automation-facing API as MoltPe's MCP server, plus your policy engine underneath:

| Tool | Purpose |
|---|---|
| `check_balance` | Read USDC balance on a given network |
| `list_transactions` | Recent agent on-chain activity |
| `agent_info` | Identity, spend caps, TEE attestation status |
| `send_payment` | Direct USDC transfer (policy-gated) |
| `call_x402_endpoint` | Pay + fetch an x402-protected URL |

Extend with your own tools via the `RegisteredTool` contract — every tool inherits the full gate.

## Quick start

```typescript
import {
  McpServer,
  defaultToolCatalog,
  createInMemoryTransport,
  type WalletRuntime,
  type McpPolicyHook,
} from "@aethelred/wallet-mcp-server";

const runtime: WalletRuntime = { /* your signer + chain access */ };

const policy: McpPolicyHook = async ({ context, toolName, args }) => {
  const decision = await policyEngine.evaluate({
    agentId: context.agentId,
    tool: toolName,
    args,
    spendUsd: args.amount ? computeUsd(args) : 0,
  });
  return decision; // { decision: "allow" | "deny" | "approval-required", ... }
};

const server = new McpServer({
  tools: defaultToolCatalog(runtime),
  policy,
  audit: auditCapture,
  rateLimiter: perAgentTokenBucket,
  handlerTimeoutMs: 10_000,
});

// Wire to your transport:
const transport = createInMemoryTransport({
  server,
  defaultContext: { agentId: "agent-123", origin: "local", receivedAt: Date.now() },
});
```

Stdio + streamable-HTTP transports ship separately in `@aethelred/wallet-mcp-server-node` (follow-up PR; Node-specific).

## Error taxonomy

All errors are typed `McpError` subclasses with stable `code` strings. Consumers branch on `code`, not on the English message:

| Code | JSON-RPC | When |
|---|---|---|
| `unknown-tool` | -32602 | Tool name not registered |
| `validation-failed` | -32602 | Arguments failed runtime validator |
| `policy-denied` | -32001 | PolicyEngine returned deny |
| `policy-approval-required` | -32002 | Needs human approval handoff |
| `rate-limited` | -32003 | Per-agent rate limiter exceeded |
| `handler-threw` | -32603 | Handler raised; message sanitized on wire |
| `handler-timeout` | -32603 | Exceeded configured timeout |
| `transport-error` | -32000 | Transport-adapter issue |

## Security properties

1. **Info-disclosure hardening**: unknown errors thrown by handlers have their messages replaced with a generic "Tool handler threw an internal error" before they go over the wire. The full message + cause are captured in the audit event for SRE forensics but NEVER leak to the tool caller.
2. **Policy before signing**: the dispatch order puts policy evaluation before handler invocation. Deny short-circuits before state changes.
3. **Audit args digest only**: the audit pre-call event carries a 32-bit FNV digest of the arguments, not the raw text. Regulated data in tool args never hits the audit log.
4. **No `cause` chain on wire**: JSON-RPC error responses include only the typed `aethelredCode` and whitelisted details — no underlying cause, no stack.
5. **Transport-agnostic**: the core dispatcher doesn't know about JSON-RPC parsing or HTTP framing. Transports are thin adapters; a compromised transport cannot bypass validation or policy.

## Test coverage

20 tests, pinning:
- Happy paths for all 5 built-in tools
- Policy deny blocks handler execution
- Policy approval-required surfaces with distinct code + approvalId
- Unknown tool → validation error
- Malformed args → validation error
- Rate limiter blocks before handler
- Handler timeout → typed error
- Handler throw becomes typed `handler-threw` with sanitized message
- Handler-thrown McpError preserves code + details
- Info-disclosure: underlying error message does NOT cross the wire
- Audit trail completeness (start + success / start + error)
- Audit never logs raw args (only a digest)
