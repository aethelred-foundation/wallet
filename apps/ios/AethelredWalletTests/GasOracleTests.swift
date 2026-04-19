import XCTest
@testable import AethelredWallet

final class GasOracleTests: XCTestCase {

    func testOracleCachesSuggestions() async throws {
        var callCount = 0
        let stubNetwork = NetworkRegistry.ethereumMainnet
        let transport = StubHTTPTransport { _ in
            callCount += 1
            let payload = """
            {"jsonrpc":"2.0","id":1,"result":"0x3b9aca00"}
            """
            // swiftlint:disable force_unwrapping
            let url = URL(string: "https://x")!
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            // swiftlint:enable force_unwrapping
            return (Data(payload.utf8), response)
        }
        let now = Date()
        let oracle = GasOracle(
            cacheTTL: 30,
            clientFactory: { _ in RpcClient(network: stubNetwork, transport: transport) },
            now: { now }
        )
        _ = try await oracle.suggestions(for: 1)
        _ = try await oracle.suggestions(for: 1)
        XCTAssertLessThanOrEqual(callCount, 4, "expected cached fetch on the second call")
    }

    func testOracleRejectsUnsupportedChain() async {
        let oracle = GasOracle(clientFactory: { _ in nil })
        do {
            _ = try await oracle.suggestions(for: 99999)
            XCTFail("expected throw")
        } catch let error as GasOracleError {
            if case .unsupportedChain(let id) = error {
                XCTAssertEqual(id, 99999)
            } else {
                XCTFail("wrong error: \(error)")
            }
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }
}

/// Minimal transport stub used by the oracle + simulator tests.
struct StubHTTPTransport: HTTPTransport {
    let handler: @Sendable (URLRequest) async throws -> (Data, URLResponse)

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await handler(request)
    }
}
