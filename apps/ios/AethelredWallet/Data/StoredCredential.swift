import Foundation
import SwiftData

/// Persisted verifiable credential.
@Model
public final class StoredCredential {
    @Attribute(.unique) public var id: String
    public var issuer: String
    public var subjectId: String
    public var schema: String
    public var payload: String
    public var issuedAt: Int64
    public var expiresAt: Int64?

    public init(
        id: String,
        issuer: String,
        subjectId: String,
        schema: String,
        payload: String,
        issuedAt: Int64,
        expiresAt: Int64? = nil
    ) {
        self.id = id
        self.issuer = issuer
        self.subjectId = subjectId
        self.schema = schema
        self.payload = payload
        self.issuedAt = issuedAt
        self.expiresAt = expiresAt
    }

    public func toDomain() -> VerifiableCredentialRecord {
        VerifiableCredentialRecord(
            id: id,
            issuer: issuer,
            subject: subjectId,
            schema: schema,
            payload: payload,
            issuedAt: issuedAt,
            expiresAt: expiresAt
        )
    }

    public static func from(_ record: VerifiableCredentialRecord) -> StoredCredential {
        StoredCredential(
            id: record.id,
            issuer: record.issuer,
            subjectId: record.subject,
            schema: record.schema,
            payload: record.payload,
            issuedAt: record.issuedAt,
            expiresAt: record.expiresAt
        )
    }
}
