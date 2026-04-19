import XCTest
@testable import AethelredWallet

final class NonceManagerTests: XCTestCase {

    func testReplaceReusesNonce() async throws {
        let key = NonceKey(address: "0xabc", chainId: 1)
        let manager = NonceManager(onChain: { _, _ in 12 })
        _ = try await manager.reserve(key)
        await manager.replace(key, nonce: 12)
        let state = await manager.state(key)
        XCTAssertTrue(state.inFlight.contains(12))
    }

    func testResyncDropsStaleReservations() async throws {
        let key = NonceKey(address: "0xabc", chainId: 1)
        var chain: UInt64 = 5
        let manager = NonceManager(freshness: 0, onChain: { _, _ in chain })
        _ = try await manager.reserve(key) // 5
        chain = 10
        let next = try await manager.reserve(key)
        XCTAssertGreaterThanOrEqual(next, 10)
    }
}
