/**
 * JSON-RPC 2.0 client for Ethereum-compatible chains.
 * Handles retries, rate limiting, timeout, and fallback endpoints.
 */

export interface RpcRequest {
  method: string;
  params?: unknown[];
}

interface RpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface RpcClientConfig {
  url: string;
  fallbackUrls?: string[];
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/**
 * Ethereum JSON-RPC client with retry logic, timeout, and fallback endpoints.
 */
export class RpcClient {
  private requestId = 0;
  private readonly config: Required<RpcClientConfig>;
  private activeUrl: string;

  constructor(config: RpcClientConfig) {
    this.config = {
      url: config.url,
      fallbackUrls: config.fallbackUrls ?? [],
      timeoutMs: config.timeoutMs ?? 15_000,
      maxRetries: config.maxRetries ?? 3,
      retryDelayMs: config.retryDelayMs ?? 1000,
    };
    this.activeUrl = this.config.url;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const allUrls = [this.config.url, ...this.config.fallbackUrls];

    for (let urlIdx = 0; urlIdx < allUrls.length; urlIdx++) {
      const url = allUrls[urlIdx];

      for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
        try {
          const result = await this.sendRequest<T>(url, method, params);
          this.activeUrl = url;
          return result;
        } catch (error) {
          // Don't retry on user/application errors (4xxx codes)
          if (error instanceof RpcError && error.code >= 4000 && error.code < 5000) {
            throw error;
          }

          const isLastAttempt = attempt === this.config.maxRetries;
          const isLastUrl = urlIdx === allUrls.length - 1;

          if (isLastAttempt && isLastUrl) throw error;
          if (isLastAttempt) break; // Try next URL

          await this.delay(this.config.retryDelayMs * (attempt + 1));
        }
      }
    }

    throw new RpcError(-32603, "All RPC endpoints exhausted");
  }

  async batch(requests: RpcRequest[]): Promise<unknown[]> {
    const body = requests.map((req) => ({
      jsonrpc: "2.0" as const,
      id: ++this.requestId,
      method: req.method,
      params: req.params ?? [],
    }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(this.activeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new RpcError(-32603, `HTTP ${response.status}: ${response.statusText}`);
      }

      const results = (await response.json()) as RpcResponse[];
      return results.map((r) => {
        if (r.error) throw new RpcError(r.error.code, r.error.message, r.error.data);
        return r.result;
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  getActiveUrl(): string {
    return this.activeUrl;
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.call<string>("eth_chainId");
      return true;
    } catch {
      return false;
    }
  }

  private async sendRequest<T>(url: string, method: string, params: unknown[]): Promise<T> {
    const id = ++this.requestId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new RpcError(-32603, `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as RpcResponse<T>;

      if (data.error) {
        throw new RpcError(data.error.code, data.error.message, data.error.data);
      }

      return data.result as T;
    } catch (error) {
      if (error instanceof RpcError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new RpcError(-32603, `Request timeout after ${this.config.timeoutMs}ms`);
      }
      throw new RpcError(-32603, `Network error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
