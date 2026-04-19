import XCTest
@testable import AethelredWallet

/// Persistence round-trip tests. These run outside the SwiftData
/// container (SwiftData requires iOS-only types that XCTest on the
/// Swift Package Manager path cannot execute) and instead assert on
/// the domain ↔ model converters — the bytes that actually travel
/// across the boundary.
final class PersistenceTests: XCTestCase {

    func testAuditEventConverterPreservesHashes() {
        let event = AuditEvent(
            id: "evt-1",
            sequenceNumber: 1,
            timestamp: 1_713_000_000_000,
            kind: .policyEvaluated,
            subjectId: "s",
            workspaceId: "w",
            appId: "a",
            sessionId: "sess",
            intentId: nil,
            detail: ["k": "v"],
            previousHash: String(repeating: "0", count: 64),
            eventHash: String(repeating: "a", count: 64)
        )
        let stored = StoredAuditEvent.from(event)
        XCTAssertEqual(stored.eventHash, event.eventHash)
        let back = stored.toDomain()
        XCTAssertEqual(back?.kind, .policyEvaluated)
        XCTAssertEqual(back?.detail, ["k": "v"])
    }

    func testAuditDetailEncodingSurvivesSpecialCharacters() {
        let detail = ["key": "value with \"quotes\" and slash /"]
        let encoded = StoredAuditEvent.encodeDetail(detail)
        let decoded = StoredAuditEvent.decodeDetail(encoded)
        XCTAssertEqual(decoded, detail)
    }

    func testCredentialConverterRoundTrip() {
        let record = VerifiableCredentialRecord(
            id: "c-1",
            issuer: "i",
            subject: "s",
            schema: "kyc",
            payload: "{}",
            issuedAt: 1_713_000_000_000,
            expiresAt: 1_713_999_999_999
        )
        let stored = StoredCredential.from(record)
        let back = stored.toDomain()
        XCTAssertEqual(back.id, record.id)
        XCTAssertEqual(back.schema, record.schema)
        XCTAssertEqual(back.expiresAt, record.expiresAt)
    }
}
