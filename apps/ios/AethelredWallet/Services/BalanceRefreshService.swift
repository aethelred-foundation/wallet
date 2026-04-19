import Foundation

/// Observable balance snapshot for a (chain, account) pair.
public struct BalanceSnapshot: Sendable, Equatable {
    public let chainId: Int
    public let accountAddress: String
    public let weiHex: String
    public let fetchedAt: Date

    public init(chainId: Int, accountAddress: String, weiHex: String, fetchedAt: Date) {
        self.chainId = chainId
        self.accountAddress = accountAddress
        self.weiHex = weiHex
        self.fetchedAt = fetchedAt
    }
}

/// Actor that polls native balances across every chain the user has
/// opted into. Emits snapshots through an `AsyncStream` so any screen
/// can subscribe without coupling to the service directly.
public actor BalanceRefreshService {

    public typealias ClientFactory = @Sendable (NetworkDefinition) -> RpcClient

    private var snapshots: [String: BalanceSnapshot] = [:]
    private var streamContinuations: [UUID: AsyncStream<BalanceSnapshot>.Continuation] = [:]
    private let clientFactory: ClientFactory
    private let now: @Sendable () -> Date

    public init(
        clientFactory: @escaping ClientFactory = { RpcClient(network: $0) },
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.clientFactory = clientFactory
        self.now = now
    }

    /// Subscribe to every future balance snapshot.
    public func stream() -> AsyncStream<BalanceSnapshot> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<BalanceSnapshot>.makeStream()
        streamContinuations[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeContinuation(id) }
        }
        return stream
    }

    /// Refresh balances for one account across the supplied chains.
    public func refresh(
        accounts: [WalletAccount],
        chains: [NetworkDefinition]
    ) async {
        for account in accounts {
            for network in chains where network.namespace == .eip155 {
                await fetchOne(account: account, network: network)
            }
        }
    }

    /// Latest cached snapshot for a key.
    public func snapshot(address: String, chainId: Int) -> BalanceSnapshot? {
        snapshots[Self.key(address: address, chainId: chainId)]
    }

    /// Every tracked snapshot, sorted by fetch time descending.
    public func all() -> [BalanceSnapshot] {
        snapshots.values.sorted { $0.fetchedAt > $1.fetchedAt }
    }

    // MARK: Internal

    private func fetchOne(account: WalletAccount, network: NetworkDefinition) async {
        let client = clientFactory(network)
        do {
            let hex = try await client.getBalance(address: account.address)
            let snapshot = BalanceSnapshot(
                chainId: network.chainId,
                accountAddress: account.address,
                weiHex: hex,
                fetchedAt: now()
            )
            snapshots[Self.key(address: account.address, chainId: network.chainId)] = snapshot
            for continuation in streamContinuations.values {
                continuation.yield(snapshot)
            }
        } catch {
            // Drop silently — price service + background task will
            // retry. Surfacing the error here would spam the UI.
        }
    }

    private func removeContinuation(_ id: UUID) {
        streamContinuations.removeValue(forKey: id)
    }

    private static func key(address: String, chainId: Int) -> String {
        "\(address.lowercased()):\(chainId)"
    }
}
