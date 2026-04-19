import Foundation
import SwiftData

/// Persisted passkey credential — mirror of the Keychain-backed
/// ``PasskeyCredentialRecord`` used for quick UI listing.
@Model
public final class StoredPasskeyCredential {
    @Attribute(.unique) public var id: String
    public var credentialId: Data
    public var relyingPartyIdentifier: String
    public var userIdentifier: String
    public var userDisplayName: String
    public var signCounter: Int
    public var createdAt: Int64
    public var lastUsedAt: Int64?

    public init(
        id: String,
        credentialId: Data,
        relyingPartyIdentifier: String,
        userIdentifier: String,
        userDisplayName: String,
        signCounter: Int,
        createdAt: Int64,
        lastUsedAt: Int64? = nil
    ) {
        self.id = id
        self.credentialId = credentialId
        self.relyingPartyIdentifier = relyingPartyIdentifier
        self.userIdentifier = userIdentifier
        self.userDisplayName = userDisplayName
        self.signCounter = signCounter
        self.createdAt = createdAt
        self.lastUsedAt = lastUsedAt
    }
}
