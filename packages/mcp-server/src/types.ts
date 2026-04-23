/**
 * `@aethelred/wallet-mcp-server` — type surface.
 *
 * Model Context Protocol (MCP, https://modelcontextprotocol.io) is
 * Anthropic's open spec for letting LLMs invoke external tools
 * through a structured request/response interface. The canonical
 * MCP server exposes tools via JSON-RPC over stdio or streamable
 * HTTP; the LLM client (Claude Desktop, Cursor, Windsurf) reads the
 * tool manifest and can call any tool on the LLM's behalf.
 *
 * MoltPe runs a SaaS-hosted MCP server at `moltpe.com/mcp`. Every
 * tool call from any customer's LLM hits their servers. That's
 * unacceptable for any enterprise with regulatory posture — either
 * because:
 *
 *   - Customer data in the tool arguments / responses leaks into a
 *     third-party SaaS, which blows SOC-2, HIPAA, MiCA, GDPR.
 *   - The tool-dispatch surface bypasses the customer's own policy
 *     controls — MoltPe's API key is the ONLY gate.
 *   - Key material lives on the SaaS. Semi-custodial Shamir 2-of-2
 *     is better than full custody but still off-prem.
 *
 * This module is the compliance-native alternative. Self-hosted,
 * embeddable in any runtime (Node, Cloudflare Workers, Nitro
 * enclave), and — critically — every tool call is routed through
 * the wallet's PolicyEngine BEFORE any signing key is touched.
 *
 * Architecture:
 *
 *       LLM (Claude/Cursor/Windsurf)
 *          ↓ MCP JSON-RPC (stdio or http)
 *       ToolDispatcher.call(toolName, args)
 *          ↓
 *       [1] PolicyEngine.evaluate(context)  ← compliance gate
 *          ↓ allow | deny | approval-required
 *       [2] AuditCapture.record(pre-call)
 *          ↓
 *       [3] Tool handler (resolves via signer → network)
 *          ↓
 *       [4] AuditCapture.record(post-call: success|failure)
 *          ↓
 *       ← JSON-RPC response
 *
 * The server is deliberately transport-agnostic: the core is a
 * `McpServer` class that handles the request/response routing, and
 * three thin transports (`./stdio-transport.ts`,
 * `./http-transport.ts`, `./in-memory-transport.ts`) bolt on.
 * Tests use the in-memory transport; production picks the deploy
 * target.
 *
 * @packageDocumentation
 */

/**
 * MCP JSON-RPC request for a tool invocation.
 *
 * We pin the shape to MCP's v1.0 tools/call payload; newer MCP
 * versions may add fields which we pass through verbatim via
 * `[unknownKey: string]`.
 */
export interface ToolCallRequest {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly method: "tools/call";
  readonly params: {
    readonly name: string;
    readonly arguments?: Readonly<Record<string, unknown>>;
  };
}

/**
 * MCP JSON-RPC response for a tool call. Mirrors the protocol's
 * `content` array format (array of content blocks). Most of our
 * tools return a single text block containing a JSON payload.
 */
export interface ToolCallResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly result?: {
    readonly content: ReadonlyArray<ToolContentBlock>;
    /**
     * Tool-level error — the call reached the server and a handler
     * ran, but the handler returned an error state. Distinct from
     * a JSON-RPC error (protocol-level failure).
     */
    readonly isError?: boolean;
  };
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export type ToolContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string }
  | { readonly type: "resource"; readonly resource: { readonly uri: string; readonly text?: string } };

/**
 * Tool manifest entry. MCP clients call `tools/list` to discover
 * what's available; the server returns an array of these.
 */
export interface ToolManifest {
  readonly name: string;
  readonly description: string;
  /**
   * JSON Schema (draft 2020-12) describing the `arguments`
   * object the LLM should pass. We use a minimal subset (objects
   * with primitive properties); full JSON Schema is overkill for
   * tool signatures and tends to produce LLM tool-use errors.
   */
  readonly inputSchema: JsonSchema;
}

/**
 * Minimal JSON Schema shape we surface to the LLM. Intentionally
 * narrow — MCP permits the full JSON Schema draft 2020-12, but
 * Claude / Cursor / Windsurf all struggle with deeply nested or
 * recursive schemas. Our tool signatures top out at 2 levels of
 * nesting (flat object with optional nested "metadata").
 */
export interface JsonSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: ReadonlyArray<string>;
  readonly additionalProperties?: boolean;
}

export interface JsonSchemaProperty {
  readonly type: "string" | "number" | "integer" | "boolean" | "object" | "array";
  readonly description?: string;
  readonly enum?: ReadonlyArray<string | number>;
  readonly items?: JsonSchemaProperty;
  readonly properties?: Readonly<Record<string, JsonSchemaProperty>>;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly pattern?: string;
}

/**
 * The agent context the server exposes to every tool handler AND
 * the policy engine. It's the "who is calling this tool" envelope.
 *
 * Populated by the transport layer at request boundary (e.g.
 * HTTP transport pulls `agentId` from the Bearer token; stdio
 * transport uses a fixed one passed at server construction).
 */
export interface AgentContext {
  readonly agentId: string;
  /** Origin that issued the tool call — domain for http, "stdio" for stdio. */
  readonly origin: string;
  /** Millisecond timestamp the transport received the request. */
  readonly receivedAt: number;
  /**
   * Arbitrary metadata the transport can attach (request-id, TEE
   * attestation status, session-id, etc.). Surfaces in audit
   * events; tool handlers MUST NOT branch on it for security.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * What a tool handler runs against — context plus the validated
 * arguments. Handlers are pure in-out functions; all I/O (signer
 * access, network calls, chain reads) goes through services
 * injected at server construction.
 */
export interface ToolHandlerInput<TArgs = Readonly<Record<string, unknown>>> {
  readonly context: AgentContext;
  readonly args: TArgs;
}

/**
 * Handler return. Follows MCP's content-array convention.
 *
 * `isError: true` means "the call reached a handler but the
 * handler returned an error state" — the LLM sees a
 * well-formed response with `isError` flagged. Throwing from a
 * handler is a separate code path (see `./server.ts`); the
 * server wraps thrown errors into a JSON-RPC error with a
 * typed code.
 */
export interface ToolHandlerOutput {
  readonly content: ReadonlyArray<ToolContentBlock>;
  readonly isError?: boolean;
}

/**
 * A registered tool. Tools are the unit of policy enforcement —
 * the policy engine sees `toolName` + `args` and decides.
 */
export interface RegisteredTool<TArgs = Readonly<Record<string, unknown>>> {
  readonly manifest: ToolManifest;
  /**
   * Runtime argument validator. Returns the validated args (may
   * normalize) or throws a `ToolValidationError` on failure. We
   * require handlers to validate INSIDE the package because the
   * JSON Schema check the LLM client runs is advisory — a
   * misbehaving client may send anything over the wire.
   */
  validate(raw: unknown): TArgs;
  /**
   * Call-site handler. Wrapped by the dispatcher with policy +
   * audit + error conversion.
   */
  handle(input: ToolHandlerInput<TArgs>): Promise<ToolHandlerOutput>;
}
