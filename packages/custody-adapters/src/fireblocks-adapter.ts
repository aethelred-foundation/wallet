/**
 * `FireblocksAdapter` — MPC-backed EIP-712 signing via Fireblocks REST.
 *
 * Fireblocks runs a multi-party-computation (MPC) cohort: the private key
 * is split across multiple nodes that jointly compute signatures without
 * any single node ever reconstructing the full key. From our caller's
 * perspective it looks like a remote signing service over HTTPS:
 *
 *   1. POST `/v1/transactions` with `operation=TYPED_MESSAGE` and the
 *      EIP-712 payload (or a pre-computed digest when `content.type ==
 *      EIP712`).
 *   2. Poll GET `/v1/transactions/{id}` until status terminates.
 *   3. Extract the signature from the `signedMessages[0].signature` field.
 *
 * We expose a pluggable `FireblocksClient` interface so deployments can
 * plug in whatever HTTP client they prefer (undici in Node, fetch in
 * browsers, their existing SDK wrapper, a test mock). The adapter itself
 * stays I/O-agnostic.
 *
 * MoltPe parity: they also use Fireblocks-style MPC for one of their tiers.
 * Feature-parity here means we can drop-in replace their signing path for
 * any customer already on Fireblocks. The differentiation shows up further
 * up the stack (x402 attestation, agent delegation, intent router).
 *
 * ⚠ This is a stub / skeleton. It models the request/response shape and
 * the polling loop but does NOT ship production-grade JWT signing,
 * retry + idempotency, or metrics. Before a production deployment,
 * wire in:
 *
 *   - RS256-signed JWT with `exp`, `nonce`, `sub = apiKey`, `bodyHash`.
 *   - Exponential backoff on 429 and 5xx (respect `Retry-After`).
 *   - Idempotency-key header derived from `(vaultAccountId, digest)`.
 *   - Prometheus + OTel metrics tied through the observability package.
 *   - Signature-recovery cross-check against `config.address` (same
 *     defense-in-depth as the Nitro adapter).
 */

import type {
  CustodyAdapter,
  CustodyCapabilities,
  RawTransactionRequest,
  TypedDataRequest,
  TypedDataSigner,
} from "./types";
import { computeTypedDataDigest } from "./eip712-hash";
import {
  CustodyError,
  RemoteApiError,
  UserRejectedError,
} from "./errors";

/** Fireblocks transaction status values we care about. Values match
 * Fireblocks' public enum strings — see their OpenAPI. */
export type FireblocksTxStatus =
  | "SUBMITTED"
  | "QUEUED"
  | "PENDING_SIGNATURE"
  | "PENDING_AUTHORIZATION"
  | "BROADCASTING"
  | "CONFIRMING"
  | "CONFIRMED"
  | "COMPLETED"
  | "FAILED"
  | "REJECTED"
  | "BLOCKED"
  | "CANCELLED"
  | "CANCELLING"
  | "TIMEOUT";

/** Request body for Fireblocks' create-transaction API. The subset we use. */
export interface FireblocksCreateRequest {
  readonly operation: "TYPED_MESSAGE";
  readonly source: { readonly type: "VAULT_ACCOUNT"; readonly id: string };
  readonly assetId: string;
  readonly extraParameters: {
    readonly rawMessageData: {
      readonly messages: ReadonlyArray<{
        /** Pre-computed EIP-712 digest (32 bytes, hex with 0x prefix). */
        readonly content: `0x${string}`;
        readonly type: "EIP712";
      }>;
    };
  };
  readonly note?: string;
}

export interface FireblocksCreateResponse {
  readonly id: string;
  readonly status: FireblocksTxStatus;
}

export interface FireblocksStatusResponse {
  readonly id: string;
  readonly status: FireblocksTxStatus;
  readonly signedMessages?: ReadonlyArray<{
    readonly content: `0x${string}`;
    readonly signature?: {
      readonly fullSig: `0x${string}` | string;
      readonly r?: string;
      readonly s?: string;
      readonly v?: number;
    };
  }>;
  readonly subStatus?: string;
}

