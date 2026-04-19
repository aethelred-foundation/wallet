import Foundation

/// Abstraction over `URLSession` so the RPC client can be tested without
/// real networking. Conforming types return whatever they want from
/// ``data(for:)`` — tests return canned responses, production defers to
/// `URLSession.shared`.
public protocol HTTPTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: HTTPTransport {}

/// Async/await Ethereum JSON-RPC client with automatic endpoint rotation.
///
/// The client is stateless with respect to a single request: each call
/// walks the configured endpoint list in priority order and retries on
/// transport error. It deliberately does NOT retry on JSON-RPC
/// application errors — those indicate the node understood the request
/// and rejected it, so the caller should surface the error.
public actor RpcClient {

    private let network: NetworkDefinition
    private let transport: HTTPTransport
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private var nextRequestId: Int = 1

    /// Designated initializer. `transport` defaults to `URLSession.shared`
    /// so production code can `RpcClient(network: ...)` without wiring.
    public init(
        network: NetworkDefinition,
        transport: HTTPTransport = URLSession.shared
    ) {
        self.network = network
        self.transport = transport
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    /// Fetch the native balance of `address` as a hex string
    /// (`"0x1bc16d674ec80000"`). The caller is responsible for converting
    /// the hex-encoded wei value to a user-facing decimal.
    public func getBalance(
        address: String,
        blockTag: String = "latest"
    ) async throws -> String {
        try await invoke(
            method: "eth_getBalance",
            params: [.string(address), .string(blockTag)]
        )
    }

    /// `eth_getTransactionCount` — returns the nonce for the next tx.
    public func getNonce(address: String) async throws -> String {
        try await invoke(
            method: "eth_getTransactionCount",
            params: [.string(address), .string("pending")]
        )
    }

    /// `eth_chainId`. Used at first contact to verify the node matches
    /// the network configured in the registry — a mismatch is fatal.
    public func chainId() async throws -> String {
        try await invoke(method: "eth_chainId", params: [])
    }

    /// `eth_gasPrice` (legacy) — fallback for networks where EIP-1559
    /// isn't available.
    public func gasPrice() async throws -> String {
        try await invoke(method: "eth_gasPrice", params: [])
    }

    /// `eth_maxPriorityFeePerGas` — the current priority tip on EIP-1559
    /// chains. Returns the raw hex string.
    public func maxPriorityFeePerGas() async throws -> String {
        try await invoke(method: "eth_maxPriorityFeePerGas", params: [])
    }

    /// Broadcast a signed raw transaction (already hex-encoded with the
    /// leading `0x02` type byte for EIP-1559).
    public func sendRawTransaction(_ rawHex: String) async throws -> String {
        try await invoke(
            method: "eth_sendRawTransaction",
            params: [.string(rawHex)]
        )
    }

    // MARK: - Core request path

    internal func invoke(
        method: String,
        params: [JSONRPCValue]
    ) async throws -> String {
        var transportFailures: [String] = []
        for endpoint in network.rpcEndpoints {
            do {
                let result = try await dispatch(
                    endpoint: endpoint,
                    method: method,
                    params: params
                )
                switch result {
                case .string(let value):
                    return value
                case .number(let number):
                    return String(number)
                case .bool(let flag):
                    return flag ? "true" : "false"
                case .null:
                    return ""
                case .array, .object:
                    throw RpcError.malformedResponse(
                        reason: "expected scalar result for \(method)"
                    )
                }
            } catch let error as RpcError {
                // JSON-RPC errors surface immediately — no rotation.
                if case .jsonRpcError = error { throw error }
                transportFailures.append(error.localizedDescription)
            } catch {
                transportFailures.append(error.localizedDescription)
            }
        }
        throw RpcError.allEndpointsExhausted(underlying: transportFailures)
    }

    private func dispatch(
        endpoint: String,
        method: String,
        params: [JSONRPCValue]
    ) async throws -> JSONRPCValue {
        guard let url = URL(string: endpoint) else {
            throw RpcError.malformedResponse(reason: "invalid endpoint \(endpoint)")
        }
        nextRequestId += 1
        let envelope = JSONRPCRequest(
            jsonrpc: "2.0",
            id: nextRequestId,
            method: method,
            params: params
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try encoder.encode(envelope)

        let (data, response) = try await transport.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw RpcError.malformedResponse(reason: "no HTTPURLResponse")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw RpcError.malformedResponse(
                reason: "http \(http.statusCode) from \(endpoint)"
            )
        }

        let decoded: JSONRPCResponse
        do {
            decoded = try decoder.decode(JSONRPCResponse.self, from: data)
        } catch {
            throw RpcError.malformedResponse(reason: error.localizedDescription)
        }

        if let errPayload = decoded.error {
            throw RpcError.jsonRpcError(
                code: errPayload.code,
                message: errPayload.message
            )
        }
        guard let result = decoded.result else {
            throw RpcError.missingResult
        }
        return result
    }
}

// MARK: - JSON-RPC envelope types

/// Minimal JSON value used by the RPC payloads. We avoid Foundation's
/// `Any`-based decoding because it defeats `Sendable` analysis.
public enum JSONRPCValue: Codable, Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONRPCValue])
    case object([String: JSONRPCValue])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
            return
        }
        if let value = try? container.decode(String.self) {
            self = .string(value)
            return
        }
        if let value = try? container.decode(Bool.self) {
            self = .bool(value)
            return
        }
        if let value = try? container.decode(Double.self) {
            self = .number(value)
            return
        }
        if let value = try? container.decode([JSONRPCValue].self) {
            self = .array(value)
            return
        }
        let value = try container.decode([String: JSONRPCValue].self)
        self = .object(value)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null:
            try container.encodeNil()
        case .string(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        }
    }
}

/// Outgoing JSON-RPC 2.0 request envelope.
public struct JSONRPCRequest: Codable, Sendable {
    public let jsonrpc: String
    public let id: Int
    public let method: String
    public let params: [JSONRPCValue]
}

/// Incoming JSON-RPC 2.0 response envelope.
public struct JSONRPCResponse: Codable, Sendable {
    public let jsonrpc: String
    public let id: Int?
    public let result: JSONRPCValue?
    public let error: JSONRPCErrorPayload?
}

/// Error body returned by the JSON-RPC node.
public struct JSONRPCErrorPayload: Codable, Sendable, Equatable {
    public let code: Int
    public let message: String
}
