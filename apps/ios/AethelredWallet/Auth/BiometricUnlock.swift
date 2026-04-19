import Foundation
import LocalAuthentication

/// Wraps the LAContext evaluation flow so the rest of the app calls a
/// strongly-typed async API.
///
/// Every signing ceremony goes through one of these and the same
/// `LAContext` is handed to `SecureEnclaveSignerP256.sign(...)` so a
/// single biometric prompt authorizes a single signature.
public protocol BiometricUnlocking: Sendable {
    /// Evaluate the `.deviceOwnerAuthenticationWithBiometrics` policy
    /// and return the successful `LAContext` the caller can reuse for
    /// signing. Throws on failure.
    func requestAuthentication(reason: String) async throws -> LAContext
}

/// Typed errors for biometric failures.
public enum BiometricError: LocalizedError, Sendable, Equatable {
    case unavailable(detail: String)
    case cancelled
    case failed(detail: String)

    public var errorDescription: String? {
        switch self {
        case .unavailable(let detail):
            return "Biometric authentication is not available: \(detail)"
        case .cancelled:
            return "Authentication was cancelled."
        case .failed(let detail):
            return "Authentication failed: \(detail)"
        }
    }
}

/// Production implementation.
public struct BiometricUnlock: BiometricUnlocking {

    public init() {}

    public func requestAuthentication(reason: String) async throws -> LAContext {
        let context = LAContext()
        context.localizedReason = reason
        context.interactionNotAllowed = false

        var evalError: NSError?
        let canEvaluate = context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &evalError
        )
        if !canEvaluate {
            throw BiometricError.unavailable(
                detail: evalError?.localizedDescription ?? "unknown"
            )
        }

        return try await withCheckedThrowingContinuation { continuation in
            context.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: reason
            ) { success, error in
                if success {
                    continuation.resume(returning: context)
                    return
                }
                let laError = error as? LAError
                switch laError?.code {
                case .userCancel, .appCancel, .systemCancel:
                    continuation.resume(throwing: BiometricError.cancelled)
                default:
                    continuation.resume(
                        throwing: BiometricError.failed(
                            detail: error?.localizedDescription ?? "unknown"
                        )
                    )
                }
            }
        }
    }
}

/// Test double that bypasses the real biometric prompt.
public struct AlwaysSucceedBiometricUnlock: BiometricUnlocking {

    public init() {}

    public func requestAuthentication(reason _: String) async throws -> LAContext {
        LAContext()
    }
}
