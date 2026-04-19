import XCTest
@testable import AethelredWallet

final class RpcClientTests: XCTestCase {

    func testSuccessfulBalanceRequest() async throws {
        let transport = MockTransport { request in
            let body = try XCTUnwrap(request.httpBody)
            let decoded = try XCTUnwrap(
                try JSONSerialization.jsonObject(with: body) as? [String: Any]
            )
            XCTAssertEqual(decoded["method"] as? String, "eth_getBalance")
            let requestId = (decoded["id"] as? Int) ?? 1
            let response: [String: Any] = [
                "jsonrpc": "2.0",
                "id": requestId,
                "result": "0x1bc16d674ec80000"
            ]
            let encoded = try JSONSerialization.data(withJSONObject: response)
            let url = try XCTUnwrap(request.url)
            let http = try XCTUnwrap(
                HTTPURLResponse(
                    url: url,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )
            )
            return (encoded, http)
        }
        let client = RpcClient(
            network: NetworkRegistry.ethereumMainnet,
            transport: transport
        )
        let balance = try await client.getBalance(address: "0x1234")
        XCTAssertEqual(balance, "0x1bc16d674ec80000")
    }

    func testRpcErrorIsPropagated() async throws {
        let transport = MockTransport { request in
            let decoded = (try? JSONSerialization.jsonObject(
                with: request.httpBody ?? Data()
            )) as? [String: Any] ?? [:]
            let requestId = (decoded["id"] as? Int) ?? 1
            let response: [String: Any] = [
                "jsonrpc": "2.0",
                "id": requestId,
                "error": ["code": -32_000, "message": "execution reverted"]
            ]
            let encoded = try JSONSerialization.data(withJSONObject: response)
            let url = try XCTUnwrap(request.url)
            let http = try XCTUnwrap(
                HTTPURLResponse(
                    url: url,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )
            )
            return (encoded, http)
        }
        let client = RpcClient(
            network: NetworkRegistry.ethereumMainnet,
            transport: transport
        )
        do {
            _ = try await client.getBalance(address: "0x1234")
            XCTFail("expected RpcError.jsonRpcError")
        } catch RpcError.jsonRpcError(let code, let message) {
            XCTAssertEqual(code, -32_000)
            XCTAssertEqual(message, "execution reverted")
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testTransportFailureRotatesAcrossAllEndpoints() async {
        let transport = MockTransport { _ in
            throw URLError(.notConnectedToInternet)
        }
        let client = RpcClient(
            network: NetworkRegistry.ethereumMainnet,
            transport: transport
        )
        do {
            _ = try await client.getBalance(address: "0x1234")
            XCTFail("expected allEndpointsExhausted")
        } catch RpcError.allEndpointsExhausted(let failures) {
            XCTAssertEqual(
                failures.count,
                NetworkRegistry.ethereumMainnet.rpcEndpoints.count
            )
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }
}

/// Minimal HTTPTransport fake driven by a user-supplied closure.
private struct MockTransport: HTTPTransport {
    let handler: @Sendable (URLRequest) throws -> (Data, URLResponse)

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try handler(request)
    }
}
