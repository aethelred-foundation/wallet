/**
 * Minimal JSON-RPC transport.
 *
 * Hand-rolled because the call surface we need is tiny — three
 * methods total — and adding viem/ethers pulls ~2 MB of transitive
 * deps into the extension bundle. This file is ~60 LOC, zero deps,
 * and production consumers can swap it for a viem-backed
 * `JsonRpcTransport` with identical semantics if they prefer.
 *
 * Every method:
 *   - Uses `fetch` (globally available in Node ≥18 / browsers).
 *   - Serialises via `JSON.stringify` with a request-id counter for
 *     correlation.
 *   - Rejects with a typed `JsonRpcError` on non-2xx HTTP or on a
 *     JSON-RPC error response. Callers branch on `.code` / `.data`.
 *
 * Not a general-purpose client — no batching, no subscriptions, no
 * request queueing. For those, swap to viem/ethers.
 */

export interface JsonRpcTransport {
  call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T>;
}

export interface FetchJsonRpcTransportConfig {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Custom fetch for tests. Defaults to `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export class FetchJsonRpcTransport implements JsonRpcTransport {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private nextId = 1;

  constructor(config: FetchJsonRpcTransportConfig) {
    this.url = config.url;
    this.headers = { "content-type": "application/json", ...(config.headers ?? {}) };
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  async call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T> {
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: this.headers,
        body,
        signal: controller.signal,
      });
    } catch (cause) {
      throw new JsonRpcError(
        "transport-failed",
        cause instanceof Error ? cause.message : "fetch rejected",
        { cause },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new JsonRpcError(
        "http-status",
        `RPC HTTP ${response.status} ${response.statusText}`,
        { status: response.status },
      );
    }

    let parsed: { result?: T; error?: { code: number; message: string; data?: unknown } };
    try {
      parsed = (await response.json()) as typeof parsed;
    } catch (cause) {
      throw new JsonRpcError("malformed-response", "non-JSON RPC response", { cause });
    }

    if (parsed.error) {
      throw new JsonRpcError(
        "rpc-error",
        `JSON-RPC error ${parsed.error.code}: ${parsed.error.message}`,
        { rpcCode: parsed.error.code, rpcData: parsed.error.data },
      );
    }

    return parsed.result as T;
  }
}

// ─── Typed error ────────────────────────────────────────

export type JsonRpcErrorCode =
  | "transport-failed"
  | "http-status"
  | "malformed-response"
  | "rpc-error";

export class JsonRpcError extends Error {
  readonly code: JsonRpcErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  constructor(
    code: JsonRpcErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.details = details;
  }
}
