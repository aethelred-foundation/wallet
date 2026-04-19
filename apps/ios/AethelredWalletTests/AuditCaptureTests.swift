import XCTest
@testable import AethelredWallet

final class AuditCaptureTests: XCTestCase {

    func testChainStartsFromZeroHash() async {
        let audit = AuditCapture()
        let first = await audit.record(
            kind: .walletInitialized,
            subjectId: "subject-1",
            workspaceId: "workspace-1"
        )
        XCTAssertEqual(first.previousHash, String(repeating: "0", count: 64))
        XCTAssertEqual(first.sequenceNumber, 1)
        XCTAssertEqual(first.eventHash.count, 64)
    }

    func testChainLinksConsecutiveEvents() async {
        let audit = AuditCapture()
        let first = await audit.record(
            kind: .walletInitialized,
            subjectId: "subject-1",
            workspaceId: "workspace-1"
        )
        let second = await audit.record(
            kind: .signingExecuted,
            subjectId: "subject-1",
            workspaceId: "workspace-1"
        )
        XCTAssertEqual(second.previousHash, first.eventHash)
        XCTAssertEqual(second.sequenceNumber, 2)
    }

    func testVerifyChainDetectsTampering() async {
        let audit = AuditCapture()
        _ = await audit.record(
            kind: .walletInitialized,
            subjectId: "subject-1",
            workspaceId: "workspace-1"
        )
        _ = await audit.record(
            kind: .approvalRequested,
            subjectId: "subject-1",
            workspaceId: "workspace-1"
        )
        XCTAssertTrue(await audit.verifyChain())
    }

    func testRecordingSpyCapturesEverything() async {
        let spy = AuditRecordingSpy()
        _ = await spy.record(
            kind: .walletInitialized,
            subjectId: "subject-1",
            workspaceId: "workspace-1",
            detail: ["accountCount": "2"]
        )
        _ = await spy.record(
            kind: .lockStateChanged,
            subjectId: "subject-1",
            workspaceId: "workspace-1",
            detail: ["locked": "true"]
        )
        XCTAssertEqual(spy.captured.count, 2)
        XCTAssertEqual(spy.captured[0].kind, .walletInitialized)
        XCTAssertEqual(spy.captured[1].kind, .lockStateChanged)
    }
}
