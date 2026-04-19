package xyz.aethelred.wallet.core.identity

import kotlinx.serialization.Serializable

/**
 * Kind of subject the wallet is acting on behalf of. Matches the
 * `Subject.kind` enum in `packages/identity/src/types.ts`.
 */
@Serializable
public enum class SubjectKind { PERSON, SERVICE, AGENT }

/**
 * Subject record. Simplified from the TS schema — the mobile wallet
 * only needs the minimum set of fields to render the current identity
 * and feed audit events.
 */
@Serializable
public data class Subject(
    public val id: String,
    public val displayName: String,
    public val kind: SubjectKind,
    public val email: String? = null,
    public val workspaceIds: List<String> = emptyList(),
    public val credentialIds: List<String> = emptyList(),
    public val createdAt: Long,
)
