import XCTest
@testable import AethelredWallet

final class MerkleBatchTests: XCTestCase {

    func testSingleLeafBatch() async throws {
        let batch = MerkleBatch(maxBatchSize: 1)
        let event = fakeEvent(hash: String(repeating: "a", count: 64), sequence: 1)
        _ = try await batch.add(event)
        guard let proof = await batch.proof(for: event.eventHash) else {
            XCTFail("missing proof")
            return
        }
        XCTAssertEqual(proof.leafIndex, 0)
        XCTAssertTrue(verifyMerkleProof(proof))
    }

    func testBatchOfFourLeaves() async throws {
        let batch = MerkleBatch(maxBatchSize: 4)
        let events = (1...4).map { index in
            fakeEvent(hash: String(repeating: String(index), count: 64), sequence: index)
        }
        for event in events {
            _ = try await batch.add(event)
        }
        for event in events {
            guard let proof = await batch.proof(for: event.eventHash) else {
                XCTFail("missing proof")
                return
            }
            XCTAssertTrue(
                verifyMerkleProof(proof),
                "proof for \(event.eventHash) failed verification"
            )
        }
    }

    func testDuplicateEventHashRejected() async throws {
        let batch = MerkleBatch(maxBatchSize: 4)
        let event = fakeEvent(hash: String(repeating: "0", count: 64), sequence: 1)
        _ = try await batch.add(event)
        do {
            _ = try await batch.add(event)
            XCTFail("duplicate add should have thrown")
        } catch MerkleBatchError.duplicateEventHash {
            // success
        }
    }

    func testInvalidHashRejected() async throws {
        let batch = MerkleBatch(maxBatchSize: 4)
        let event = fakeEvent(hash: "not-hex", sequence: 1)
        do {
            _ = try await batch.add(event)
            XCTFail("invalid hash should have thrown")
        } catch MerkleBatchError.invalidEventHash {
            // success
        }
    }

    // MARK: Helpers

    private func fakeEvent(hash: String, sequence: Int) -> AuditEvent {
        AuditEvent(
            id: UUID().uuidString,
            sequenceNumber: sequence,
            timestamp: Int64(sequence),
            kind: .approvalRequested,
            subjectId: "subject-1",
            workspaceId: "workspace-1",
            previousHash: String(repeating: "f", count: 64),
            eventHash: hash
        )
    }
}
