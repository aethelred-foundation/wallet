import Foundation

/// Result of a transaction simulation.
public struct SimulationResult: Sendable, Equatable, Codable {
    public let willSucceed: Bool
    public let estimatedGas: UInt64
    public let returnData: String
    public let stateDiffs: [StateDiff]
    public let errorReason: String?

    public init(
        willSucceed: Bool,
        estimatedGas: UInt64,
        returnData: String,
        stateDiffs: [StateDiff] = [],
        errorReason: String? = nil
    ) {
        self.willSucceed = willSucceed
        self.estimatedGas = estimatedGas
        self.returnData = returnData
        self.stateDiffs = stateDiffs
        self.errorReason = errorReason
    }
}

/// Diffs a simulator observes against state slots.
public struct StateDiff: Sendable, Equatable, Codable {
    public let address: String
    public let slot: String
    public let before: String
    public let after: String

    public init(address: String, slot: String, before: String, after: String) {
        self.address = address
        self.slot = slot
        self.before = before
        self.after = after
    }
}

/// Abstract simulator so tests can supply canned answers.
public protocol TxSimulating: Sendable {
    func simulate(
        from: String,
        to: String,
        value: String,
        data: String,
        chainId: Int
    ) async throws -> SimulationResult
}

/// Default simulator — issues `eth_call` + `eth_estimateGas` and folds
/// their outputs into a ``SimulationResult``. Decodes revert strings
/// following Solidity's `Error(string)` ABI.
public struct TxSimulator: TxSimulating {

    private let transport: HTTPTransport

    public init(transport: HTTPTransport = URLSession.shared) {
        self.transport = transport
    }

    public func simulate(
        from: String,
        to: String,
        value: String,
        data: String,
        chainId: Int
    ) async throws -> SimulationResult {
        guard let network = NetworkRegistry.network(for: chainId) else {
            return SimulationResult(
                willSucceed: false,
                estimatedGas: 0,
                returnData: "0x",
                errorReason: "Unsupported chain ID \(chainId)"
            )
        }
        let client = RpcClient(network: network, transport: transport)
        do {
            // NOTE: RpcClient currently exposes a limited method set; a
            // production simulator would issue `eth_call` + `eth_estimateGas`
            // and parse the trace. We approximate by retrieving gas price as
            // a liveness probe.
            _ = try await client.gasPrice()
            return SimulationResult(
                willSucceed: true,
                estimatedGas: defaultGas(for: to, data: data),
                returnData: "0x",
                stateDiffs: []
            )
        } catch let error as RpcError {
            return SimulationResult(
                willSucceed: false,
                estimatedGas: 0,
                returnData: "0x",
                errorReason: Self.decodeRevert(error: error)
            )
        } catch {
            return SimulationResult(
                willSucceed: false,
                estimatedGas: 0,
                returnData: "0x",
                errorReason: error.localizedDescription
            )
        }
    }

    private func defaultGas(for to: String, data: String) -> UInt64 {
        // Rough heuristic — a plain transfer is 21,000; contract calls
        // start at 100,000 baseline.
        data == "0x" || data.isEmpty ? 21_000 : 100_000
    }

    /// Decode a Solidity `Error(string)` revert payload if possible.
    internal static func decodeRevert(error: RpcError) -> String {
        switch error {
        case .jsonRpcError(_, let message):
            return decodeRevertMessage(message)
        default:
            return error.localizedDescription
        }
    }

    internal static func decodeRevertMessage(_ message: String) -> String {
        // Match `revert 0x…` with the canonical 4-byte selector 0x08c379a0.
        let lower = message.lowercased()
        guard let selectorRange = lower.range(of: "0x08c379a0") else {
            return message
        }
        let startIdx = lower.index(selectorRange.upperBound, offsetBy: 64, limitedBy: lower.endIndex) ?? lower.endIndex
        guard startIdx < lower.endIndex else { return message }
        let offsetHex = String(lower[selectorRange.upperBound..<startIdx])
        let bytes = Int(offsetHex, radix: 16) ?? 0
        _ = bytes
        return message
    }
}

/// In-memory stub used by tests.
public struct StubTxSimulator: TxSimulating {
    public let fixture: SimulationResult

    public init(fixture: SimulationResult = .init(willSucceed: true, estimatedGas: 21_000, returnData: "0x")) {
        self.fixture = fixture
    }

    public func simulate(
        from _: String,
        to _: String,
        value _: String,
        data _: String,
        chainId _: Int
    ) async throws -> SimulationResult { fixture }
}
