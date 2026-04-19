import Combine
import Foundation
import SwiftUI

/// View model backing the Home / Accounts surfaces.
///
/// Owns the mutable state views bind to (balance, loading status) and
/// delegates to the RPC client actor for data fetches. Stays on the
/// main actor so SwiftUI updates are safe.
@MainActor
public final class WalletStateViewModel: ObservableObject {

    /// Formatted hero balance shown on the Home screen.
    @Published public private(set) var heroBalance: Decimal = 0

    /// Human-readable chain label.
    @Published public private(set) var chainName: String = ""

    /// True while a background fetch is in-flight.
    @Published public private(set) var isRefreshing: Bool = false

    /// Last known error, if any.
    @Published public private(set) var lastError: String?

    private var rpcClient: RpcClient
    private let network: NetworkDefinition

    public init(network: NetworkDefinition) {
        self.network = network
        self.rpcClient = RpcClient(network: network)
        self.chainName = network.name
    }

    /// Refresh the selected account's native balance.
    public func refresh(for account: WalletAccount) async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let hex = try await rpcClient.getBalance(address: account.address)
            heroBalance = Self.decimal(fromHexWei: hex, decimals: network.nativeCurrency.decimals)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Convert a hex-encoded wei value to a base-unit decimal.
    internal static func decimal(fromHexWei hex: String, decimals: Int) -> Decimal {
        let cleaned = hex.hasPrefix("0x") ? String(hex.dropFirst(2)) : hex
        if cleaned.isEmpty { return 0 }
        var accumulator: Decimal = 0
        for character in cleaned {
            guard let value = character.hexDigitValue else { continue }
            accumulator = accumulator * 16 + Decimal(value)
        }
        let divisor = pow(Decimal(10), decimals)
        return accumulator / divisor
    }
}