/**
 * Pluggable transport to Fireblocks. Implementations are free to attach
 * JWT auth, telemetry, retries — this interface exposes only the request-
 * response shape the adapter needs.
 */
export interface FireblocksClient {
  createTransaction(body: FireblocksCreateRequest): Promise<FireblocksCreateResponse>;
  getTransaction(id: string): Promise<FireblocksStatusResponse>;
}

export interface FireblocksAdapterConfig {
  /** Fireblocks vault account id that holds the signing key. */
  readonly vaultAccountId: string;
  /** Fireblocks asset id (e.g. "ETH_TEST5", "USDC_ETH"). */
  readonly assetId: string;
  /** Ethereum address the vault account's key derives to. */
  readonly address: `0x${string}`;
  /** HTTP client. Wire a real one for production; a mock for tests. */
  readonly client: FireblocksClient;
  /** Polling interval in ms. Default: 1500. */
  readonly pollIntervalMs?: number;
  /** Max polling wall-clock time in ms. Default: 120000 (2 minutes). */
  readonly pollTimeoutMs?: number;
  /** Optional label. Default: "fireblocks-mpc". */
  readonly label?: string;
}

export class FireblocksAdapter implements CustodyAdapter {
  readonly address: `0x${string}`;
  readonly capabilities: CustodyCapabilities;

  private readonly vaultAccountId: string;
  private readonly assetId: string;
  private readonly client: FireblocksClient;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private disposed = false;

  constructor(config: FireblocksAdapterConfig) {
    this.address = config.address;
    this.vaultAccountId = config.vaultAccountId;
    this.assetId = config.assetId;
    this.client = config.client;
    this.pollIntervalMs = config.pollIntervalMs ?? 1500;
    this.pollTimeoutMs = config.pollTimeoutMs ?? 120_000;

    this.capabilities = {
      canSignTypedData: true,
      canSignRawTransaction: false,
      canExportPublicKey: true,
      canProduceAttestation: false,
      requiresUserInteraction: false, // Fireblocks Console approval is async out-of-band
      requiresNetworkAccess: true,
      label: config.label ?? "fireblocks-mpc",
    };
  }

  async signTypedData(req: TypedDataRequest): Promise<`0x${string}`> {
    this.ensureAlive();
    const digest = computeTypedDataDigest(req);
    const digestHex = `0x${bytesToHex(digest)}` as `0x${string}`;

    let created: FireblocksCreateResponse;
    try {
      created = await this.client.createTransaction({
        operation: "TYPED_MESSAGE",
        source: { type: "VAULT_ACCOUNT", id: this.vaultAccountId },
        assetId: this.assetId,
        extraParameters: {
          rawMessageData: {
            messages: [{ content: digestHex, type: "EIP712" }],
          },
        },
        note: "aethelred-custody-adapters EIP-712 sign",
      });
    } catch (cause) {
      throw new RemoteApiError(
        `Fireblocks createTransaction failed: ${errorMessage(cause)}`,
        { cause },
      );
    }

    const terminal = await this.pollForTerminal(created.id);
    return this.extractSignature(terminal);
  }

  async signRawTransaction(_req: RawTransactionRequest): Promise<`0x${string}`> {
    throw new CustodyError(
      "capability-not-supported",
      "FireblocksAdapter.signRawTransaction not wired in this stub — use the Fireblocks `CONTRACT_CALL` or `TRANSFER` operations via your own Fireblocks client and defer raw-tx assembly to @aethelred/wallet-core.",
    );
  }

  asTypedDataSigner(): TypedDataSigner {
    return {
      address: this.address,
      signTypedData: (req) => this.signTypedData(req),
    };
  }

  async dispose(): Promise<void> {
    // Clients manage their own connection pools; nothing to tear down
    // here beyond marking the adapter unusable.
    this.disposed = true;
  }

  // ─── Private ────────────────────────────────────────────────

