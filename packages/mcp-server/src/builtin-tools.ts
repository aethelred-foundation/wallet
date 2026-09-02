/**
 * Built-in tool catalog — automation-facing façade for agent wallet actions.
 *
 * Each tool is an `RegisteredTool` the `McpServer` routes JSON-RPC
 * calls to. The catalog mirrors MoltPe's 9-tool surface (check_balance,
 * list_transactions, send_payment, call_x402_endpoint, etc.) but
 * every tool runs behind the policy gate — MoltPe's API-key auth
 * is a single layer; ours is API-auth + per-tool policy + per-agent
 * rate limit + audit.
 *
 * This file provides the ABSTRACT tool factories. Concrete
 * deployments wire them to their own signer + audit + policy
 * instances at server-construction time.
 *
 * Tool list:
 *
 *   check_balance       — read USDC balance on a network.
 *   list_transactions   — recent on-chain transactions for the agent.
 *   agent_info          — agent identity, spending caps, attestation.
 *   send_payment        — direct USDC transfer.
 *   call_x402_endpoint  — pay + fetch an x402-protected URL.
 *   check_policy        — preview what policy would say for a call.
 */

import type { RegisteredTool, ToolHandlerOutput } from "./types";
import { ToolValidationError } from "./errors";

/**
 * Service contract: a minimal "wallet runtime" the tools need.
 * Deployment wires concrete implementations — e.g. an extension
 * that uses @aethelred/wallet-core, or a Nitro enclave service
 * that uses its own custody backend.
 */
export interface WalletRuntime {
  /** USDC balance in smallest units (6 decimals) as string. */
  getBalance(input: {
    readonly network: string;
    readonly agentId: string;
  }): Promise<{ readonly balance: string; readonly decimals: number }>;

  /** Recent transactions for the agent. */
  listTransactions(input: {
    readonly agentId: string;
    readonly limit?: number;
  }): Promise<ReadonlyArray<{
    readonly txHash: string;
    readonly network: string;
    readonly to: string;
    readonly amount: string;
    readonly status: "pending" | "confirmed" | "failed";
    readonly timestamp: number;
  }>>;

  /** Static agent identity info. */
  getAgentInfo(agentId: string): Promise<{
    readonly agentId: string;
    readonly addresses: Readonly<Record<string, string>>;
    readonly dailyLimitUsd: number;
    readonly dailyUsedUsd: number;
    readonly teeAttested: boolean;
    readonly attestationPlatform?: string;
  }>;

  /** Direct USDC send (no x402). */
  sendPayment(input: {
    readonly agentId: string;
    readonly network: string;
    readonly recipient: string;
    readonly amount: string;
  }): Promise<{
    readonly txHash: string;
    readonly pending: boolean;
  }>;

  /** Pay + fetch an x402 URL. */
  callX402(input: {
    readonly agentId: string;
    readonly url: string;
    readonly method?: string;
    readonly body?: string;
    readonly maxPriceUsdcUnits?: string;
  }): Promise<{
    readonly status: number;
    readonly body: string;
    readonly paymentId?: string;
    readonly amountPaid?: string;
  }>;
}

// ─── Validators ─────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(v: unknown, field: string): string {
  if (typeof v !== "string" || v === "") {
    throw new ToolValidationError(`${field} must be a non-empty string`, { field });
  }
  return v;
}

function optionalString(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    throw new ToolValidationError(`${field} must be a string when present`, { field });
  }
  return v;
}

function optionalPositiveInteger(v: unknown, field: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || !Number.isInteger(v)) {
    throw new ToolValidationError(`${field} must be a positive integer when present`, { field });
  }
  return v;
}

function requireDecimalString(v: unknown, field: string): string {
  const s = requireString(v, field);
  if (!/^\d+$/.test(s)) {
    throw new ToolValidationError(`${field} must be a decimal string (smallest units)`, { field });
  }
  return s;
}

// ─── Tool factories ─────────────────────────────────────────────

export function makeCheckBalanceTool(runtime: WalletRuntime): RegisteredTool {
  return {
    manifest: {
      name: "check_balance",
      description: "Read the agent's USDC balance on a given network. Returns the balance in smallest units and the decimals. Use this to plan how much you can spend before calling paid APIs.",
      inputSchema: {
        type: "object",
        properties: {
          network: {
            type: "string",
            description: "Network slug. One of: base-mainnet, polygon-mainnet, arbitrum-mainnet, optimism-mainnet, ethereum-mainnet (or their -sepolia testnet variants).",
            enum: [
              "base-mainnet", "base-sepolia",
              "polygon-mainnet", "polygon-amoy",
              "arbitrum-mainnet", "arbitrum-sepolia",
              "optimism-mainnet", "optimism-sepolia",
              "ethereum-mainnet", "ethereum-sepolia",
            ],
          },
        },
        required: ["network"],
        additionalProperties: false,
      },
    },
    validate(raw) {
      if (!isObject(raw)) throw new ToolValidationError("arguments must be an object");
      return { network: requireString(raw.network, "network") };
    },
    async handle({ context, args }): Promise<ToolHandlerOutput> {
      const { balance, decimals } = await runtime.getBalance({
        agentId: context.agentId,
        network: args.network as string,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              balance,
              decimals,
              network: args.network,
              usdc: Number(BigInt(balance)) / Math.pow(10, decimals),
            }),
          },
        ],
      };
    },
  };
}

