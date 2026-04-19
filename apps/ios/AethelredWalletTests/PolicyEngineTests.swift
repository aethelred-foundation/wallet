import XCTest
@testable import AethelredWallet

/// Test vectors imported from the TypeScript reference
/// (`packages/policy/src/engine.test.ts`). If these drift the iOS
/// engine will surface different decisions than the control plane.
final class PolicyEngineTests: XCTestCase {

    func testDefaultsToAllowWhenNoRulesMatch() {
        let engine = PolicyEngine(rules: [])
        let result = engine.evaluate(context: sampleContext())
        XCTAssertEqual(result.outcome, .allow)
        XCTAssertFalse(result.requiresApproval)
        XCTAssertTrue(result.matchedRules.isEmpty)
    }

    func testDenyRuleOverridesAllowDefault() {
        let rule = PolicyRule(
            id: "rule-1",
            name: "Block unknown destinations",
            priority: 10,
            conditions: [
                PolicyCondition(
                    field: .destinationCategory,
                    conditionOperator: .equals,
                    value: .string("unknown")
                )
            ],
            outcome: .deny,
            message: "Unknown destination"
        )
        let engine = PolicyEngine(rules: [rule])
        let context = sampleContext(destinationCategory: .unknown)
        let result = engine.evaluate(context: context)
        XCTAssertEqual(result.outcome, .deny)
        XCTAssertEqual(result.matchedRules.first?.id, "rule-1")
    }

    func testHigherPriorityRuleWins() {
        let low = PolicyRule(
            id: "low",
            name: "Allow",
            priority: 1,
            conditions: [],
            outcome: .allow,
            message: ""
        )
        let high = PolicyRule(
            id: "high",
            name: "Require approval for big spend",
            priority: 100,
            conditions: [
                PolicyCondition(
                    field: .amountUsd,
                    conditionOperator: .greaterThan,
                    value: .number(1000)
                )
            ],
            outcome: .requireApproval,
            message: "Large value"
        )
        let engine = PolicyEngine(rules: [low, high])
        let context = sampleContext(amountUsd: 5_000)
        let result = engine.evaluate(context: context)
        XCTAssertEqual(result.outcome, .requireApproval)
        XCTAssertTrue(result.requiresApproval)
        XCTAssertEqual(result.matchedRules.first?.id, "high")
    }

    func testInOperatorMatchesListMembership() {
        let rule = PolicyRule(
            id: "rule-1",
            name: "Whitelist tokens",
            priority: 10,
            conditions: [
                PolicyCondition(
                    field: .assetSymbol,
                    conditionOperator: .inList,
                    value: .stringList(["USDC", "DAI"])
                )
            ],
            outcome: .allow,
            message: ""
        )
        let engine = PolicyEngine(rules: [rule])
        let context = sampleContext(assetSymbol: "USDC")
        XCTAssertEqual(engine.evaluate(context: context).outcome, .allow)
    }

    // MARK: Helpers

    private func sampleContext(
        destinationCategory: DestinationCategory? = nil,
        amountUsd: Double? = nil,
        assetSymbol: String? = nil
    ) -> PolicyContext {
        PolicyContext(
            subject: .init(id: "subject-1", role: .owner),
            workspace: .init(id: "workspace-personal", kind: .personal),
            app: .init(id: "aethelred", origin: "aethelred.network", trustLevel: .firstParty),
            intent: .init(kind: .transferErc20, method: "eth_sendTransaction"),
            session: .init(exists: true, id: "session-1"),
            account: .init(id: "account-1", address: "0x0", namespace: .eip155),
            destinationCategory: destinationCategory,
            amountUsd: amountUsd,
            assetSymbol: assetSymbol
        )
    }
}
