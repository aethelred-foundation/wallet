import Foundation

/// Key that uniquely identifies an `(account, chain)` pair in the
/// nonce manager. Stable across launches so a persistence layer can
/// round-trip the tracker.
public struct NonceKey: Sendable, Hashable, Codable {
    public let address: String
    public let chainId: Int

    public init(address: String, chainId: Int) {
        self.address = address.lowercased()
        self.chainId = chainId
    }
}

/// Snapshot of the nonce state for a given key.
public struct NonceState: Sendable, Hashable, Codable {
    public let onChainNext: UInt64
    public let pendingNext: UInt64
    public let inFlight: [UInt64]

    public init(onChainNext: UInt64, pendingNext: UInt64, inFlight: [UInt64]) {
        self.onChainNext = onChainNext
        self.pendingNext = pendingNext
        self.inFlight = inFlight
    }
}

/// Tracks next-nonce values per (account, chain) pair.
///
/// Wallets that send multiple txs in quick succession need a local
/// cache on top of `eth_getTransactionCount(pending)` because the node
/// may not see a tx immediately after broadcast. ``NonceManager`` keeps
/// a per-key counter in memory and exposes a `replace(nonce:)` hook for
/// replacement transactions (same nonce, higher fee).
public actor NonceManager {

    private struct Bucket {
        var onChainNext: UInt64
        var reserved: Set<UInt64>
        var syncedAt: Date
    }

    private var store: [NonceKey: Bucket] = [:]
    private let freshness: TimeInterval
    private let now: @Sendable () -> Date
    private let onChain: @Sendable (String, Int) async throws -> UInt64

    /// Designated initializer. ``freshness`` controls how long a
    /// cached on-chain nonce is considered authoritative.
    public init(
        freshness: TimeInterval = 5,
        onChain: @escaping @Sendable (String, Int) async throws -> UInt64,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.freshness = freshness
        self.onChain = onChain
        self.now = now
    }

    /// Return the nonce the caller should use for the next tx and
    /// atomically reserve it. Subsequent calls return the next integer
    /// until one of the reserved nonces is released via ``release``.
    public func reserve(_ key: NonceKey) async throws -> UInt64 {
        var bucket = try await sync(key: key)
        var candidate = bucket.onChainNext
        while bucket.reserved.contains(candidate) {
            candidate += 1
        }
        bucket.reserved.insert(candidate)
        store[key] = bucket
        return candidate
    }

    /// Release a reserved nonce once its transaction has been mined or
    /// canceled.
    public func release(_ key: NonceKey, nonce: UInt64) {
        guard var bucket = store[key] else { return }
        bucket.reserved.remove(nonce)
        store[key] = bucket
    }

    /// Reserve the same nonce again — used for replacement txs.
    public func replace(_ key: NonceKey, nonce: UInt64) {
        guard var bucket = store[key] else {
            var empty = Bucket(onChainNext: nonce, reserved: [], syncedAt: .distantPast)
            empty.reserved.insert(nonce)
            store[key] = empty
            return
        }
        bucket.reserved.insert(nonce)
        store[key] = bucket
    }

    /// Force the manager to re-query the on-chain value on its next
    /// reservation — call this on reorg detection.
    public func invalidate(_ key: NonceKey) {
        guard var bucket = store[key] else { return }
        bucket.syncedAt = .distantPast
        store[key] = bucket
    }

    /// Snapshot for a key.
    public func state(_ key: NonceKey) -> NonceState {
        let bucket = store[key] ?? Bucket(onChainNext: 0, reserved: [], syncedAt: .distantPast)
        return NonceState(
            onChainNext: bucket.onChainNext,
            pendingNext: (bucket.reserved.max() ?? bucket.onChainNext) + 1,
            inFlight: bucket.reserved.sorted()
        )
    }

    private func sync(key: NonceKey) async throws -> Bucket {
        let existing = store[key]
        if let existing, now().timeIntervalSince(existing.syncedAt) < freshness {
            return existing
        }
        let onChainValue = try await onChain(key.address, key.chainId)
        var bucket = existing ?? Bucket(onChainNext: onChainValue, reserved: [], syncedAt: now())
        // Clean up in-flight reservations below the new on-chain head —
        // the chain already consumed those.
        bucket.reserved = bucket.reserved.filter { $0 >= onChainValue }
        bucket.onChainNext = onChainValue
        bucket.syncedAt = now()
        store[key] = bucket
        return bucket
    }
}
