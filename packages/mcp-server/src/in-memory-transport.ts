/**
 * In-memory transport for tests + embedded-server scenarios.
 *
 * Real deployments use stdio (local automation clients) or streamable HTTP
 * (remote automation clients). For unit tests, we want a direct "call the server
 * with a typed request, get a typed response" without going through
 * JSON-RPC serialization.
 *
 * This transport is the simplest possible wrapper around
 * `McpServer.handleToolCall` — it preserves the full dispatcher
 * behavior (policy, audit, rate-limiting, timeout) but skips the
 * JSON parse/stringify round trip.
 *
 * It's also useful for the Chrome extension's side-panel: the
 * side-panel UI can drive the server directly in-process for local
 * demos without needing to open a real MCP transport.
 */

import type { McpServer } from "./server";
import type { AgentContext, ToolCallRequest, ToolCallResponse } from "./types";

export interface InMemoryTransportConfig {
  readonly server: McpServer;
  readonly defaultContext: AgentContext;
}

/**
 * Create an in-memory transport with a fixed agent context.
 *
 * Returns a single `call` function that simulates a JSON-RPC
 * `tools/call` against the server. The context is merged with
 * any per-call overrides.
 */
export function createInMemoryTransport(config: InMemoryTransportConfig) {
  let nextId = 1;
  return {
    /**
     * Invoke a tool. Returns the JSON-RPC response verbatim —
     * errors appear as `result === undefined, error !== undefined`
     * rather than thrown, matching the wire format.
     */
    async call(
      toolName: string,
      args: Readonly<Record<string, unknown>> = {},
      overrides?: { readonly context?: Partial<AgentContext> },
    ): Promise<ToolCallResponse> {
      const context: AgentContext = {
        ...config.defaultContext,
        ...(overrides?.context ?? {}),
        receivedAt: Date.now(),
      };
      const request: ToolCallRequest = {
        jsonrpc: "2.0",
        id: nextId++,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      };
      return config.server.handleToolCall(request, context);
    },

    /** List the tools registered with the underlying server. */
    listTools() {
      return config.server.listTools();
    },
  };
}
