import AuthenticationServices
import Foundation

/// Kicks off a platform-passkey enrollment using
/// `ASAuthorizationPlatformPublicKeyCredentialProvider`.
///
/// The enrollment flow is asynchronous and driven by the system:
///  1. We construct a registration request tied to a relying party
///     (`aethelred.network`).
///  2. `ASAuthorizationController` presents the native sheet.
///  3. On success we receive the credential ID + attestation; we
///     persist the credential ID via ``CredentialStoring`` so we can
///     present the right passkey to the right user later.
@MainActor
public final class PasskeyEnrollment: NSObject {

    public typealias Completion = @Sendable (Result<PasskeyCredentialRecord, Error>) -> Void

    private let credentialStore: CredentialStoring
    private let relyingPartyIdentifier: String
    private var continuation: CheckedContinuation<PasskeyCredentialRecord, Error>?

    public init(
        credentialStore: CredentialStoring = CredentialStore(),
        relyingPartyIdentifier: String = "aethelred.network"
    ) {
        self.credentialStore = credentialStore
        self.relyingPartyIdentifier = relyingPartyIdentifier
    }

    /// Present the passkey enrollment sheet for a given user. Returns
    /// the freshly-stored credential record on success.
    public func enroll(
        userIdentifier: String,
        userDisplayName: String,
        challenge: Data
    ) async throws -> PasskeyCredentialRecord {
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: relyingPartyIdentifier
        )
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge,
            name: userDisplayName,
            userID: Data(userIdentifier.utf8)
        )

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            controller.performRequests()
        }
    }
}

extension PasskeyEnrollment: ASAuthorizationControllerDelegate {

    public nonisolated func authorizationController(
        controller _: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        Task { @MainActor in
            guard
                let credential = authorization.credential
                    as? ASAuthorizationPlatformPublicKeyCredentialRegistration
            else {
                continuation?.resume(
                    throwing: PasskeyEnrollmentError.unexpectedCredentialType
                )
                continuation = nil
                return
            }
            let record = PasskeyCredentialRecord(
                credentialId: credential.credentialID,
                relyingPartyIdentifier: relyingPartyIdentifier,
                userIdentifier: "",
                userDisplayName: "Wallet account"
            )
            do {
                try await credentialStore.register(record)
                continuation?.resume(returning: record)
            } catch {
                continuation?.resume(throwing: error)
            }
            continuation = nil
        }
    }

    public nonisolated func authorizationController(
        controller _: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        Task { @MainActor in
            continuation?.resume(throwing: error)
            continuation = nil
        }
    }
}

extension PasskeyEnrollment: ASAuthorizationControllerPresentationContextProviding {
    public nonisolated func presentationAnchor(
        for _: ASAuthorizationController
    ) -> ASPresentationAnchor {
        ASPresentationAnchor()
    }
}

/// Errors surfaced when passkey enrollment cannot complete.
public enum PasskeyEnrollmentError: LocalizedError, Sendable {
    case unexpectedCredentialType

    public var errorDescription: String? {
        switch self {
        case .unexpectedCredentialType:
            return "Unexpected credential type returned from authorization."
        }
    }
}
