import type { BridgeMessageKind } from "@aethelred/wallet-connect";

/**
 * Credential/ZeroID bridge calls exposed by the protocol but not backed by an
 * authoritative issuer registry and encrypted credential store in this
 * release. Keeping the gate independent from the credential package makes it
 * impossible for placeholder issuer keys or the private-key presentation
 * builder to enter the production service-worker bundle.
 */
export const UNRELEASED_CREDENTIAL_MESSAGE_KINDS = [
  "credentials-list",
  "credentials-revoke",
  "credential-presentation-prepare",
] as const satisfies readonly BridgeMessageKind[];

const UNRELEASED_CREDENTIAL_MESSAGES = new Set<string>(
  UNRELEASED_CREDENTIAL_MESSAGE_KINDS,
);

export interface CredentialReleaseError {
  code: 4200;
  message: string;
}

/** Return the EIP-1193 unsupported-method error for credential bridge calls. */
export function getCredentialReleaseError(
  kind: string,
): CredentialReleaseError | null {
  if (!UNRELEASED_CREDENTIAL_MESSAGES.has(kind)) return null;

  return {
    code: 4200,
    message:
      "ZeroID and regulatory credential operations are unavailable until verified issuer keys and an audited credential store are configured",
  };
}
