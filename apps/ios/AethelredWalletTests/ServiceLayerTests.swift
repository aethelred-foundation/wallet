// swiftlint:disable force_unwrapping
// Test fixtures intentionally use URL(string:)! — the compile-time
// literals are known-valid and exercising the real error path would
// obscure what the test is actually asserting.
import XCTest
@testable import AethelredWallet

final class ServiceLayerTests: XCTestCase {

    // MARK: GasOracle

    func testGasOracleSynthesizesFourTiers() {
        let suggestions = GasOracle.synthesize(basePriceHex: "0x12a05f200", baseTipHex: "0x3b9aca00")
        XCTAssertEqual(suggestions.count, 4)
        XCTAssertEqual(suggestions.first?.tier, .slow)
        XCTAssertEqual(suggestions.last?.tier, .aggressive)
    }

    func testGasOracleTipsIncreaseWithTier() {
        let suggestions = GasOracle.synthesize(basePriceHex: "0x0", baseTipHex: "0x3b9aca00")
        let tipValues = suggestions.compactMap { GasOracle.hexToUInt64($0.maxPriorityFeePerGas) }
        for index in 1..<tipValues.count {
            XCTAssertGreaterThanOrEqual(tipValues[index], tipValues[index - 1])
        }
    }

    func testGasOracleHexUtilityRoundTrips() {
        XCTAssertEqual(GasOracle.hexToUInt64("0x10"), 16)
        XCTAssertEqual(GasOracle.hexToUInt64("10"), 16)
        XCTAssertNil(GasOracle.hexToUInt64("0xG"))
    }

    // MARK: NonceManager

    func testNonceManagerReservesSequentialNonces() async throws {
        let key = NonceKey(address: "0xAbC", chainId: 1)
        let manager = NonceManager(onChain: { _, _ in 7 })
        let a = try await manager.reserve(key)
        let b = try await manager.reserve(key)
        XCTAssertEqual(a, 7)
        XCTAssertEqual(b, 8)
    }

    func testNonceManagerReleaseAllowsReuse() async throws {
        let key = NonceKey(address: "0xAbC", chainId: 1)
        let manager = NonceManager(onChain: { _, _ in 10 })
        _ = try await manager.reserve(key)
        await manager.release(key, nonce: 10)
        let second = try await manager.reserve(key)
        XCTAssertEqual(second, 10, "releasing should free the nonce for reuse")
    }

    func testNonceManagerInvalidateForcesResync() async throws {
        let key = NonceKey(address: "0xAbC", chainId: 1)
        var chainValue: UInt64 = 3
        let manager = NonceManager(freshness: 9_999, onChain: { _, _ in chainValue })
        _ = try await manager.reserve(key)
        chainValue = 100
        await manager.invalidate(key)
        let next = try await manager.reserve(key)
        XCTAssertEqual(next, 100)
    }

    // MARK: DeepLink

    func testDeepLinkParsesWalletConnectURI() {
        let url = URL(string: "wc://bridge.example?topic=abc")!
        guard case .walletConnect(let uri) = DeepLinkService().parse(url) else {
            return XCTFail("expected walletConnect route")
        }
        XCTAssertEqual(uri, url.absoluteString)
    }

    func testDeepLinkParsesAethelredSend() {
        let url = URL(string: "aethelred://send/0x1234?amount=1.5&chainId=10")!
        guard case .aethelredSend(let address, let amount, let chainId) = DeepLinkService().parse(url) else {
            return XCTFail("expected aethelredSend route")
        }
        XCTAssertEqual(address, "0x1234")
        XCTAssertEqual(amount, "1.5")
        XCTAssertEqual(chainId, 10)
    }

    func testDeepLinkFallsBackToUnrecognized() {
        let url = URL(string: "mailto:someone@example.com")!
        guard case .unrecognized = DeepLinkService().parse(url) else {
            return XCTFail("expected unrecognized route")
        }
    }

    // MARK: Ens

    func testEnsStubResolverReturnsTableEntry() async throws {
        let resolver = StubEnsResolver(table: ["vitalik.eth": "0x1234"])
        let resolved = try await resolver.resolve("vitalik.eth")
        XCTAssertEqual(resolved, "0x1234")
        let reverse = try await resolver.reverse("0x1234")
        XCTAssertEqual(reverse, "vitalik.eth")
    }

    // MARK: Price

    func testStubPriceServiceReturnsFixture() async throws {
        let snapshot = PriceSnapshot(symbol: "ETH", usdPrice: 1800, change24h: 0.02, fetchedAt: Date())
        let service = StubPriceService(fixture: ["ETH": snapshot])
        let prices = try await service.prices(for: ["ETH"])
        XCTAssertEqual(prices.count, 1)
        XCTAssertEqual(prices.first?.usdPrice, 1800)
    }

    // MARK: Analytics

    func testAnalyticsRecordsWhileEnabled() async {
        let service = AnalyticsService(enabled: true)
        await service.record(.onboardingStepCompleted(step: "intro"))
        await service.record(.transactionSent(chainId: 1))
        let drained = await service.drain()
        XCTAssertEqual(drained.count, 2)
    }

    func testAnalyticsDropsWhenDisabled() async {
        let service = AnalyticsService(enabled: false)
        await service.record(.screenViewed(name: "home"))
        let drained = await service.drain()
        XCTAssertTrue(drained.isEmpty)
    }

    // MARK: Workflow

    func testWorkflowQuorumReachedMovesToApproved() async {
        let service = WorkflowService()
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let workflow = WorkflowRecord(
            id: "w-1",
            workspaceId: "ws",
            initiatorSubjectId: "s-initiator",
            intentKind: "transfer",
            summary: "",
            quorumNeeded: 2,
            approvals: [],
            status: .pending,
            createdAt: now
        )
        await service.upsert(workflow)
        _ = await service.record(approval: WorkflowApproval(subjectId: "s-1", decision: .approved, occurredAt: now), for: "w-1")
        let second = await service.record(approval: WorkflowApproval(subjectId: "s-2", decision: .approved, occurredAt: now), for: "w-1")
        XCTAssertEqual(second?.status, .approved)
    }

    func testWorkflowDenyShortCircuits() async {
        let service = WorkflowService()
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        await service.upsert(WorkflowRecord(
            id: "w-2", workspaceId: "ws", initiatorSubjectId: "s-initiator",
            intentKind: "transfer", summary: "", quorumNeeded: 3, approvals: [], status: .pending, createdAt: now
        ))
        let result = await service.record(approval: WorkflowApproval(subjectId: "s-1", decision: .denied, occurredAt: now), for: "w-2")
        XCTAssertEqual(result?.status, .rejected)
    }
}
