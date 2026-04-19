import XCTest
@testable import AethelredWallet

final class WorkflowServiceTests: XCTestCase {

    private func seeded() async -> WorkflowService {
        let service = WorkflowService()
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        await service.upsert(WorkflowRecord(
            id: "w",
            workspaceId: "ws",
            initiatorSubjectId: "s-init",
            intentKind: "transfer",
            summary: "200 USDC",
            quorumNeeded: 3,
            approvals: [],
            status: .pending,
            createdAt: now
        ))
        return service
    }

    func testStartsPending() async {
        let service = await seeded()
        let workflow = await service.get("w")
        XCTAssertEqual(workflow?.status, .pending)
    }

    func testOneApprovalMovesToAwaitingQuorum() async {
        let service = await seeded()
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let updated = await service.record(approval: WorkflowApproval(subjectId: "a", decision: .approved, occurredAt: now), for: "w")
        XCTAssertEqual(updated?.status, .awaitingQuorum)
        XCTAssertEqual(updated?.approvalCount, 1)
    }

    func testThreeApprovalsApprove() async {
        let service = await seeded()
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        for subjectId in ["a", "b", "c"] {
            _ = await service.record(approval: WorkflowApproval(subjectId: subjectId, decision: .approved, occurredAt: now), for: "w")
        }
        let final = await service.get("w")
        XCTAssertEqual(final?.status, .approved)
        XCTAssertEqual(final?.approvalCount, 3)
    }

    func testDuplicateApprovalIdempotent() async {
        let service = await seeded()
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        _ = await service.record(approval: WorkflowApproval(subjectId: "a", decision: .approved, occurredAt: now), for: "w")
        _ = await service.record(approval: WorkflowApproval(subjectId: "a", decision: .approved, occurredAt: now), for: "w")
        let final = await service.get("w")
        XCTAssertEqual(final?.approvalCount, 1)
    }

    func testDenyShortCircuits() async {
        let service = await seeded()
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        _ = await service.record(approval: WorkflowApproval(subjectId: "a", decision: .approved, occurredAt: now), for: "w")
        let denied = await service.record(approval: WorkflowApproval(subjectId: "b", decision: .denied, occurredAt: now), for: "w")
        XCTAssertEqual(denied?.status, .rejected)
    }
}
