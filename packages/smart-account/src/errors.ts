/**
 * Typed error classes for the smart-account package.
 *
 * All bundler/UserOperation/SimpleAccount failure paths raise one of
 * these, so callers can discriminate without string-matching. Each
 * class extends `Error`, sets `.name` explicitly (so `Error.prototype.toString`
 * shows the class name), and exposes any structured metadata as public
 * fields.
 */

import type { BundlerRpcError } from "./types";

/**
 * Thrown when the bundler returns a JSON-RPC error envelope.
 *
 * The original JSON-RPC error `code`, `message`, and `data` fields are
 * preserved as public readonly properties so callers can
 * programmatically match on the numeric code (e.g. `-32500` "rejected
 * by EntryPoint" from the ERC-4337 validation error taxonomy).
 *
 * @example
 * ```ts
 * try {
 *   await client.sendUserOperation(op, entryPoint);
 * } catch (err) {
 *   if (err instanceof BundlerError && err.code === -32500) {
 *     // EntryPoint rejected the op during validation.
 *   }
 * }
 * ```
 */
export class BundlerError extends Error {
  /** JSON-RPC numeric error code (standard or ERC-4337 validation code). */
  readonly code: number;
  /** Optional bundler-specific diagnostic payload. */
  readonly data?: unknown;

  constructor(rpcError: BundlerRpcError) {
    super(rpcError.message);
    this.name = "BundlerError";
    this.code = rpcError.code;
    this.data = rpcError.data;
  }
}

/**
 * Thrown when a UserOperation is constructed or queried with invalid
 * inputs — e.g. missing required fields, malformed hex, or mismatched
 * factory/factoryData pairing.
 */
export class UserOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserOperationError";
  }
}

/**
 * Thrown by the SimpleAccount helpers when encode inputs are invalid —
 * bad address length, negative salt, empty batch, etc.
 */
export class SimpleAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimpleAccountError";
  }
}
