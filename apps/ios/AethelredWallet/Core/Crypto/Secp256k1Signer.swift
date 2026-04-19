import CryptoKit
import Foundation
import LocalAuthentication
import Security

/// Abstract signer the rest of the app depends on.
///
/// We define the protocol around the logical operation (“sign this 32-byte
/// digest with the private key backing this account”) rather than the
/// specific curve so we can slot in a real secp256k1 implementation later
/// without touching callers. The current default
/// (``SecureEnclaveSignerP256``) uses P-256 — the curve the Secure Enclave
/// actually supports — and is explicit about the fact that real EVM
/// signing will require swift-secp256k1 wired up as a SwiftPM dep. That
/// production gap is tracked in the iOS README.
public protocol Secp256k1Signing: Sendable {
    /// Produce a 64-byte `(r || s)` signature over `digest` using the key
    /// bound to `account`. The returned signature is raw, without the
    /// recovery byte — EIP-155 recovery is appended by the caller in
    /// ``EIP1559Transaction``.
    func sign(
        digest: Data,
        with account: WalletAccount,
        authentication: LAContext
    ) async throws -> Data
}

/// Typed errors surfaced to callers of the signer.
public enum SignerError: LocalizedError, Sendable {
    case invalidDigestLength(Int)
    case signatureRejected(underlying: String)
    case keyUnavailable

    public var errorDescription: String? {
        switch self {
        case .invalidDigestLength(let got):
            return "Signer expected a 32-byte digest, got \(got)."
        case .signatureRejected(let underlying):
            return "Signing was rejected: \(underlying)"
        case .keyUnavailable:
            return "The private key for this account is not available."
        }
    }
}

/// Default Secure-Enclave-backed signer.
///
/// Uses `SecKeyCreateSignature` with `ecdsaSignatureDigestX962` so Face ID
/// prompts appear exactly once per signature, driven by the `LAContext`
/// the caller attaches. That mapping — authentication context ≡
/// signature ceremony — is the invariant we rely on for the audit log:
/// every `signing-executed` event should be preceded by a successful
/// biometric evaluation in the same `LAContext`.
public struct SecureEnclaveSignerP256: Secp256k1Signing {

    private let keyStore: SecureEnclaveKeyStoring

    public init(keyStore: SecureEnclaveKeyStoring) {
        self.keyStore = keyStore
    }

    public func sign(
        digest: Data,
        with account: WalletAccount,
        authentication: LAContext
    ) async throws -> Data {
        guard digest.count == 32 else {
            throw SignerError.invalidDigestLength(digest.count)
        }

        // Load the SecKey with `kSecUseAuthenticationContext` attached.
        // That binding is load-bearing: when SecKeyCreateSignature needs
        // to unlock the key the system drives biometrics through the
        // same LAContext we just evaluated, so the user sees exactly one
        // Face ID sheet per signature instead of a double-prompt.
        let secKey = try await keyStore.secKey(
            for: account,
            authentication: authentication
        )

        guard SecKeyIsAlgorithmSupported(
            secKey,
            .sign,
            .ecdsaSignatureDigestX962SHA256
        ) else {
            throw SignerError.keyUnavailable
        }

        // SecKeyCreateSignature returns a DER-encoded ECDSA signature.
        // We convert to raw (r||s) for consistency with what EIP-1559
        // RLP encoding expects.
        var error: Unmanaged<CFError>?
        guard
            let der = SecKeyCreateSignature(
                secKey,
                .ecdsaSignatureDigestX962SHA256,
                digest as CFData,
                &error
            ) as Data?
        else {
            let underlying = (error?.takeRetainedValue().localizedDescription) ?? "unknown"
            throw SignerError.signatureRejected(underlying: underlying)
        }

        return try Self.convertDerSignatureToRawRS(der)
    }

    /// Extract `r || s` (64 bytes, big-endian, left-padded) from a
    /// DER-encoded ECDSA signature.
    ///
    /// The format is ``0x30 len 0x02 rlen r 0x02 slen s``. We intentionally
    /// parse by hand rather than pulling in a dependency — the grammar is
    /// trivial and the attack surface matters.
    internal static func convertDerSignatureToRawRS(_ der: Data) throws -> Data {
        var buffer = Array(der)
        guard buffer.count > 8, buffer[0] == 0x30 else {
            throw SignerError.signatureRejected(
                underlying: "malformed DER header"
            )
        }
        // Skip SEQUENCE header.
        buffer.removeFirst(2)
        guard buffer.first == 0x02 else {
            throw SignerError.signatureRejected(
                underlying: "missing INTEGER for r"
            )
        }
        buffer.removeFirst() // consume INTEGER tag
        let rLen = Int(buffer.removeFirst())
        guard buffer.count >= rLen else {
            throw SignerError.signatureRejected(
                underlying: "truncated r component"
            )
        }
        var r = Array(buffer.prefix(rLen))
        buffer.removeFirst(rLen)
        guard buffer.first == 0x02 else {
            throw SignerError.signatureRejected(
                underlying: "missing INTEGER for s"
            )
        }
        buffer.removeFirst()
        let sLen = Int(buffer.removeFirst())
        guard buffer.count >= sLen else {
            throw SignerError.signatureRejected(
                underlying: "truncated s component"
            )
        }
        var s = Array(buffer.prefix(sLen))

        // Strip DER leading zeros and left-pad to 32 bytes.
        r = Self.normalizeComponent(r)
        s = Self.normalizeComponent(s)

        return Data(r + s)
    }

    private static func normalizeComponent(_ input: [UInt8]) -> [UInt8] {
        var component = input
        while component.count > 32 && component.first == 0x00 {
            component.removeFirst()
        }
        if component.count < 32 {
            component = [UInt8](repeating: 0x00, count: 32 - component.count) + component
        }
        return component
    }
}

/// In-memory deterministic signer used by tests.
///
/// Conforms to ``Secp256k1Signing`` so view models can be exercised
/// without touching the Secure Enclave. Tests assert against known
/// vectors by injecting a seed; production code should never instantiate
/// this type.
public struct DeterministicStubSigner: Secp256k1Signing {

    private let fixedSignature: Data

    public init(fixedSignature: Data = Data(repeating: 0xAB, count: 64)) {
        self.fixedSignature = fixedSignature
    }

    public func sign(
        digest _: Data,
        with _: WalletAccount,
        authentication _: LAContext
    ) async throws -> Data {
        fixedSignature
    }
}
