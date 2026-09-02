export class TrustKernelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrustKernelError";
  }
}

export class LockedError extends TrustKernelError {
  constructor() {
    super("Wallet is locked. Unlock with password before performing this operation.");
    this.name = "LockedError";
  }
}

export class KeyNotFoundError extends TrustKernelError {
  constructor(keySlotId: string) {
    super(`Key slot not found: ${keySlotId}`);
    this.name = "KeyNotFoundError";
  }
}

export class PolicyViolationError extends TrustKernelError {
  constructor(reason: string) {
    super(`Policy violation: ${reason}`);
    this.name = "PolicyViolationError";
  }
}

export class SigningDeniedError extends TrustKernelError {
  constructor(reason: string) {
    super(`Signing denied: ${reason}`);
    this.name = "SigningDeniedError";
  }
}

export class StorageError extends TrustKernelError {
  constructor(operation: string, cause?: unknown) {
    super(`Storage error during ${operation}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "StorageError";
  }
}

export class InvalidPasswordError extends TrustKernelError {
  constructor() {
    super("Invalid password. Unable to decrypt wallet data.");
    this.name = "InvalidPasswordError";
  }
}

export class AlreadyInitializedError extends TrustKernelError {
  constructor() {
    super("Wallet is already initialized. Reset it explicitly before creating or importing another vault.");
    this.name = "AlreadyInitializedError";
  }
}

export class MnemonicError extends TrustKernelError {
  constructor(reason: string) {
    super(`Mnemonic error: ${reason}`);
    this.name = "MnemonicError";
  }
}
