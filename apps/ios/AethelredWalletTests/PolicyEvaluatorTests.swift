import XCTest
@testable import AethelredWallet

final class PolicyEvaluatorTests: XCTestCase {

    func testBuilderThrowsUntilAllRequiredFieldsSet() throws {
        let builder = PolicyContextBuilder()
        XCTAssertThrowsError(try builder.build())
    }

    func testBuilderProducesValidContext() throws {
        let context = try PolicyContextBuilder()
            .subject(.init(id: "s", role: .owner))
            .workspace(.init(id: "w", kind: .personal))
            .app(.init(id: "a", origin: "https://a", trustLevel: .firstParty))
            .intent(kind: .transferNative, method: "eth_sendTransaction")
            .account(.init(id: "acct", address: "0x1", namespace: .eip155))
            .amount(0.1, usd: 230)
            .asset(symbol: "ETH", category: .native)
            .chain(1)
            .build()
        XCTAssertEqual(context.subject.id, "s")
        XCTAssertEqual(context.chainId, 1)
        XCTAssertEqual(context.assetSymbol, "ETH")
    }

    func testEvaluatorCachesResults() async throws {
        let rule = PolicyRule(
            id: "r1",
            name: "deny-unknown",
            priority: 100,
            conditions: [
                .init(field: .appTrustLevel, conditionOperator: .equals, value: .string("unknown"))
            ],
            outcome: .deny,
            message: "Unknown dApp"
        )
        let engine = PolicyEngine(rules: [rule])
        let evaluator = PolicyEvaluator(engine: engine, ttl: 60)

        let context = try PolicyContextBuilder()
            .subject(.init(id: "s", role: .owner))
            .workspace(.init(id: "w", kind: .personal))
            .app(.init(id: "a", origin: "https://a", trustLevel: .unknown))
            .intent(kind: .transferNative, method: "eth_sendTransaction")
            .account(.init(id: "acct", address: "0x1", namespace: .eip155))
            .build()

        let first = await evaluator.evaluate(context: context)
        let second = await evaluator.evaluate(context: context)
        XCTAssertEqual(first.outcome, .deny)
        XCTAssertEqual(second.outcome, .deny)
    }
}
