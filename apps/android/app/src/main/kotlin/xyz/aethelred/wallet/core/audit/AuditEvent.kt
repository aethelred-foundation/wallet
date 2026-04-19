package xyz.aethelred.wallet.core.audit

import kotlinx.serialization.Serializable

/**
 * Discriminator for [AuditEvent]. Mirrors the TypeScript union in
 * `packages/audit/src/types.ts` — any new value here must have a
 * corresponding string literal on the TS side so the control-plane
 * ingestion pipeline decodes it without adaptation.
 */
@Serializable
public enum class AuditEventKind(public val wire: String) {
    REQUEST_RECEIVED("request-received"),
    POLICY_EVALUATED("policy-evaluated"),
    APPROVAL_REQUESTED("approval-requested"),
    APPROVAL_DECIDED("approval-decided"),
    SIGNING_EXECUTED("signing-executed"),
    RESPONSE_SENT("response-sent"),
    SESSION_CREATED("session-created"),
    SESSION_REVOKED("session-revoked"),
    WORKSPACE_SWITCHED("workspace-switched"),
    ACCOUNT_CREATED("account-created"),
    ACCOUNT_IMPORTED("account-imported"),
    KEY_GENERATED("key-generated"),
    LOCK_STATE_CHANGED("lock-state-changed"),
    WALLET_INITIALIZED("wallet-initialized"),
    EXPORT_REQUESTED("export-requested"),
    CREDENTIAL_ENROLLED("credential-enrolled"),
    CREDENTIAL_VERIFIED("credential-verified"),
    CREDENTIAL_VERIFICATION_FAILED("credential-verification-failed"),
    CREDENTIAL_REVOKED("credential-revoked");

    public companion object {
        /** Reverse lookup for decoding wire kinds into the enum. */
        public fun fromWire(value: String): AuditEventKind? =
            entries.firstOrNull { it.wire == value }
    }
}

/**
 * Hash-linked audit event identical in shape to the TypeScript
 * `AuditEvent` interface. JSON-serializable via kotlinx.serialization.
 *
 * @property id Unique event identifier (`evt-<uuid>`).
 * @property sequenceNumber Monotonic counter inside a single subject/workspace.
 * @property timestamp Unix millisecond timestamp of creation.
 * @property kind Audit kind discriminator.
 * @property subjectId Subject (person/service/agent) that performed the action.
 * @property workspaceId Workspace the action ran inside.
 * @property appId Optional connected-app identifier.
 * @property sessionId Optional connect-session identifier.
 * @property intentId Optional signing-intent identifier.
 * @property detail Free-form per-kind payload.
 * @property previousHash Hex SHA-256 of the preceding event in the chain.
 * @property eventHash Hex SHA-256 of this event's canonicalized bytes.
 */
@Serializable
public data class AuditEvent(
    public val id: String,
    public val sequenceNumber: Long,
    public val timestamp: Long,
    public val kind: AuditEventKind,
    public val subjectId: String,
    public val workspaceId: String,
    public val appId: String? = null,
    public val sessionId: String? = null,
    public val intentId: String? = null,
    public val detail: Map<String, String> = emptyMap(),
    public val previousHash: String,
    public val eventHash: String,
)
