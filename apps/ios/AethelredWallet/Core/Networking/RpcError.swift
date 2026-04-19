import Foundation

/// Typed error produced by the Ethereum JSON-RPC client.
///
/// Errors surface both transport-level failures (bad HTTP status,
/// decoding errors) and JSON-RPC `error` objects the upstream node
/// returns. Downstream UI maps these to user-facing copy through the
/// `errorDescription` conformance.
public enum RpcError: LocalizedError, Sendable, Equatable {

    /// All configured endpoints returned a transport failure.
    case allEndpointsExhausted(underlying: [String])

    /// HTTP layer accepted the request but the JSON-RPC envelope reports
    /// an application-level error.
    case jsonRpcError(code: Int, message: String)

    /// The response body could not be decoded as a JSON-RPC envelope.
    case malformedResponse(reason: String)

    /// A response was received but carried no `result` field when one
    /// was required.
    case missingResult

    /// The chain ID in the wallet's registry does not match what the RPC
    /// reported — a mismatch is never silent; the UI surfaces it and
    /// blocks further interaction.
    case chainMismatch(expected: Int, got: Int)

    public var errorDescription: String? {
        switch self {
        case .allEndpointsExhausted(let underlying):
            return "All RPC endpoints failed: \(underlying.joined(separator: " | "))."
        case .jsonRpcError(let code, let message):
            return "JSON-RPC error \(code): \(message)."
        case .malformedResponse(let reason):
            return "Malformed JSON-RPC response: \(reason)."
        case .missingResult:
            return "JSON-RPC response had no `result` field."
        case .chainMismatch(let expected, let got):
            return "Chain mismatch: expected \(expected) but node reported \(got)."
        }
    }
}
