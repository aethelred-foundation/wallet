/**
 * `LedgerHsmAdapter` — hardware-rooted EIP-712 signing via Ledger.
 *
 * This is a thin bridge over `@aethelred/wallet-core`'s existing
 * `HardwareWalletBackend` (packages/core/src/custody/hardware.ts).
 * The backend already:
 *
 *   - Opens the WebHID transport.
 *   - Handles the Chrome permission prompt.
 *   - Registers key slots against HD paths.
 *   - Translates Ledger status codes into a typed-error taxonomy.
 *   - Signs 32-byte digests via Ledger's `signEIP712HashedMessage`
 *     instruction (firmware ≥ 1.9 on the Ethereum app).
 *
 * What this adapter adds is the CustodyAdapter surface:
 *
 *   - `signTypedData(TypedDataRequest)` instead of `sign(keySlotId, digest)`.
 *   - Capability descriptor saying `requiresUserInteraction: true` so x402
 *     callers can show "confirm on your device" UI.
 *   - `HardwareWalletError → CustodyError` translation so the x402 client
 *     and MCP server only have to branch on one error taxonomy.
 *   - `asTypedDataSigner()` narrow for direct use in x402's `TypedDataSigner`
 *     contract.
 *
 * We deliberately do NOT manage the connect / registerDevice lifecycle here:
 *
 *   - Callers already own the WebHID permission flow (the browser insists
 *     on a user-gesture prompt anyway).
 *   - The backend is typically shared across multiple slots (multi-account
 *     wallets, smart-account signer + owner).
 *   - Separating setup from signing keeps this adapter pure wrt custody:
 *     construct with a ready backend + slot, it just signs.
 *
 * Raw-transaction signing is intentionally deferred to the backend directly.
 * Callers that need `signTransaction` should use `HardwareWalletBackend.
 * signTransactionBytes` — nonce / chainId / gas management belongs in
 * `@aethelred/wallet-core`, not in an adapter wrapper. Keeping this cut line
 * clean also makes the adapter testable without dragging transaction-
 * assembly state into the tests.
 */

import type {
  CustodyAdapter,
  CustodyCapabilities,
  RawTransactionRequest,
  TypedDataRequest,
  TypedDataSigner,
} from "./types";
import { computeTypedDataDigest } from "./eip712-hash";
import { CustodyError, UserRejectedError } from "./errors";
import type { CustodyErrorCode } from "./errors";

/**
 * Structural shape of the fragment of `HardwareWalletBackend` we rely on.
 * Declared here (instead of imported from `@aethelred/wallet-core`) to
 * avoid taking a hard dependency on the core package at compile time —
 * consumers that don't use Ledger never pay for the `@ledgerhq/*` peer
 * deps. The backend satisfies this shape byte-for-byte.
 */
export interface LedgerBackendLike {
  /**
   * Sign a 32-byte digest with the key registered at `keySlotId`. Returns
   * a 65-byte recoverable signature (r || s || v, with v = 27 + recovery).
   */
  sign(keySlotId: string, digest: Uint8Array): Promise<Uint8Array>;
  /**
   * Return the compressed public key (33 bytes) for a registered slot.
   * Optional — not used in the hot path but exposed for callers that want
   * to verify the slot before signing.
   */
  getPublicKey?(keySlotId: string): Promise<Uint8Array>;
}

export interface LedgerHsmAdapterConfig {
  /** A connected + slot-registered `HardwareWalletBackend` or equivalent. */
  readonly backend: LedgerBackendLike;
  /** The key slot id to sign with. */
  readonly keySlotId: string;
  /**
   * The Ethereum address the registered slot derives to. We require this
   * up front so `adapter.address` works synchronously without roundtripping
   * to the device. Mismatch between config and device WILL be caught at
   * signing time if the device's signature fails to recover to this
   * address (callers should wire a recovery-check on top).
   */
  readonly address: `0x${string}`;
  /** Optional label. Default: "ledger-hsm". */
  readonly label?: string;
}

