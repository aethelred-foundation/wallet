export class AuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditError";
  }
}

export class AuditChainError extends AuditError {
  constructor(sequenceNumber: number, reason: string) {
    super(`Audit chain integrity failure at sequence ${sequenceNumber}: ${reason}`);
    this.name = "AuditChainError";
  }
}

export class AuditStorageError extends AuditError {
  constructor(operation: string, cause?: unknown) {
    super(`Audit storage error during ${operation}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "AuditStorageError";
  }
}
