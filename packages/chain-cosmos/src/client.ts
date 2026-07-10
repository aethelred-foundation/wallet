/**
 * Minimal LCD (gRPC-gateway REST) client for Aethelred's native side.
 *
 * Talks to the node's REST API (default port 1317) for the four operations
 * the native tx path needs: account lookup (account_number + sequence),
 * balance reads, broadcast, and confirmation polling. `fetch` is injectable
 * so tests run hermetically and the extension can route through its own
 * network layer.
 *
 * Account-shape note: aethelredd (cosmos/evm v0.6) uses plain
 * `BaseAccount`s, but some cosmos/evm-family chains wrap them in an
 * `EthAccount { base_account }`. `getAccount` handles both shapes so the
 * client works across the namespace.
 */

import type { Coin } from "./messages";

/** Error thrown for transport, HTTP, or malformed-response failures. */
export class CosmosLcdError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CosmosLcdError";
  }
}

/** On-chain signer state needed to build a SignDoc. */
export interface AccountInfo {
  readonly accountNumber: bigint;
  readonly sequence: bigint;
}

/** Result of a sync broadcast (CheckTx acceptance, not execution). */
export interface BroadcastResult {
  readonly txHash: string;
  /** 0 = accepted into the mempool; non-zero = rejected, see rawLog. */
  readonly code: number;
  readonly rawLog: string;
}

/** Result of a confirmed (executed) transaction. */
export interface TxResult {
  readonly height: bigint;
  /** 0 = execution success; non-zero = failed, see rawLog. */
  readonly code: number;
  readonly rawLog: string;
}

/** Standard-library-free base64 (extension/service-worker safe). */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2] + B64[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[b2 & 0x3f] : "=";
  }
  return out;
}

/** Injectable primitives (hermetic tests; custom network layers). */
export interface LcdClientOptions {
  readonly baseUrl: string;
  readonly fetchFn?: typeof fetch;
  readonly sleepFn?: (ms: number) => Promise<void>;
}

export class CosmosLcdClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options: LcdClientOptions) {
    // Normalize away a trailing slash so path joins are unambiguous.
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleepFn =
      options.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async getJson(path: string): Promise<Record<string, unknown>> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new CosmosLcdError(
        `GET ${path} failed: HTTP ${res.status}`,
        res.status,
      );
    }
    return (await res.json()) as Record<string, unknown>;
  }

  /**
   * Fetch `account_number` + `sequence` for an `aethel1…` address.
   * Handles both plain `BaseAccount` and nested `EthAccount.base_account`.
   */
  async getAccount(address: string): Promise<AccountInfo> {
    const json = await this.getJson(
      `/cosmos/auth/v1beta1/accounts/${address}`,
    );
    const account = json.account as Record<string, unknown> | undefined;
    if (!account) {
      throw new CosmosLcdError(`no account in response for ${address}`);
    }
    const base =
      (account.base_account as Record<string, unknown> | undefined) ?? account;
    const accountNumber = base.account_number;
    const sequence = base.sequence;
    if (typeof accountNumber !== "string" || typeof sequence !== "string") {
      throw new CosmosLcdError(
        `malformed account response for ${address}: missing account_number/sequence`,
      );
    }
    return { accountNumber: BigInt(accountNumber), sequence: BigInt(sequence) };
  }

  /** All native balances of an address. */
  async getBalances(address: string): Promise<Coin[]> {
    const json = await this.getJson(
      `/cosmos/bank/v1beta1/balances/${address}`,
    );
    const balances = (json.balances ?? []) as Array<{
      denom: string;
      amount: string;
    }>;
    return balances.map((b) => ({ denom: b.denom, amount: b.amount }));
  }

  /** Balance of one denom (0 when the account holds none of it). */
  async getBalance(address: string, denom: string): Promise<Coin> {
    const balances = await this.getBalances(address);
    return (
      balances.find((b) => b.denom === denom) ?? { denom, amount: "0" }
    );
  }

  /**
   * Broadcast a signed `TxRaw` in SYNC mode: the result reflects CheckTx
   * (mempool acceptance). Execution is confirmed via {@link waitForTx}.
   */
  async broadcastTx(txRawBytes: Uint8Array): Promise<BroadcastResult> {
    const res = await this.fetchFn(`${this.baseUrl}/cosmos/tx/v1beta1/txs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tx_bytes: toBase64(txRawBytes),
        mode: "BROADCAST_MODE_SYNC",
      }),
    });
    if (!res.ok) {
      throw new CosmosLcdError(
        `broadcast failed: HTTP ${res.status}`,
        res.status,
      );
    }
    const json = (await res.json()) as {
      tx_response?: { txhash?: string; code?: number; raw_log?: string };
    };
    const tx = json.tx_response;
    if (!tx?.txhash) {
      throw new CosmosLcdError("malformed broadcast response: no tx_response");
    }
    return {
      txHash: tx.txhash,
      code: tx.code ?? 0,
      rawLog: tx.raw_log ?? "",
    };
  }

  /**
   * Poll until the tx is executed (found in a block) or `timeoutMs` elapses.
   */
  async waitForTx(
    txHash: string,
    options?: { timeoutMs?: number; pollMs?: number },
  ): Promise<TxResult> {
    const timeoutMs = options?.timeoutMs ?? 30_000;
    const pollMs = options?.pollMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await this.fetchFn(
        `${this.baseUrl}/cosmos/tx/v1beta1/txs/${txHash}`,
      );
      if (res.ok) {
        const json = (await res.json()) as {
          tx_response?: { height?: string; code?: number; raw_log?: string };
        };
        const tx = json.tx_response;
        if (tx?.height !== undefined) {
          return {
            height: BigInt(tx.height),
            code: tx.code ?? 0,
            rawLog: tx.raw_log ?? "",
          };
        }
      } else if (res.status !== 404 && res.status !== 400) {
        // 404/400 = not yet indexed (LCD returns either while pending);
        // anything else is a real transport/server failure.
        throw new CosmosLcdError(
          `tx lookup failed: HTTP ${res.status}`,
          res.status,
        );
      }
      if (Date.now() >= deadline) {
        throw new CosmosLcdError(
          `tx ${txHash} not confirmed within ${timeoutMs}ms`,
        );
      }
      await this.sleepFn(pollMs);
    }
  }
}
