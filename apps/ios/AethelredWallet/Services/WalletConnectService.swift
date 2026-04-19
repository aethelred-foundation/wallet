import Foundation

/// Session metadata surfaced to UI layers. Mirrors what
/// `@aethelred/wallet-connect` produces in the extension.
public struct WalletConnectSessionInfo: Sendable, Equatable, Hashable, Identifiable {
    public let id: String
    public let topic: String
    public let dappName: String
    public let dappOrigin: String
    public let accounts: [String]
    public let chainIds: [Int]
    public let expiry: Int64
    public let iconUrl: String?

    public init(
        id: String,
        topic: String,
        dappName: String,
        dappOrigin: String,
        accounts: [String],
        chainIds: [Int],
        expiry: Int64,
        iconUrl: String? = nil
    ) {
        self.id = id
        self.topic = topic
        self.dappName = dappName
        self.dappOrigin = dappOrigin
        self.accounts = accounts
        self.chainIds = chainIds
        self.expiry = expiry
        self.iconUrl = iconUrl
    }
}

/// Request surfaced for the approval sheet.
public struct WalletConnectRequest: Sendable, Equatable, Hashable, Identifiable {
    public let id: String
    public let topic: String
    public let method: String
    public let chainId: Int
    public let params: String

    public init(id: String, topic: String, method: String, chainId: Int, params: String) {
        self.id = id
        self.topic = topic
        self.method = method
        self.chainId = chainId
        self.params = params
    }
}

/// Port abstraction over Reown (WalletConnect v2) SDK.
///
/// PRODUCTION FOLLOW-UP: the real wiring depends on the Reown iOS SDK
/// (`com.reown.sdk`) which is not yet listed as a SwiftPM dep. This
/// service is the contract the UI uses; a concrete implementation
/// should replace ``DefaultWalletConnectService`` once the SDK is
/// available.
public protocol WalletConnectServicing: AnyObject, Sendable {
    func connect(uri: String) async throws -> WalletConnectSessionInfo
    func disconnect(topic: String) async throws
    func sessions() async -> [WalletConnectSessionInfo]
    func requestsStream() -> AsyncStream<WalletConnectRequest>
    func respond(requestId: String, result: String) async throws
    func reject(requestId: String, reason: String) async throws
}

/// Default, SDK-agnostic implementation. Holds the session table in
/// memory and plumbs events through an `AsyncStream`.
public final class DefaultWalletConnectService: WalletConnectServicing, @unchecked Sendable {

    private let lock = NSLock()
    private var store: [String: WalletConnectSessionInfo] = [:]
    private var requests: [String: WalletConnectRequest] = [:]
    private let requestsContinuation: AsyncStream<WalletConnectRequest>.Continuation
    private let requestsStreamImpl: AsyncStream<WalletConnectRequest>

    public init() {
        let (stream, continuation) = AsyncStream<WalletConnectRequest>.makeStream()
        self.requestsStreamImpl = stream
        self.requestsContinuation = continuation
    }

    public func connect(uri: String) async throws -> WalletConnectSessionInfo {
        // PRODUCTION FOLLOW-UP: invoke SDK pair / approve.
        let info = WalletConnectSessionInfo(
            id: UUID().uuidString,
            topic: UUID().uuidString,
            dappName: "Pending dApp",
            dappOrigin: uri,
            accounts: [],
            chainIds: [1],
            expiry: Int64(Date().addingTimeInterval(60 * 60 * 24 * 7).timeIntervalSince1970)
        )
        lock.lock(); defer { lock.unlock() }
        store[info.topic] = info
        return info
    }

    public func disconnect(topic: String) async throws {
        lock.lock(); defer { lock.unlock() }
        store.removeValue(forKey: topic)
    }

    public func sessions() async -> [WalletConnectSessionInfo] {
        lock.lock(); defer { lock.unlock() }
        return Array(store.values).sorted { $0.dappName < $1.dappName }
    }

    public func requestsStream() -> AsyncStream<WalletConnectRequest> {
        requestsStreamImpl
    }

    public func respond(requestId: String, result _: String) async throws {
        lock.lock(); defer { lock.unlock() }
        requests.removeValue(forKey: requestId)
    }

    public func reject(requestId: String, reason _: String) async throws {
        lock.lock(); defer { lock.unlock() }
        requests.removeValue(forKey: requestId)
    }

    /// Test hook — emit a synthetic request through the stream.
    public func injectRequest(_ request: WalletConnectRequest) {
        lock.lock()
        requests[request.id] = request
        lock.unlock()
        requestsContinuation.yield(request)
    }
}
