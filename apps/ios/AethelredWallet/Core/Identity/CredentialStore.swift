import Foundation
import Security

/// Stores passkey registration metadata in the iOS Keychain.
///
/// Only non-sensitive metadata is stored here — credential IDs,
/// associated relying parties, and user display names. The private
/// credential material never leaves the ASAuthorization / Secure Enclave
/// boundary; what we persist is the pointer the platform returns so we
/// can re-present the right credential to the right user on next
/// authentication.
public protocol CredentialStoring: Sendable {
    func list() async throws -> [PasskeyCredentialRecord]
    func register(_ record: PasskeyCredentialRecord) async throws
    func remove(id: String) async throws
    func find(credentialId: Data) async throws -> PasskeyCredentialRecord?
}

/// Metadata about a registered passkey credential.
public struct PasskeyCredentialRecord: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let credentialId: Data
    public let relyingPartyIdentifier: String
    public let userIdentifier: String
    public let userDisplayName: String
    public let createdAt: Int64

    public init(
        id: String = UUID().uuidString,
        credentialId: Data,
        relyingPartyIdentifier: String,
        userIdentifier: String,
        userDisplayName: String,
        createdAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) {
        self.id = id
        self.credentialId = credentialId
        self.relyingPartyIdentifier = relyingPartyIdentifier
        self.userIdentifier = userIdentifier
        self.userDisplayName = userDisplayName
        self.createdAt = createdAt
    }
}

/// Keychain-backed implementation.
public struct CredentialStore: CredentialStoring {

    private let service: String
    private let accessGroup: String

    public init(
        service: String = "network.aethelred.wallet.credentials",
        accessGroup: String = "network.aethelred.wallet"
    ) {
        self.service = service
        self.accessGroup = accessGroup
    }

    public func list() async throws -> [PasskeyCredentialRecord] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: accessGroup,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnData as String: true
        ]
        var items: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &items)
        switch status {
        case errSecSuccess:
            guard let encoded = items as? [Data] else { return [] }
            let decoder = JSONDecoder()
            return encoded.compactMap { data in
                try? decoder.decode(PasskeyCredentialRecord.self, from: data)
            }
        case errSecItemNotFound:
            return []
        default:
            throw SecureEnclaveKeyStoreError.lookupFailed(status)
        }
    }

    public func register(_ record: PasskeyCredentialRecord) async throws {
        let encoded = try JSONEncoder().encode(record)
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: record.id,
            kSecAttrAccessGroup as String: accessGroup,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        SecItemDelete(base as CFDictionary)

        var addAttrs = base
        addAttrs[kSecValueData as String] = encoded
        let status = SecItemAdd(addAttrs as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw SecureEnclaveKeyStoreError.keychainFailed(status)
        }
    }

    public func remove(id: String) async throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: id,
            kSecAttrAccessGroup as String: accessGroup
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            throw SecureEnclaveKeyStoreError.deletionFailed(status)
        }
    }

    public func find(credentialId: Data) async throws -> PasskeyCredentialRecord? {
        try await list().first(where: { $0.credentialId == credentialId })
    }
}
