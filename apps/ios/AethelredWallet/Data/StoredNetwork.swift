import Foundation
import SwiftData

/// Persisted snapshot of a network registry entry — gives the app a
/// way to reason about networks the user has opted into (e.g. custom
/// RPC endpoints they've added) without bundling them into the static
/// registry.
@Model
public final class StoredNetwork {
    @Attribute(.unique) public var chainId: Int
    public var name: String
    public var shortName: String
    public var namespace: String
    public var symbol: String
    public var decimals: Int
    public var isTestnet: Bool
    public var customRpcEndpoints: String
    public var preferred: Bool

    public init(
        chainId: Int,
        name: String,
        shortName: String,
        namespace: String,
        symbol: String,
        decimals: Int,
        isTestnet: Bool,
        customRpcEndpoints: String,
        preferred: Bool
    ) {
        self.chainId = chainId
        self.name = name
        self.shortName = shortName
        self.namespace = namespace
        self.symbol = symbol
        self.decimals = decimals
        self.isTestnet = isTestnet
        self.customRpcEndpoints = customRpcEndpoints
        self.preferred = preferred
    }
}
