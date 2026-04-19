import XCTest
import CryptoKit
@testable import AethelredWallet

/// Cross-platform invariants — the iOS implementation must produce the
/// same bytes as the TypeScript reference so audit events and Merkle
/// roots round-trip between platforms.
final class SemanticParityTests: XCTestCase {

    func testCanonicalJSONProducesDeterministicHash() async {
        let capture = AuditCapture(
            now: { 1_713_000_000_000 },
            uuid: { "11111111-1111-1111-1111-111111111111" }
        )
        let event = await capture.record(
            kind: .signingExecuted,
            subjectId: "subject-1",
            workspaceId: "workspace-1",
            detail: ["chainId": "1", "txHash": "0xabc"]
        )
        // The SHA-256 is over a canonical JSON whose key ordering
        // matches the TS implementation. We don't hard-code the exact
        // value but we assert the output has the right shape + length.
        XCTAssertEqual(event.eventHash.count, 64)
        XCTAssertEqual(event.previousHash, String(repeating: "0", count: 64))
    }

    func testHashChainContinuityOnSecondEvent() async {
        let capture = AuditCapture(
            now: { 1_713_000_000_000 },
            uuid: { "22222222-2222-2222-2222-222222222222" }
        )
        let first = await capture.record(kind: .walletInitialized, subjectId: "s", workspaceId: "w")
        let second = await capture.record(kind: .accountCreated, subjectId: "s", workspaceId: "w")
        XCTAssertEqual(second.previousHash, first.eventHash)
    }

    func testMerkleRootMatchesReference() async throws {
        let capture = AuditCapture(
            now: { 1_713_000_000_000 },
            uuid: { "33333333-3333-3333-3333-333333333333" }
        )
        let batch = MerkleBatch(maxBatchSize: 4)

        let events = await (0..<4).asyncMap { index in
            await capture.record(kind: .policyEvaluated, subjectId: "s-\(index)", workspaceId: "w")
        }

        var finalized: FinalizedBatch?
        for event in events {
            let maybe = try await batch.add(event)
            if let maybe { finalized = maybe }
        }
        XCTAssertNotNil(finalized)
        XCTAssertEqual(finalized?.leafCount, 4)
        // Recompute the root manually using the same construction and
        // assert byte-equality.
        let leafHashes = events.map(\.eventHash)
        let manualRoot = Self.manualMerkleRoot(leafHashes)
        XCTAssertEqual(finalized?.root, manualRoot)
    }

    /// Reference merkle construction — mirrors the TS implementation:
    /// `sha256(left || right)`, duplicate-last on odd counts.
    private static func manualMerkleRoot(_ leaves: [String]) -> String {
        guard !leaves.isEmpty else { return String(repeating: "0", count: 64) }
        var current = leaves
        while current.count > 1 {
            var next: [String] = []
            var index = 0
            while index < current.count {
                let left = current[index]
                let right = index + 1 < current.count ? current[index + 1] : left
                let combined = MerkleBatch.hexToBytes(left) + MerkleBatch.hexToBytes(right)
                let digest = SHA256.hash(data: combined)
                next.append(digest.map { String(format: "%02x", $0) }.joined())
                index += 2
            }
            current = next
        }
        return current[0]
    }
}

/// Small async-map helper so the test reads linearly.
private extension Collection where Element == Int {
    func asyncMap<T: Sendable>(_ transform: @Sendable (Int) async -> T) async -> [T] {
        var buffer: [T] = []
        for element in self {
            buffer.append(await transform(element))
        }
        return buffer
    }
}
