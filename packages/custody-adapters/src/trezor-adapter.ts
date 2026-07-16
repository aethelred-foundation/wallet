/**
 * `TrezorAdapter` — hardware-rooted EIP-712 signing via Trezor.
 *
 * The second hardware device alongside `LedgerHsmAdapter`. Same contract
 * (`CustodyAdapter`), same cut lines:
 *
 *   - `signTypedData(TypedDataRequest)` over the device.
 *   - `requiresUserInteraction: true` so callers show "confirm on your
 *     Trezor" UI.
 *   - Trezor Connect error envelopes → the one `CustodyError` taxonomy.
 *   - `asTypedDataSigner()` narrow for x402's `TypedDataSigner` contract.
 *   - Raw-transaction signing deferred to `@aethelred/wallet-core`.
 *
 * Unlike Ledger (which signs a caller-computed 32-byte digest), Trezor
 * hashes the EIP-712 structure ON-DEVICE for its trusted-display security
 * model — the user sees the decoded fields, not an opaque hash. So this
 * adapter passes the full typed-data structure through and lets the device
 * compute the digest; we only validate the returned signature shape.
 *
 * Dependency-free by design: we do NOT import `@trezor/connect`. The
 * adapter takes a structural `TrezorBackendLike` that the real
 * `TrezorConnect.ethereumSignTypedData` satisfies byte-for-byte, so
 * consumers that never use Trezor pay no peer-dep cost, and the adapter is
 * testable with an injected mock.
 */

import type {
  CustodyAdapter,
  CustodyCapabilities,
  RawTransactionRequest,
  TypedDataRequest,
  TypedDataSigner,
} from "./types";
import { CustodyError, UserRejectedError } from "./errors";
import type { CustodyErrorCode } from "./errors";

/**
 * The EIP-712 payload shape Trezor Connect expects under `data`. Mirrors
 * `TypedDataRequest` one-to-one; declared separately so the mapping is
 * explicit and the request type stays adapter-agnostic.
 */
export interface TrezorTypedData {
  readonly types: Readonly<Record<string, ReadonlyArray<{ name: string; type: string }>>>;
  readonly primaryType: string;
  readonly domain: Readonly<Record<string, unknown>>;
  readonly message: Readonly<Record<string, unknown>>;
}

/** Success envelope from `TrezorConnect.ethereumSignTypedData`. */
export interface TrezorSignSuccess {
  readonly success: true;
  readonly payload: {
    readonly address: string;
    /** 0x-prefixed 65-byte recoverable signature (r || s || v). */
    readonly signature: string;
  };
}

/** Failure envelope from Trezor Connect. `code` is Trezor's error code. */
export interface TrezorSignFailure {
  readonly success: false;
  readonly payload: {
    readonly error: string;
    readonly code?: string;
  };
}

export type TrezorSignResponse = TrezorSignSuccess | TrezorSignFailure;

/**
 * Structural fragment of `TrezorConnect` this adapter relies on. The real
 * `TrezorConnect.ethereumSignTypedData` satisfies it exactly.
 */
export interface TrezorBackendLike {
  ethereumSignTypedData(params: {
    path: string;
    data: TrezorTypedData;
    metamask_v4_compat: boolean;
  }): Promise<TrezorSignResponse>;
}

export interface TrezorAdapterConfig {
  /** A `TrezorConnect`-like backend (real or injected mock). */
  readonly backend: TrezorBackendLike;
  /** BIP-32 HD path for the signing key, e.g. `m/44'/60'/0'/0/0`. */
  readonly path: string;
  /**
   * The Ethereum address the path derives to, required up front so
   * `adapter.address` is synchronous. A device-returned address that
   * disagrees is rejected at signing time (see {@link signTypedData}).
   */
  readonly address: `0x${string}`;
  /** Optional label. Default: "trezor". */
  readonly label?: string;
}

export class TrezorAdapter implements CustodyAdapter {
  readonly address: `0x${string}`;
  readonly capabilities: CustodyCapabilities;

  private readonly backend: TrezorBackendLike;
  private readonly path: string;
  private disposed = false;

  constructor(config: TrezorAdapterConfig) {
    this.backend = config.backend;
    this.path = config.path;
    this.address = config.address;

    this.capabilities = {
      canSignTypedData: true,
      canSignRawTransaction: false, // defer to wallet-core
      canExportPublicKey: false, // address is supplied at construction
      canProduceAttestation: false,
      requiresUserInteraction: true,
      requiresNetworkAccess: false, // WebUSB/WebHID is local
      label: config.label ?? "trezor",
    };
  }