export function makeListTransactionsTool(runtime: WalletRuntime): RegisteredTool {
  return {
    manifest: {
      name: "list_transactions",
      description: "List the agent's recent on-chain transactions. Each entry includes txHash, network, recipient, amount (smallest units), status (pending/confirmed/failed), and timestamp.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: "Maximum number of transactions to return. Default 20.",
            minimum: 1,
            maximum: 100,
          },
        },
        additionalProperties: false,
      },
    },
    validate(raw) {
      if (!isObject(raw)) throw new ToolValidationError("arguments must be an object");
      return { limit: optionalPositiveInteger(raw.limit, "limit") };
    },
    async handle({ context, args }): Promise<ToolHandlerOutput> {
      const txs = await runtime.listTransactions({
        agentId: context.agentId,
        limit: typeof args.limit === "number" ? args.limit : 20,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ transactions: txs, count: txs.length }) }],
      };
    },
  };
}

export function makeAgentInfoTool(runtime: WalletRuntime): RegisteredTool {
  return {
    manifest: {
      name: "agent_info",
      description: "Return the agent's identity metadata: wallet addresses per network, daily USD spending limit and amount used today, and whether the agent is TEE-attested (and on which platform).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    validate() {
      return {};
    },
    async handle({ context }): Promise<ToolHandlerOutput> {
      const info = await runtime.getAgentInfo(context.agentId);
      return { content: [{ type: "text", text: JSON.stringify(info) }] };
    },
  };
}

export function makeSendPaymentTool(runtime: WalletRuntime): RegisteredTool {
  return {
    manifest: {
      name: "send_payment",
      description: "Send USDC to a recipient address on a given network. The amount is in smallest units (6 decimals — 1 USDC = 1000000). Returns the transaction hash and pending/confirmed flag.",
      inputSchema: {
        type: "object",
        properties: {
          network: {
            type: "string",
            enum: [
              "base-mainnet", "base-sepolia",
              "polygon-mainnet", "polygon-amoy",
              "arbitrum-mainnet", "arbitrum-sepolia",
              "optimism-mainnet", "optimism-sepolia",
              "ethereum-mainnet", "ethereum-sepolia",
            ],
          },
          recipient: {
            type: "string",
            description: "Recipient wallet address (0x-prefixed, 42 chars).",
            pattern: "^0x[0-9a-fA-F]{40}$",
          },
          amount: {
            type: "string",
            description: "Amount in smallest units as a decimal string. 1 USDC = 1000000.",
            pattern: "^[0-9]+$",
          },
        },
        required: ["network", "recipient", "amount"],
        additionalProperties: false,
      },
    },
    validate(raw) {
      if (!isObject(raw)) throw new ToolValidationError("arguments must be an object");
      const recipient = requireString(raw.recipient, "recipient");
      if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
        throw new ToolValidationError("recipient must be a 0x-prefixed 40-hex address", {
          field: "recipient",
        });
      }
      return {
        network: requireString(raw.network, "network"),
        recipient,
        amount: requireDecimalString(raw.amount, "amount"),
      };
    },
    async handle({ context, args }): Promise<ToolHandlerOutput> {
      const result = await runtime.sendPayment({
        agentId: context.agentId,
        network: args.network as string,
        recipient: args.recipient as string,
        amount: args.amount as string,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  };
}

export function makeCallX402Tool(runtime: WalletRuntime): RegisteredTool {
  return {
    manifest: {
      name: "call_x402_endpoint",
      description: "Call an x402-protected URL, paying automatically if the server returns 402 Payment Required. Returns the HTTP status, response body, and the payment id + amount paid if a payment was made.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full https:// URL to call." },
          method: {
            type: "string",
            enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
            description: "HTTP method. Defaults to GET.",
          },
          body: { type: "string", description: "Request body (string). Only used for POST/PUT/PATCH." },
          maxPriceUsdcUnits: {
            type: "string",
            description: "Maximum price you are willing to pay, in USDC smallest units. If the server asks more than this, the call is refused.",
            pattern: "^[0-9]+$",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    validate(raw) {
      if (!isObject(raw)) throw new ToolValidationError("arguments must be an object");
      const url = requireString(raw.url, "url");
      if (!/^https?:\/\//.test(url)) {
        throw new ToolValidationError("url must start with http:// or https://", { field: "url" });
      }
      return {
        url,
        method: optionalString(raw.method, "method"),
        body: optionalString(raw.body, "body"),
        maxPriceUsdcUnits: raw.maxPriceUsdcUnits
          ? requireDecimalString(raw.maxPriceUsdcUnits, "maxPriceUsdcUnits")
          : undefined,
      };
    },
    async handle({ context, args }): Promise<ToolHandlerOutput> {
      const result = await runtime.callX402({
        agentId: context.agentId,
        url: args.url as string,
        method: args.method as string | undefined,
        body: args.body as string | undefined,
        maxPriceUsdcUnits: args.maxPriceUsdcUnits as string | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  };
}

/**
 * Convenience factory — returns the standard 5-tool surface.
 * Deployments that want subset / additional tools compose their
 * own array via the individual `make*Tool(runtime)` factories.
 */
export function defaultToolCatalog(runtime: WalletRuntime): ReadonlyArray<RegisteredTool> {
  return [
    makeCheckBalanceTool(runtime),
    makeListTransactionsTool(runtime),
    makeAgentInfoTool(runtime),
    makeSendPaymentTool(runtime),
    makeCallX402Tool(runtime),
  ];
}