export class LedgerHsmAdapter implements CustodyAdapter {
  readonly address: `0x${string}`;
  readonly capabilities: CustodyCapabilities;

  private readonly backend: LedgerBackendLike;
  private readonly keySlotId: string;
  private disposed = false;

  constructor(config: LedgerHsmAdapterConfig) {
    this.backend = config.backend;
    this.keySlotId = config.keySlotId;
    this.address = config.address;

    this.capabilities = {
      canSignTypedData: true,
      canSignRawTransaction: false, // defer to backend.signTransactionBytes
      canExportPublicKey: typeof config.backend.getPublicKey === "function",
      canProduceAttestation: false,
      requiresUserInteraction: true,
      requiresNetworkAccess: false, // WebHID is local USB
      label: config.label ?? "ledger-hsm",
    };
  }

  async signTypedData(req: TypedDataRequest): Promise<`0x${string}`> {
    this.ensureAlive();
    const digest = computeTypedDataDigest(req);

    let sigBytes: Uint8Array;
    try {
      sigBytes = await this.backend.sign(this.keySlotId, digest);
    } catch (cause) {
      throw this.translateBackendError(cause);
    }

    if (sigBytes.length !== 65) {
      throw new CustodyError(
        "signature-malformed",
        `Ledger returned ${sigBytes.length}-byte signature, expected 65`,
      );
    }

    return `0x${bytesToHex(sigBytes)}` as `0x${string}`;
  }

  async signRawTransaction(_req: RawTransactionRequest): Promise<`0x${string}`> {
    throw new CustodyError(
      "capability-not-supported",
      "LedgerHsmAdapter.signRawTransaction is intentionally deferred — use HardwareWalletBackend.signTransactionBytes directly via @aethelred/wallet-core. The custody-adapters layer covers EIP-712 typed-data signing only.",
    );
  }

  asTypedDataSigner(): TypedDataSigner {
    return {
      address: this.address,
      signTypedData: (req) => this.signTypedData(req),
    };
  }

  async dispose(): Promise<void> {
    // Intentional no-op: the backend owns WebHID transport lifecycle.
    // Callers that want to close the transport should invoke
    // `backend.disconnect()` directly; disposing the adapter has no
    // side effect on the shared transport.
    this.disposed = true;
  }

  // ─── Private ────────────────────────────────────────────────

  private ensureAlive(): void {
    if (this.disposed) {
      throw new CustodyError("adapter-disposed", "LedgerHsmAdapter has been disposed");
    }
  }

  /**
   * Map hardware.ts's typed-error taxonomy onto CustodyError codes. We
   * probe by `name` (structural) rather than `instanceof` so callers can
   * inject their own test backends that throw errors with matching shape
   * without pulling `@aethelred/wallet-core` into the test bundle.
   */
  private translateBackendError(cause: unknown): CustodyError {
    if (cause instanceof CustodyError) return cause;
    const name = (cause as { name?: unknown })?.name;
    const message =
      cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "unknown";

    const errorNameToCode: Record<string, CustodyErrorCode> = {
      HardwareWalletUserRejectedError: "user-rejected",
      HardwareWalletNotConnectedError: "device-not-connected",
      HardwareWalletAppNotOpenError: "device-app-not-open",
      HardwareWalletDeviceLockedError: "session-locked",
      HardwareWalletWrongChainError: "chain-id-mismatch",
      HardwareWalletTimeoutError: "device-busy",
      HardwareWalletTransportUnavailableError: "device-not-connected",
      HardwareWalletTransportFailureError: "device-not-connected",
      HardwareWalletUnsupportedDeviceError: "capability-not-supported",
      HardwareWalletUnsupportedOperationError: "firmware-too-old",
      HardwareWalletInvalidDataError: "signing-failed",
    };

    const code: CustodyErrorCode =
      (typeof name === "string" && errorNameToCode[name]) || "signing-failed";

    if (code === "user-rejected") {
      return new UserRejectedError(this.capabilities.label, message);
    }

    return new CustodyError(code, `Ledger signing failed: ${message}`, { cause });
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}
