import Foundation

/// Suggested EIP-1559 fee tier returned by a gas oracle.
///
/// Values are raw hex-encoded wei strings that downstream signing
/// components consume directly.
public struct GasSuggestion: Sendable, Equatable, Hashable {
    public let maxPriorityFeePerGas: String
    public let maxFeePerGas: String
    /// Estimated seconds to inclusion at this tier.
    public let estimatedInclusionSeconds: Int
    public let tier: Tier

    public enum Tier: String, Sendable, Equatable {
        case slow, standard, fast, aggressive
    }

    public init(
        maxPriorityFeePerGas: String,
        maxFeePerGas: String,
        estimatedInclusionSeconds: Int,
        tier: Tier
    ) {
        self.maxPriorityFeePerGas = maxPriorityFeePerGas
        self.maxFeePerGas = maxFeePerGas
        self.estimatedInclusionSeconds = estimatedInclusionSeconds
        self.tier = tier
    }
}

/// Abstract gas oracle so tests can supply deterministic suggestions.
public protocol GasOraclePort: Sendable {
    func suggestions(for chainId: Int) async throws -> [GasSuggestion]
}

/// Default oracle — computes priority / max fee suggestions from
/// `eth_feeHistory` + `eth_maxPriorityFeePerGas`. Uses a tiny 30-second
/// cache keyed on chain ID so rapid re-opens of the send sheet don't
/// hammer the node.
public actor GasOracle: GasOraclePort {

    private struct CacheEntry {
        let suggestions: [GasSuggestion]
        let fetchedAt: Date
    }

    private var cache: [Int: CacheEntry] = [:]
    private let cacheTTL: TimeInterval
    private let clientFactory: @Sendable (Int) -> RpcClient?
    private let now: @Sendable () -> Date

    /// Designated initializer. Defaults are production.
    public init(
        cacheTTL: TimeInterval = 30,
        clientFactory: @escaping @Sendable (Int) -> RpcClient? = { chainId in
            guard let network = NetworkRegistry.network(for: chainId) else { return nil }
            return RpcClient(network: network)
        },
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.cacheTTL = cacheTTL
        self.clientFactory = clientFactory
        self.now = now
    }

    public func suggestions(for chainId: Int) async throws -> [GasSuggestion] {
        if let cached = cache[chainId], now().timeIntervalSince(cached.fetchedAt) < cacheTTL {
            return cached.suggestions
        }
        guard let client = clientFactory(chainId) else {
            throw GasOracleError.unsupportedChain(chainId: chainId)
        }
        let baseTip = try await client.maxPriorityFeePerGas()
        let basePriceHex = try await client.gasPrice()
        let suggestions = Self.synthesize(
            basePriceHex: basePriceHex,
            baseTipHex: baseTip
        )
        cache[chainId] = CacheEntry(suggestions: suggestions, fetchedAt: now())
        return suggestions
    }

    /// Produce the canonical three-tier suggestion set from a single
    /// priority fee + base price pair.
    internal static func synthesize(
        basePriceHex: String,
        baseTipHex: String
    ) -> [GasSuggestion] {
        let basePrice = hexToUInt64(basePriceHex) ?? 1_000_000_000
        let baseTip = hexToUInt64(baseTipHex) ?? 1_000_000_000
        let standardTip = max(baseTip, 1_000_000_000)
        let fastTip = standardTip * 12 / 10
        let aggressiveTip = standardTip * 15 / 10
        let slowTip = max(standardTip * 8 / 10, 500_000_000)

        func maxFee(tip: UInt64) -> UInt64 {
            let base = basePrice > tip ? basePrice - tip : 0
            return base * 2 + tip
        }

        return [
            GasSuggestion(
                maxPriorityFeePerGas: "0x" + String(slowTip, radix: 16),
                maxFeePerGas: "0x" + String(maxFee(tip: slowTip), radix: 16),
                estimatedInclusionSeconds: 60,
                tier: .slow
            ),
            GasSuggestion(
                maxPriorityFeePerGas: "0x" + String(standardTip, radix: 16),
                maxFeePerGas: "0x" + String(maxFee(tip: standardTip), radix: 16),
                estimatedInclusionSeconds: 24,
                tier: .standard
            ),
            GasSuggestion(
                maxPriorityFeePerGas: "0x" + String(fastTip, radix: 16),
                maxFeePerGas: "0x" + String(maxFee(tip: fastTip), radix: 16),
                estimatedInclusionSeconds: 12,
                tier: .fast
            ),
            GasSuggestion(
                maxPriorityFeePerGas: "0x" + String(aggressiveTip, radix: 16),
                maxFeePerGas: "0x" + String(maxFee(tip: aggressiveTip), radix: 16),
                estimatedInclusionSeconds: 6,
                tier: .aggressive
            )
        ]
    }

    internal static func hexToUInt64(_ hex: String) -> UInt64? {
        let trimmed = hex.hasPrefix("0x") ? String(hex.dropFirst(2)) : hex
        return UInt64(trimmed, radix: 16)
    }
}

/// Errors emitted by ``GasOracle``.
public enum GasOracleError: LocalizedError, Sendable {
    case unsupportedChain(chainId: Int)

    public var errorDescription: String? {
        switch self {
        case .unsupportedChain(let chainId):
            return "Gas oracle does not support chain ID \(chainId)."
        }
    }
}

/// Deterministic test double.
public struct StubGasOracle: GasOraclePort {
    public let fixture: [GasSuggestion]

    public init(fixture: [GasSuggestion] = [
        GasSuggestion(maxPriorityFeePerGas: "0x3b9aca00", maxFeePerGas: "0x77359400", estimatedInclusionSeconds: 24, tier: .standard)
    ]) {
        self.fixture = fixture
    }

    public func suggestions(for _: Int) async throws -> [GasSuggestion] { fixture }
}
