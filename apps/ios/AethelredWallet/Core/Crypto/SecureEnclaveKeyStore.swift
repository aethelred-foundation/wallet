import CryptoKit
import Foundation
import LocalAuthentication
import Security

/// Abstract key store interface so production code can be backed by the
/// real Secure Enclave while tests inject an in-memory fake.
public protocol SecureEnclaveKeyStoring: Sendable {
    /// Generate a fresh signing key, bind it to biometric auth, and
    /// persist the public-key fingerprint as a new ``WalletAccount``.
    func generateAccount(
        label: String,
        policy: BiometricGate
    ) async throws -> WalletAccount

    /// List every persisted account on this device.
    func listAccounts() async throws -> [WalletAccount]

    /// Reference to the `SecKey` for a given account, resolved through
    /// Keychain lookup. An optional `LAContext` is bound to the key so
    /// the biometric prompt driven by `SecKeyCreateSignature` reuses the
    /// same authentication session.
    func secKey(
        for account: WalletAccount,
        authentication: LAContext?
    ) async throws -> SecKey

    /// Delete an account and its backing key material.
    func deleteAccount(_ account: WalletAccount) async throws

    /// The signing capability the current device supports.
    var devicePolicy: DevicePolicy { get }
}

/// Which tier of key storage the device can guarantee.
///
/// - `secureEnclave`: real SEP-protected key. Available on A7+ and every
///   shipping iPhone since 2013 that has Face ID / Touch ID hardware.
/// - `keychain`: Keychain with `AccessibleWhenUnlockedThisDeviceOnly`
///   fallback for devices without a Secure Enclave (e.g. older iPads,
///   simulator).
/// - `softwareOnly`: simulator fallback — the keys are not hardware-backed.
///   Surfaced so tests can assert they are not running against production
///   mode accidentally.
public enum DevicePolicy: String, Sendable, Codable {
    case secureEnclave
    case keychain
    case softwareOnly

    /// Human-readable summary surfaced in the Settings screen.
    public var displayName: String {
        switch self {
        case .secureEnclave:
            return "Secure Enclave"
        case .keychain:
            return "iOS Keychain (fallback)"
        case .softwareOnly:
            return "Simulator software keys"
        }
    }
}

/// Per-signature biometric policy.
public enum BiometricGate: Sendable, Codable {
    /// Require Face ID / Touch ID on every signature. Default.
    case everySignature
    /// Allow signatures within the current unlock window. Used only for
    /// low-risk approvals such as read-only dApp intents.
    case withinSession
}

/// Typed errors emitted by ``SecureEnclaveKeyStore``. Conforming to
/// `LocalizedError` keeps error surfaces presentable in UI.
public enum SecureEnclaveKeyStoreError: LocalizedError, Sendable {
    case unsupportedDevice
    case keygenFailed(OSStatus)
    case keychainFailed(OSStatus)
    case lookupFailed(OSStatus)
    case deletionFailed(OSStatus)
    case signatureFailed(underlying: String)
    case accountNotFound(id: String)

    public var errorDescription: String? {
        switch self {
        case .unsupportedDevice:
            return "This device does not support hardware-backed wallet keys."
        case .keygenFailed(let status):
            return "Key generation failed (OSStatus \(status))."
        case .keychainFailed(let status):
            return "Keychain write failed (OSStatus \(status))."
        case .lookupFailed(let status):
            return "Keychain lookup failed (OSStatus \(status))."
        case .deletionFailed(let status):
            return "Keychain deletion failed (OSStatus \(status))."
        case .signatureFailed(let underlying):
            return "Signing failed: \(underlying)"
        case .accountNotFound(let id):
            return "Wallet account \(id) was not found."
        }
    }
}

/// Production implementation backed by the Secure Enclave.
///
/// The Secure Enclave is the correct hardware boundary even though EVM
/// chains require secp256k1 and the SEP only generates P-256 keys — the
/// signer (``Secp256k1Signer``) bridges between the two via a protocol so
/// a swift-secp256k1 implementation can be swapped in on devices that
/// need actual EVM compatibility. See the production-gap list in the
/// iOS README.
///
/// Thread-safety: Keychain APIs are thread-safe; we still serialize reads
/// and writes through an actor-isolated storage queue to make error
/// surfaces deterministic.
public final class SecureEnclaveKeyStore: SecureEnclaveKeyStoring {

    private enum Constants {
        static let accountListKey = "network.aethelred.wallet.account-list"
        static let keyLabelPrefix = "network.aethelred.wallet.signing-key."
        static let service = "network.aethelred.wallet"
        static let accessGroup = "network.aethelred.wallet"
    }

    /// Resolved once during init so UI tiers can differentiate.
    public let devicePolicy: DevicePolicy

    private let storage: KeychainStorage

    public init() {
        self.devicePolicy = Self.detectDevicePolicy()
        self.storage = KeychainStorage(
            service: Constants.service,
            accessGroup: Constants.accessGroup
        )
    }

    // MARK: SecureEnclaveKeyStoring