  private ensureAlive(): void {
    if (this.disposed) {
      throw new CustodyError("adapter-disposed", "FireblocksAdapter has been disposed");
    }
  }

  private async pollForTerminal(id: string): Promise<FireblocksStatusResponse> {
    const deadline = Date.now() + this.pollTimeoutMs;
    for (;;) {
      let status: FireblocksStatusResponse;
      try {
        status = await this.client.getTransaction(id);
      } catch (cause) {
        throw new RemoteApiError(
          `Fireblocks getTransaction(${id}) failed: ${errorMessage(cause)}`,
          { cause },
        );
      }

      if (isTerminal(status.status)) return status;

      if (Date.now() >= deadline) {
        throw new CustodyError(
          "remote-api-timeout",
          `Fireblocks tx ${id} did not reach terminal status within ${this.pollTimeoutMs}ms (last: ${status.status})`,
          { details: { txId: id, lastStatus: status.status } },
        );
      }
      await sleep(this.pollIntervalMs);
    }
  }

  private extractSignature(status: FireblocksStatusResponse): `0x${string}` {
    switch (status.status) {
      case "COMPLETED":
      case "CONFIRMED":
      case "BROADCASTING":
      case "CONFIRMING":
        break;
      case "REJECTED":
      case "BLOCKED":
      case "CANCELLED":
      case "CANCELLING":
        throw new UserRejectedError(
          this.capabilities.label,
          `Fireblocks tx ${status.id} was ${status.status}: ${status.subStatus ?? "no sub-status"}`,
        );
      case "FAILED":
      case "TIMEOUT":
      default:
        throw new CustodyError(
          "signing-failed",
          `Fireblocks tx ${status.id} terminated as ${status.status}: ${status.subStatus ?? "no sub-status"}`,
          { details: { txId: status.id, subStatus: status.subStatus } },
        );
    }

    const msg = status.signedMessages?.[0];
    if (!msg?.signature) {
      throw new CustodyError(
        "signing-failed",
        `Fireblocks tx ${status.id} completed but returned no signature`,
      );
    }
    const sig = msg.signature;

    // Fireblocks sometimes returns fullSig (r||s concatenated, no v) and
    // separate v. Normalize to the 0x-prefixed r||s||v form we expect.
    if (typeof sig.fullSig === "string" && sig.fullSig.length === 128 + 2 && typeof sig.v === "number") {
      // fullSig is `0x` + 128 hex chars = r || s. Append v byte.
      const vHex = (27 + sig.v).toString(16).padStart(2, "0");
      return `${sig.fullSig}${vHex}` as `0x${string}`;
    }
    if (typeof sig.r === "string" && typeof sig.s === "string" && typeof sig.v === "number") {
      const r = strip0x(sig.r).padStart(64, "0");
      const s = strip0x(sig.s).padStart(64, "0");
      const vHex = (27 + sig.v).toString(16).padStart(2, "0");
      return `0x${r}${s}${vHex}` as `0x${string}`;
    }
    if (typeof sig.fullSig === "string" && (sig.fullSig as string).length === 132) {
      // Already 65 bytes with v included — pass through.
      return sig.fullSig as `0x${string}`;
    }
    throw new CustodyError(
      "signature-malformed",
      `Fireblocks tx ${status.id} returned signature in an unexpected shape (fullSig=${typeof sig.fullSig} r=${typeof sig.r} s=${typeof sig.s} v=${typeof sig.v})`,
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function isTerminal(s: FireblocksTxStatus): boolean {
  return (
    s === "COMPLETED" ||
    s === "CONFIRMED" ||
    s === "BROADCASTING" ||
    s === "CONFIRMING" ||
    s === "FAILED" ||
    s === "REJECTED" ||
    s === "BLOCKED" ||
    s === "CANCELLED" ||
    s === "CANCELLING" ||
    s === "TIMEOUT"
  );
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return "unknown";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function strip0x(v: string): string {
  return v.startsWith("0x") ? v.slice(2) : v;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}
