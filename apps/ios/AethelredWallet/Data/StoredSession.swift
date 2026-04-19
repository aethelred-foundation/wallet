import Foundation
import SwiftData

/// Persisted WalletConnect / delegation session.
@Model
public final class StoredSession {
    @Attribute(.unique) public var id: String
    public var topic: String
    public var dappName: String
    public var dappOrigin: String
    public var accountAddresses: String
    public var chainIds: String
    public var expiry: Int64
    public var kind: String

    public init(
        id: String,
        topic: String,
        dappName: String,
        dappOrigin: String,
        accountAddresses: String,
        chainIds: String,
        expiry: Int64,
        kind: String
    ) {
        self.id = id
        self.topic = topic
        self.dappName = dappName
        self.dappOrigin = dappOrigin
        self.accountAddresses = accountAddresses
        self.chainIds = chainIds
        self.expiry = expiry
        self.kind = kind
    }
}
