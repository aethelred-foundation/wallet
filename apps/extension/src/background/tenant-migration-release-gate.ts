import type { BridgeMessageKind } from "@aethelred/wallet-connect";

/**
 * Tenant migration message kinds reserved by the bridge protocol but not
 * released by this extension.  The production worker must reject them before
 * dispatch; returning empty rosters or placeholder receipts makes an
 * unavailable control-plane operation look successful to callers.
 */
export const UNRELEASED_TENANT_MIGRATION_MESSAGE_KINDS = [
  "tenant-list",
  "tenant-plan-migration",
  "tenant-execute-migration",
  "tenant-verify-continuity",
] as const satisfies readonly BridgeMessageKind[];

const UNRELEASED_TENANT_MIGRATION_MESSAGES = new Set<string>(
  UNRELEASED_TENANT_MIGRATION_MESSAGE_KINDS,
);

export interface TenantMigrationReleaseError {
  code: 4200;
  message: string;
}

/** Return the EIP-1193 unsupported-method error for reserved migration calls. */
export function getTenantMigrationReleaseError(
  kind: string,
): TenantMigrationReleaseError | null {
  if (!UNRELEASED_TENANT_MIGRATION_MESSAGES.has(kind)) return null;

  return {
    code: 4200,
    message:
      "Tenant migration operations are unavailable until an audited deployment migration control plane is configured",
  };
}