  async signTypedData(req: TypedDataRequest): Promise<`0x${string}`> {
    this.ensureAlive();

    let res: TrezorSignResponse;
    try {
      res = await this.backend.ethereumSignTypedData({
        path: this.path,
        data: {
          types: req.types as TrezorTypedData["types"],
          primaryType: req.primaryType,
          domain: req.domain as Readonly<Record<string, unknown>>,
          message: req.message,
        },
        metamask_v4_compat: true,
      });
    } catch (cause) {
      // A thrown error (transport crash) rather than a failure envelope.
      throw this.translateBackendError(cause);
    }

    if (!res.success) {
      throw this.translateFailure(res.payload);
    }

    const { address, signature } = res.payload;

    // The device must have signed with the key we advertised. Guard against
    // a misconfigured path silently signing with the wrong account.
    if (address.toLowerCase() !== this.address.toLowerCase()) {
      throw new CustodyError(
        "adapter-config-invalid",
        `Trezor signed with ${address}, expected ${this.address} — the configured HD path does not derive the advertised address`,
      );
    }

    // 0x + 65 bytes (r||s||v) = 132 chars.
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      throw new CustodyError(
        "signature-malformed",
        `Trezor returned a malformed signature (${signature.length} chars, expected 132)`,
      );
    }

    return signature.toLowerCase() as `0x${string}`;
  }

  async signRawTransaction(_req: RawTransactionRequest): Promise<`0x${string}`> {
    throw new CustodyError(
      "capability-not-supported",
      "TrezorAdapter.signRawTransaction is intentionally deferred — assemble and sign transactions via @aethelred/wallet-core. The custody-adapters layer covers EIP-712 typed-data signing only.",
    );
  }

  asTypedDataSigner(): TypedDataSigner {
    return {
      address: this.address,
      signTypedData: (req) => this.signTypedData(req),
    };
  }

  async dispose(): Promise<void> {
    // No-op: the caller owns the TrezorConnect session lifecycle.
    this.disposed = true;
  }

  // ─── Private ────────────────────────────────────────────────

  private ensureAlive(): void {
    if (this.disposed) {
      throw new CustodyError("adapter-disposed", "TrezorAdapter has been disposed");
    }
  }

  /** Map a Trezor Connect failure envelope onto a CustodyError. */
  private translateFailure(payload: TrezorSignFailure["payload"]): CustodyError {
    const code = this.trezorCodeToCustody(payload.code, payload.error);
    if (code === "user-rejected") {
      return new UserRejectedError(this.capabilities.label, payload.error);
    }
    return new CustodyError(code, `Trezor signing failed: ${payload.error}`);
  }

  /** Map a thrown transport error (not a failure envelope) onto a CustodyError. */
  private translateBackendError(cause: unknown): CustodyError {
    if (cause instanceof CustodyError) return cause;
    const message =
      cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "unknown";
    const code = (cause as { code?: unknown })?.code;
    return new CustodyError(
      this.trezorCodeToCustody(typeof code === "string" ? code : undefined, message),
      `Trezor signing failed: ${message}`,
      { cause },
    );
  }

  /**
   * Trezor Connect error codes / messages → CustodyError taxonomy. Codes
   * are matched first (stable); message substrings are the fallback for
   * envelopes that carry only `error` text.
   */
  private trezorCodeToCustody(code: string | undefined, message: string): CustodyErrorCode {
    const byCode: Record<string, CustodyErrorCode> = {
      Failure_ActionCancelled: "user-rejected",
      Method_Cancel: "user-rejected",
      Failure_PinCancelled: "user-rejected",
      Device_NotFound: "device-not-connected",
      Transport_Missing: "device-not-connected",
      Device_Disconnected: "device-not-connected",
      Device_UsedElsewhere: "device-busy",
      Device_CallInProgress: "device-busy",
      Failure_PinInvalid: "session-locked",
      Device_InvalidState: "session-locked",
      Method_InvalidPackage: "firmware-too-old",
      Failure_UnexpectedMessage: "signing-failed",
    };
    if (code && byCode[code]) return byCode[code];

    const m = message.toLowerCase();
    if (m.includes("cancel") || m.includes("rejected") || m.includes("denied")) return "user-rejected";
    if (m.includes("not found") || m.includes("no device") || m.includes("disconnect")) return "device-not-connected";
    if (m.includes("in progress") || m.includes("used in another") || m.includes("busy")) return "device-busy";
    if (m.includes("pin") || m.includes("locked")) return "session-locked";
    if (m.includes("firmware") || m.includes("update")) return "firmware-too-old";
    return "signing-failed";
  }
}
