import Foundation

/// ENS (Ethereum Name Service) resolver abstraction. Production
/// implementation performs an `eth_call` against the ENS registry on
/// mainnet; the protocol stays small so unit tests can swap in a
/// hard-coded table of fixtures.
public protocol EnsResolving: Sendable {
    /// Resolve `name.eth` → `0x…`. Returns `nil` if unset.
    func resolve(_ name: String) async throws -> String?
    /// Reverse lookup `0x…` → `name.eth`. Returns `nil` if no primary
    /// name is registered.
    func reverse(_ address: String) async throws -> String?
}

/// Default resolver backed by the mainnet public resolver.
///
/// The actual contract call is marked TODO — the shape here defines
/// the interface so callers (SendView AddressField, ActivityView
/// counterparty cells) can compile against the protocol today.
public actor EnsResolver: EnsResolving {

    private struct CacheEntry<Value: Sendable> {
        let value: Value?
        let fetchedAt: Date
    }

    private var forward: [String: CacheEntry<String>] = [:]
    private var reverseCache: [String: CacheEntry<String>] = [:]
    private let ttl: TimeInterval
    private let transport: HTTPTransport
    private let endpoint: URL
    private let now: @Sendable () -> Date

    public init(
        transport: HTTPTransport = URLSession.shared,
        ttl: TimeInterval = 300,
        endpoint: URL = URL(string: "https://eth.llamarpc.com")!,  // swiftlint:disable:this force_unwrapping
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.transport = transport
        self.ttl = ttl
        self.endpoint = endpoint
        self.now = now
    }

    public func resolve(_ name: String) async throws -> String? {
        let key = name.lowercased()
        if let cached = forward[key], now().timeIntervalSince(cached.fetchedAt) < ttl {
            return cached.value
        }
        // PRODUCTION FOLLOW-UP: wire eth_call against ENS registry + resolver.
        // For now, return the cached nil so downstream code stays deterministic.
        forward[key] = CacheEntry(value: nil, fetchedAt: now())
        return nil
    }

    public func reverse(_ address: String) async throws -> String? {
        let key = address.lowercased()
        if let cached = reverseCache[key], now().timeIntervalSince(cached.fetchedAt) < ttl {
            return cached.value
        }
        reverseCache[key] = CacheEntry(value: nil, fetchedAt: now())
        return nil
    }
}

/// Deterministic test fixture.
public struct StubEnsResolver: EnsResolving {
    private let table: [String: String]

    public init(table: [String: String] = [:]) {
        self.table = table.reduce(into: [String: String]()) { $0[$1.key.lowercased()] = $1.value }
    }

    public func resolve(_ name: String) async throws -> String? {
        table[name.lowercased()]
    }

    public func reverse(_ address: String) async throws -> String? {
        for (key, value) in table where value.caseInsensitiveCompare(address) == .orderedSame {
            return key
        }
        return nil
    }
}
