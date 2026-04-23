/**
 * Typed error taxonomy for the MCP server package.
 *
 * Matches the error taxonomy pattern used throughout the wallet:
 * stable string codes consumers branch on, no English message
 * parsing. JSON-RPC error codes are numeric, but the server
 * converts typed errors → JSON-RPC error envelopes at the transport
 * boundary so the wire protocol stays compliant while the internal
 * taxonomy stays rich.
 *
 * JSON-RPC mapping (per MCP's conventions):
 *
 *   validation-failed, unknown-tool   → -32602 (Invalid params)
 *   policy-denied                     → -32001 (Implementation-defined)
 *   policy-approval-required          → -32002 (Implementation-defined)
 *   handler-threw, handler-timeout    → -32603 (Internal error)
 *   rate-limited                      → -32003 (Implementation-defined)
 *   transport-error                   → -32000 (Server error)
 */

export type McpErrorCode =
  | "validation-failed"
  | "unknown-tool"
  | "policy-denied"
  | "policy-approval-required"
  | "handler-threw"
  | "handler-timeout"
  | "rate-limited"
  | "transport-error";

export class McpError extends Error {
  readonly code: McpErrorCode;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: McpErrorCode,
    message: string,
    options?: { readonly cause?: unknown; readonly details?: Readonly<Record<string, unknown>> },
  ) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.cause = options?.cause;
    this.details = options?.details;
  }
}

/** Thrown by `RegisteredTool.validate` on bad arguments. */
export class ToolValidationError extends McpError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("validation-failed", message, { details });
    this.name = "ToolValidationError";
  }
}

/** Map a typed error to its JSON-RPC numeric code. */
export function jsonRpcCodeForError(err: McpError): number {
  switch (err.code) {
    case "validation-failed":
    case "unknown-tool":
      return -32602;
    case "policy-denied":
      return -32001;
    case "policy-approval-required":
      return -32002;
    case "handler-threw":
    case "handler-timeout":
      return -32603;
    case "rate-limited":
      return -32003;
    case "transport-error":
      return -32000;
    default: {
      // Exhaustiveness guard — if a new McpErrorCode is added and
      // this switch isn't updated, TypeScript errors here.
      const _exhaustive: never = err.code;
      void _exhaustive;
      return -32000;
    }
  }
}
