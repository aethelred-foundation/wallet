/**
 * Typed error taxonomy for custody adapters.
 *
 * All adapters throw `CustodyError` subclasses with a stable `code`.
 * The signing call sites (x402 client, intent router, MCP server)
 * branch on `code` to decide whether to retry, surface to user,
 * or escalate.
 */

export type CustodyErrorCode =
  // User / policy
  | "user-rejected"
  | "session-locked"
  | "spend-policy-violation"
  // Hardware / TEE
  | "device-not-connected"
  | "device-busy"
  | "device-app-not-open"
  | "firmware-too-old"
  | "attestation-failed"
  | "enclave-unreachable"
  // Key material
  | "invalid-key-material"
  | "key-share-missing"
  | "shamir-reconstruction-failed"
  // Capability / config
  | "capability-not-supported"
  | "adapter-disposed"
  | "adapter-config-invalid"
  // Signing pipeline
  | "signing-failed"
  | "signature-malformed"
  | "chain-id-mismatch"
  // Network (Fireblocks, remote-signing)
  | "remote-api-error"
  | "remote-api-timeout";

export class CustodyError extends Error {
  readonly code: CustodyErrorCode;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: CustodyErrorCode,
    message: string,
    options?: { readonly cause?: unknown; readonly details?: Readonly<Record<string, unknown>> },
  ) {
    super(message);
    this.name = "CustodyError";
    this.code = code;
    this.cause = options?.cause;
    this.details = options?.details;
  }
}

/** Thrown when a caller uses a method not advertised in capabilities. */
export class CapabilityNotSupportedError extends CustodyError {
  constructor(capability: string, adapterLabel: string) {
    super("capability-not-supported", `Adapter "${adapterLabel}" does not support ${capability}`, {
      details: { capability, adapterLabel },
    });
    this.name = "CapabilityNotSupportedError";
  }
}

/** Thrown when a user cancels a hardware prompt or similar. */
export class UserRejectedError extends CustodyError {
  constructor(adapterLabel: string, message?: string) {
    super("user-rejected", message ?? `User rejected signing on "${adapterLabel}"`, {
      details: { adapterLabel },
    });
    this.name = "UserRejectedError";
  }
}

/** Thrown when a Shamir share is missing or malformed. */
export class KeyShareMissingError extends CustodyError {
  constructor(message: string) {
    super("key-share-missing", message);
    this.name = "KeyShareMissingError";
  }
}

/** Thrown when a remote signing service (Fireblocks, enclave) errors. */
export class RemoteApiError extends CustodyError {
  readonly httpStatus?: number;
  constructor(message: string, options?: { httpStatus?: number; cause?: unknown }) {
    super("remote-api-error", message, { cause: options?.cause });
    this.name = "RemoteApiError";
    this.httpStatus = options?.httpStatus;
  }
}
