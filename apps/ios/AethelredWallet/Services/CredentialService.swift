import CryptoKit
import Foundation

/// Stored verifiable credential record.
public struct VerifiableCredentialRecord: Sendable, Equatable, Codable, Identifiable {
    public let id: String
    public let issuer: String
    public let subject: String
    public let schema: String
    public let payload: String
    public let issuedAt: Int64
    public let expiresAt: Int64?

    public init(
        id: String,
        issuer: String,
        subject: String,
        schema: String,
        payload: String,
        issuedAt: Int64,
        expiresAt: Int64? = nil
    ) {
        self.id = id
        self.issuer = issuer
        self.subject = subject
        self.schema = schema
        self.payload = payload
        self.issuedAt = issuedAt
        self.expiresAt = expiresAt
    }
}

/// Presentation descriptor shaped by a verifier.
public struct PresentationDescriptor: Sendable, Equatable, Codable {
    public let id: String
    public let requested: [String]
    public let challenge: String

    public init(id: String, requested: [String], challenge: String) {
        self.id = id
        self.requested = requested
        self.challenge = challenge
    }
}

/// Built presentation ready to be sent to a verifier.
public struct VerifiablePresentation: Sendable, Equatable, Codable {
    public let id: String
    public let descriptorId: String
    public let selectedCredentials: [String]
    public let proof: String
    public let createdAt: Int64

    public init(
        id: String,
        descriptorId: String,
        selectedCredentials: [String],
        proof: String,
        createdAt: Int64
    ) {
        self.id = id
        self.descriptorId = descriptorId
        self.selectedCredentials = selectedCredentials
        self.proof = proof
        self.createdAt = createdAt
    }
}

/// Credential store + presentation builder abstraction.
public protocol CredentialServicing: Sendable {
    func list() async throws -> [VerifiableCredentialRecord]
    func add(_ record: VerifiableCredentialRecord) async throws
    func remove(id: String) async throws
    func buildPresentation(
        for descriptor: PresentationDescriptor,
        wallet: WalletAccount
    ) async throws -> VerifiablePresentation
}

/// Minimal in-memory implementation used by tests + as the default
/// until a persistent store is wired in.
public actor CredentialService: CredentialServicing {

    private var credentials: [String: VerifiableCredentialRecord] = [:]

    public init() {}

    public func list() async throws -> [VerifiableCredentialRecord] {
        Array(credentials.values).sorted { $0.issuedAt > $1.issuedAt }
    }

    public func add(_ record: VerifiableCredentialRecord) async throws {
        credentials[record.id] = record
    }

    public func remove(id: String) async throws {
        credentials.removeValue(forKey: id)
    }

    public func buildPresentation(
        for descriptor: PresentationDescriptor,
        wallet: WalletAccount
    ) async throws -> VerifiablePresentation {
        let matching = descriptor.requested.compactMap { schema in
            credentials.values.first(where: { $0.schema == schema })?.id
        }
        let digest = SHA256.hash(
            data: Data(
                [
                    descriptor.id,
                    descriptor.challenge,
                    wallet.address,
                    matching.joined(separator: ",")
                ].joined().utf8
            )
        )
        let proof = digest.map { String(format: "%02x", $0) }.joined()
        return VerifiablePresentation(
            id: UUID().uuidString,
            descriptorId: descriptor.id,
            selectedCredentials: matching,
            proof: proof,
            createdAt: Int64(Date().timeIntervalSince1970 * 1000)
        )
    }
}
