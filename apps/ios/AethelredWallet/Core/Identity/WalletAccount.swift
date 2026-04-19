import CryptoKit
import Foundation

/// Local representation of a wallet account.
///
/// Accounts are keyed by `id` (a deterministic UUID derived from the
/// public key's SHA-256 fingerprint), hold the EVM display address, and
/// carry the `keychainTag` used to look up the backing SecKey.
///
/// Private keys are *never* stored on this type — they live in the
/// Secure Enclave / Keychain and are resolved by reference via
/// ``SecureEnclaveKeyStore``.
public struct WalletAccount: Codable, Sendable, Equatable, Hashable, Identifiable {

    /// Stable identifier for the account. Derived from the public key
    /// so accounts are idempotent across reinstalls (if the user
    /// re-imports the same seed — reinstall without re-import loses the
    /// key, per our `AccessibleWhenUnlockedThisDeviceOnly` policy).
    public let id: String

    /// Human-readable label.
    public let label: String

    /// Hex-encoded EVM address derived from the public key (last 20
    /// bytes of the keccak256 of the uncompressed pubkey).
    public let address: String

    /// Hex-encoded full public key.
    public let publicKeyHex: String

    /// Keychain application tag used to locate the backing SecKey.
    public let keychainTag: Data

    /// Device-reported security tier this account is bound to.
    public let devicePolicy: DevicePolicy

    /// Biometric gate required for signing.
    public let gate: BiometricGate

    /// Subject identifier used in audit events.
    public let subjectId: String

    /// Creation timestamp (ms since epoch) for display purposes.
    public let createdAt: Int64

    public static func make(
        label: String,
        publicKey data: Data,
        devicePolicy: DevicePolicy,
        gate: BiometricGate
    ) -> WalletAccount {
        let digest = SHA256.hash(data: data)
        let id = digest.prefix(16)
            .map { String(format: "%02x", $0) }.joined()
        let address = Self.deriveEvmAddress(from: data)
        let tag = Data("network.aethelred.wallet.signing-key.\(id)".utf8)
        let publicKeyHex = data.map { String(format: "%02x", $0) }.joined()
        return WalletAccount(
            id: id,
            label: label,
            address: address,
            publicKeyHex: publicKeyHex,
            keychainTag: tag,
            devicePolicy: devicePolicy,
            gate: gate,
            subjectId: "subject-\(id)",
            createdAt: Int64(Date().timeIntervalSince1970 * 1000)
        )
    }

    /// Derive the EVM address. The canonical construction is the last
    /// 20 bytes of keccak256(uncompressed_public_key[1:]) — we drop the
    /// SEC1 0x04 prefix before hashing.
    public static func deriveEvmAddress(from publicKey: Data) -> String {
        var bytes = publicKey
        if bytes.first == 0x04 {
            bytes.removeFirst()
        }
        let digest = Keccak256.hash(bytes)
        let addressBytes = digest.suffix(20)
        return "0x" + addressBytes.map { String(format: "%02x", $0) }.joined()
    }
}