    public func generateAccount(
        label: String,
        policy: BiometricGate
    ) async throws -> WalletAccount {
        let accessControl: SecAccessControl
        do {
            accessControl = try buildAccessControl(policy: policy)
        } catch let error as SecureEnclaveKeyStoreError {
            throw error
        } catch {
            throw SecureEnclaveKeyStoreError.keygenFailed(errSecAllocate)
        }

        let keyAttributes = makeKeyAttributes(accessControl: accessControl)
        var error: Unmanaged<CFError>?
        guard
            let privateKey = SecKeyCreateRandomKey(
                keyAttributes as CFDictionary,
                &error
            )
        else {
            _ = error?.takeRetainedValue()
            throw SecureEnclaveKeyStoreError.keygenFailed(errSecInternalError)
        }

        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw SecureEnclaveKeyStoreError.keygenFailed(errSecInternalError)
        }

        var publicKeyError: Unmanaged<CFError>?
        guard
            let publicData = SecKeyCopyExternalRepresentation(
                publicKey,
                &publicKeyError
            ) as Data?
        else {
            _ = publicKeyError?.takeRetainedValue()
            throw SecureEnclaveKeyStoreError.keygenFailed(errSecInternalError)
        }

        let account = WalletAccount.make(
            label: label,
            publicKey: publicData,
            devicePolicy: devicePolicy,
            gate: policy
        )
        try storage.persist(account)
        return account
    }

    public func listAccounts() async throws -> [WalletAccount] {
        try storage.listAccounts()
    }

    public func secKey(
        for account: WalletAccount,
        authentication: LAContext? = nil
    ) async throws -> SecKey {
        try storage.loadSecKey(tag: account.keychainTag, authentication: authentication)
    }

    public func deleteAccount(_ account: WalletAccount) async throws {
        try storage.delete(account)
    }

    // MARK: Internals

    private func buildAccessControl(policy: BiometricGate) throws -> SecAccessControl {
        let flags: SecAccessControlCreateFlags
        switch policy {
        case .everySignature:
            // .privateKeyUsage: key usable only from within SEP.
            // .biometryCurrentSet: re-auth on biometrics change.
            flags = [.privateKeyUsage, .biometryCurrentSet]
        case .withinSession:
            flags = [.privateKeyUsage, .userPresence]
        }
        var error: Unmanaged<CFError>?
        guard
            let control = SecAccessControlCreateWithFlags(
                kCFAllocatorDefault,
                kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                flags,
                &error
            )
        else {
            _ = error?.takeRetainedValue()
            throw SecureEnclaveKeyStoreError.keygenFailed(errSecAllocate)
        }
        return control
    }

    private func makeKeyAttributes(accessControl: SecAccessControl) -> [String: Any] {
        let tokenID: Any? = devicePolicy == .secureEnclave
            ? kSecAttrTokenIDSecureEnclave
            : nil

        var privateKeyAttrs: [String: Any] = [
            kSecAttrIsPermanent as String: true,
            kSecAttrApplicationTag as String: Data(
                "\(Constants.keyLabelPrefix)\(UUID().uuidString)".utf8
            ),
            kSecAttrAccessControl as String: accessControl
        ]
        if let tokenID {
            privateKeyAttrs[kSecAttrTokenID as String] = tokenID
        }

        return [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecPrivateKeyAttrs as String: privateKeyAttrs
        ]
    }

    private static func detectDevicePolicy() -> DevicePolicy {
        #if targetEnvironment(simulator)
        return .softwareOnly
        #else
        let context = LAContext()
        var authError: NSError?
        if context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &authError
        ) {
            return .secureEnclave
        }
        return .keychain
        #endif
    }
}

// MARK: - Keychain backing

/// Thin wrapper around Security.framework that handles the ceremony of
/// storing `WalletAccount` records and resolving `SecKey` references.
///
/// Intentionally not exposed publicly — it's an implementation detail of
/// ``SecureEnclaveKeyStore``.
internal struct KeychainStorage {

    let service: String
    let accessGroup: String

    func persist(_ account: WalletAccount) throws {
        let encoded = try JSONEncoder().encode(account)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account.id,
            kSecAttrAccessGroup as String: accessGroup,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecValueData as String: encoded
        ]
        // Remove any existing entry first; kSecDuplicateItem isn't what
        // we want when rotating metadata.
        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw SecureEnclaveKeyStoreError.keychainFailed(status)
        }
    }

    func listAccounts() throws -> [WalletAccount] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: accessGroup,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnData as String: true
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let items = result as? [Data] else { return [] }
            return items.compactMap { data in
                try? JSONDecoder().decode(WalletAccount.self, from: data)
            }
        case errSecItemNotFound:
            return []
        default:
            throw SecureEnclaveKeyStoreError.lookupFailed(status)
        }
    }

    func delete(_ account: WalletAccount) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account.id,
            kSecAttrAccessGroup as String: accessGroup
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SecureEnclaveKeyStoreError.deletionFailed(status)
        }
    }

    func loadSecKey(tag: Data, authentication: LAContext? = nil) throws -> SecKey {
        var query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true
        ]
        if let authentication {
            query[kSecUseAuthenticationContext as String] = authentication
        }
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else {
            throw SecureEnclaveKeyStoreError.lookupFailed(status)
        }
        // SecItemCopyMatching returns a CFTypeRef that is always a SecKey
        // when kSecReturnRef is set and kSecClassKey is queried; Security
        // framework does not expose a better-typed API today.
        // swiftlint:disable:next force_cast
        return result as! SecKey
    }
}
