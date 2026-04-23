/**
 * `@aethelred/wallet-mcp-server` — public API.
 *
 * Exports are grouped:
 *
 *   Core server:
 *     - McpServer (class)
 *     - McpServerConfig, McpPolicyHook, McpPolicyDecision,
 *       McpAuditSink, McpRateLimiter
 *
 *   Types:
 *     - AgentContext, ToolCallRequest, ToolCallResponse,
 *       ToolContentBlock, ToolManifest, JsonSchema,
 *       JsonSchemaProperty, RegisteredTool, ToolHandlerInput,
 *       ToolHandlerOutput
 *
 *   Errors:
 *     - McpError, ToolValidationError, McpErrorCode,
 *       jsonRpcCodeForError
 *
 *   Built-in tools (MoltPe-parity surface + compliance gating):
 *     - makeCheckBalanceTool, makeListTransactionsTool,
 *       makeAgentInfoTool, makeSendPaymentTool, makeCallX402Tool,
 *       defaultToolCatalog
 *     - WalletRuntime (the contract you implement)
 *
 *   Transports:
 *     - createInMemoryTransport (for tests and embedded servers)
 *
 * HTTP + stdio transports are NOT included in v0.1 because they
 * depend on Node-specific APIs the Chrome extension can't use at
 * runtime. A follow-up PR adds a separate
 * `@aethelred/wallet-mcp-server-node` package with those transports.
 */

// Core server
export { McpServer } from "./server";
export type {
  McpServerConfig,
  McpPolicyHook,
  McpPolicyDecision,
  McpAuditSink,
  McpRateLimiter,
} from "./server";

// Types
export type {
  AgentContext,
  ToolCallRequest,
  ToolCallResponse,
  ToolContentBlock,
  ToolManifest,
  JsonSchema,
  JsonSchemaProperty,
  RegisteredTool,
  ToolHandlerInput,
  ToolHandlerOutput,
} from "./types";

// Errors
export {
  McpError,
  ToolValidationError,
  jsonRpcCodeForError,
  type McpErrorCode,
} from "./errors";

// Built-in tools
export {
  makeCheckBalanceTool,
  makeListTransactionsTool,
  makeAgentInfoTool,
  makeSendPaymentTool,
  makeCallX402Tool,
  defaultToolCatalog,
  type WalletRuntime,
} from "./builtin-tools";

// Transports
export {
  createInMemoryTransport,
  type InMemoryTransportConfig,
} from "./in-memory-transport";
