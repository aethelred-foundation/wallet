/**
 * Paymaster abstractions for ERC-4337 v0.7.
 *
 * A paymaster is a contract that pays a UserOperation's gas bill in
 * exchange for some off-chain obligation (usage tier, fiat settlement,
 * etc.). The two roles involved are:
 *
 *  - The on-chain paymaster contract (address + packed data).
 *  - The off-chain sponsor service that decides whether to sponsor a
 *    given UserOperation, then returns a signature the on-chain
 *    paymaster will validate.
 *
 * This module defines the {@link Paymaster} interface all wallet
 * flows program against, plus a concrete {@link VerifyingPaymasterClient}
 * that talks to a remote sponsor via JSON-RPC. Additional paymaster
 * types (deposit-paymasters, session-key paymasters) can ship later
 * by implementing {@link Paymaster}.
 */

import type { UserOperation } from "./types";
import { serializeUserOperation } from "./bundler-client";
import { BundlerError } from "./errors";

/* ────────────────────────────────────────────────────────────── *
 * Common interface
 * ────────────────────────────────────────────────────────────── */

/**
 * Paymaster fields the builder needs to attach to a UserOperation.
 *
 * Shape mirrors the optional fields on {@link UserOperation} so the
 * caller can splat the result directly into
 * {@link UserOperationBuilder.setPaymaster}.
 */
export interface PaymasterSponsorship {
  paymaster: `0x${string}`;
  paymasterData: `0x${string}`;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
}

/**
 * Minimal paymaster contract consumed by {@link UserOperationBuilder}.
 *
 * @example
 * ```ts
 * const sponsorship = await paymaster.sponsorUserOperation(op);
 * builder.setPaymaster({ paymaster: sponsorship.paymaster, ... });
 * ```
 */
export interface Paymaster {
  /** Paymaster contract address. Constant for a given paymaster. */
  getAddress(): `0x${string}`;
  /**
   * Produce the paymaster fields for a UserOperation, possibly calling
   * out to a remote sponsor service.
   */
  sponsorUserOperation(op: UserOperation): Promise<PaymasterSponsorship>;
}

/* ────────────────────────────────────────────────────────────── *
 * VerifyingPaymaster client
 * ────────────────────────────────────────────────────────────── */

/** Config accepted by {@link VerifyingPaymasterClient}. */
export interface VerifyingPaymasterClientConfig {
  /** The paymaster contract's on-chain address. */
  address: `0x${string}`;
  /** JSON-RPC endpoint of the off-chain sponsor service. */
  sponsorUrl: string;
  /** Optional custom headers (e.g. API key auth). */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds. Defaults to 30_000. */
  timeout?: number;
  /** Optional custom `fetch` — handy for tests. */
  fetchImpl?: typeof fetch;
  /**
   * JSON-RPC method name the sponsor exposes. Defaults to the
   * alchemy/pimlico convention of `"pm_sponsorUserOperation"`.
   */
  method?: string;
}

/**
 * Minimal JSON-RPC client that asks a VerifyingPaymaster sponsor
 * service to attach a signature to a UserOperation.
 *
 * The sponsor is expected to return an object of the form:
 *
 * ```json
 * {
 *   "paymaster": "0x...",
 *   "paymasterData": "0x...",
 *   "paymasterVerificationGasLimit": "0x...",
 *   "paymasterPostOpGasLimit": "0x..."
 * }
 * ```
 *
 * This matches the Pimlico / Alchemy convention for ERC-4337 v0.7
 * verifying paymasters. If the sponsor uses a different shape, wrap
 * it in a thin {@link Paymaster} adapter rather than modifying this
 * class.
 */
export class VerifyingPaymasterClient implements Paymaster {
  private readonly address: `0x${string}`;
  private readonly sponsorUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;
  private readonly fetchImpl: typeof fetch;
  private readonly method: string;
  private nextRequestId = 1;

  constructor(config: VerifyingPaymasterClientConfig) {
    this.address = config.address;
    this.sponsorUrl = config.sponsorUrl;
    this.headers = { ...(config.headers ?? {}) };
    this.timeout = config.timeout ?? 30_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.method = config.method ?? "pm_sponsorUserOperation";
  }

  /** Paymaster contract address. */
  getAddress(): `0x${string}` {
    return this.address;
  }

  /**
   * Ask the remote sponsor to produce the paymaster fields for `op`.
   *
   * The UserOperation is serialised to JSON via the same path the
   * bundler client uses (so hex encodings stay consistent) and posted
   * to `sponsorUrl`.
   */
  async sponsorUserOperation(op: UserOperation): Promise<PaymasterSponsorship> {
    const body = {
      jsonrpc: "2.0" as const,
      id: this.nextRequestId++,
      method: this.method,
      params: [serializeUserOperation(op), this.address],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    let response: Response;
    try {
      response = await this.fetchImpl(this.sponsorUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as { name?: string })?.name === "AbortError") {
        throw new BundlerError({
          code: -32603,
          message: `paymaster request timed out after ${this.timeout}ms`,
        });
      }
      throw new BundlerError({
        code: -32603,
        message: `paymaster fetch failed: ${(err as Error).message}`,
      });
    }
    clearTimeout(timer);

    if (!response.ok) {
      throw new BundlerError({
        code: -32603,
        message: `paymaster returned HTTP ${response.status}`,
      });
    }

    const json = (await response.json()) as {
      error?: { code: number; message: string; data?: unknown };
      result?: Record<string, string>;
    };
    if (json.error) {
      throw new BundlerError(json.error);
    }
    if (!json.result) {
      throw new BundlerError({
        code: -32603,
        message: "paymaster response missing result",
      });
    }

    return {
      paymaster: (json.result.paymaster ?? this.address) as `0x${string}`,
      paymasterData: json.result.paymasterData as `0x${string}`,
      paymasterVerificationGasLimit: parseHexBigInt(
        json.result.paymasterVerificationGasLimit,
      ),
      paymasterPostOpGasLimit: parseHexBigInt(
        json.result.paymasterPostOpGasLimit,
      ),
    };
  }
}

function parseHexBigInt(hex: string | undefined): bigint {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}
