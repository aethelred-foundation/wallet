import XCTest
@testable import AethelredWallet

final class PriceServiceTests: XCTestCase {

    func testStubPriceServiceListsRequested() async throws {
        let snapshot = PriceSnapshot(symbol: "BTC", usdPrice: 62000, change24h: 0.0124, fetchedAt: Date())
        let service = StubPriceService(fixture: ["BTC": snapshot])
        let prices = try await service.prices(for: ["BTC"])
        XCTAssertEqual(prices.map(\.symbol), ["BTC"])
        XCTAssertEqual(prices.first?.usdPrice, 62000)
    }

    func testStubPriceServiceThrowsOnMissing() async {
        let service = StubPriceService()
        do {
            _ = try await service.spot("ETH")
            XCTFail("expected throw")
        } catch {
            // pass
        }
    }

    func testRealPriceServiceNormalisesCoingeckoPayload() async throws {
        let payload = """
        {"ethereum":{"usd":1800.25,"usd_24h_change":1.8}}
        """
        let transport = StubHTTPTransport { _ in
            // swiftlint:disable force_unwrapping
            let url = URL(string: "https://x")!
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            // swiftlint:enable force_unwrapping
            return (Data(payload.utf8), response)
        }
        let service = PriceService(transport: transport, ttl: 0, now: { Date() })
        let prices = try await service.prices(for: ["ETH"])
        XCTAssertEqual(prices.first?.usdPrice, 1800.25)
        XCTAssertEqual(prices.first?.change24h ?? 0, 0.018, accuracy: 0.0001)
    }
}
