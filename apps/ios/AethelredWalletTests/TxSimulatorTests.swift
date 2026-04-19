import XCTest
@testable import AethelredWallet

final class TxSimulatorTests: XCTestCase {

    func testStubSimulatorEchoesFixture() async throws {
        let expected = SimulationResult(
            willSucceed: false,
            estimatedGas: 0,
            returnData: "0x",
            stateDiffs: [],
            errorReason: "revert — test"
        )
        let simulator = StubTxSimulator(fixture: expected)
        let result = try await simulator.simulate(from: "0x1", to: "0x2", value: "0x0", data: "0x", chainId: 1)
        XCTAssertFalse(result.willSucceed)
        XCTAssertEqual(result.errorReason, "revert — test")
    }

    func testRevertMessageDecoderReturnsOriginalOnNoSelector() {
        let message = "execution reverted: PANIC"
        XCTAssertEqual(TxSimulator.decodeRevertMessage(message), message)
    }

    func testRevertMessageDecoderRecognisesSelector() {
        let message = "0x08c379a0" + String(repeating: "0", count: 60)
        let decoded = TxSimulator.decodeRevertMessage(message)
        XCTAssertTrue(decoded.contains("0x08c379a0"))
    }

    func testDefaultSimulatorFailsCleanlyOnBadChain() async throws {
        let simulator = TxSimulator()
        let result = try await simulator.simulate(from: "0x1", to: "0x2", value: "0x0", data: "0x", chainId: 999_999)
        XCTAssertFalse(result.willSucceed)
        XCTAssertNotNil(result.errorReason)
    }
}
