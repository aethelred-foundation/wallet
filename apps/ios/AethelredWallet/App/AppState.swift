import Combine
import Foundation
import SwiftUI

/// Long-lived observable container for the authenticated wallet session.
///
/// `AppState` is the single source of truth consumed by every SwiftUI
/// surface. It owns:
///  - the currently-selected workspace and account,
///  - the in-memory list of known accounts,
///  - the lock status (``isLocked``) and the last active moment,
///  - the chain the UI is currently displaying balances for.
///
/// Mutations happen on the main actor; heavy work (keychain I/O, RPC
/// calls) is funneled through async boundaries that eventually call
/// back into `@MainActor` setters declared here.
@MainActor
public final class AppState: ObservableObject {

    // MARK: Lock lifecycle

    /// `true` while the lock screen is presented. Set by ``lock()`` and
    /// cleared by ``unlock()``.
    @Published public private(set) var isLocked: Bool = true

    /// Timestamp of the last user-originated interaction the app observed.
    /// The lock coordinator uses this to decide whether the inactivity
    /// grace period has elapsed after a foreground transition.
    @Published public private(set) var lastActivityAt: Date = .init()

    // MARK: Identity

    /// Ordered list of wallet accounts known to this device.
    @Published public private(set) var accounts: [WalletAccount] = []

    /// Index of the currently-selected account in ``accounts``. `nil` when
    /// the wallet has not yet been bootstrapped.
    @Published public private(set) var selectedAccountIndex: Int?

    /// The current workspace — mirrors the `workspace` shape the control
    /// plane ships through @aethelred/wallet-connect.
    @Published public private(set) var workspace: WorkspaceContext = .personal

    // MARK: Network

    /// Chain the UI is currently showing state for. Defaults to Ethereum
    /// Mainnet and is updated via the settings screen.
    @Published public private(set) var selectedChainId: Int = 1

    // MARK: Dependencies

    private let keyStore: SecureEnclaveKeyStoring
    private let credentialStore: CredentialStoring
    private let audit: AuditCapturing

    /// Designated initializer. Defaults are production; tests substitute
    /// in-memory fakes.
    public init(
        keyStore: SecureEnclaveKeyStoring = SecureEnclaveKeyStore(),
        credentialStore: CredentialStoring = CredentialStore(),
        audit: AuditCapturing = AuditCapture()
    ) {
        self.keyStore = keyStore
        self.credentialStore = credentialStore
        self.audit = audit
    }

    // MARK: Bootstrap

    /// Load persisted state from the keychain, emit a `wallet-initialized`
    /// audit event, and leave the app in the locked state ready to be
    /// unlocked by biometric auth.
    public func bootstrap() async {
        do {
            let loaded = try await keyStore.listAccounts()
            self.accounts = loaded
            self.selectedAccountIndex = loaded.isEmpty ? nil : 0
            await audit.record(
                kind: .walletInitialized,
                subjectId: loaded.first?.subjectId ?? "bootstrap",
                workspaceId: workspace.id,
                detail: ["accountCount": "\(loaded.count)"]
            )
        } catch {
            await audit.record(
                kind: .walletInitialized,
                subjectId: "bootstrap",
                workspaceId: workspace.id,
                detail: ["error": String(describing: error)]
            )
        }
    }

    // MARK: Lock control

    /// Snap to the lock screen. Called by ``AppLockCoordinator`` on
    /// background transitions and after inactivity expires.
    public func lock(reason: LockReason) async {
        guard !isLocked else { return }
        isLocked = true
        await audit.record(
            kind: .lockStateChanged,
            subjectId: currentSubjectId(),
            workspaceId: workspace.id,
            detail: ["locked": "true", "reason": reason.rawValue]
        )
    }

    /// Dismiss the lock screen and refresh the activity timestamp.
    public func unlock() async {
        guard isLocked else { return }
        isLocked = false
        lastActivityAt = .init()
        await audit.record(
            kind: .lockStateChanged,
            subjectId: currentSubjectId(),
            workspaceId: workspace.id,
            detail: ["locked": "false"]
        )
    }

    /// Record that the user interacted with the app so the inactivity
    /// timer resets. Safe to call from anywhere on the main actor.
    public func touchActivity() {
        lastActivityAt = .init()
    }

    // MARK: Account management

    /// Replace the selected account. Does nothing when `index` is out of
    /// range — views can subscribe to ``selectedAccountIndex`` to react.
    public func selectAccount(at index: Int) {
        guard accounts.indices.contains(index) else { return }
        selectedAccountIndex = index
    }

    /// Switch the active chain. Views re-query balances when this
    /// changes.
    public func setChain(_ chainId: Int) {
        selectedChainId = chainId
    }

    /// The currently-selected account, if any.
    public var currentAccount: WalletAccount? {
        guard
            let index = selectedAccountIndex,
            accounts.indices.contains(index)
        else {
            return nil
        }
        return accounts[index]
    }

    private func currentSubjectId() -> String {
        currentAccount?.subjectId ?? "anonymous"
    }
}

/// Why the wallet transitioned to the locked state. Emitted in the audit
/// log so investigations can distinguish "user tapped Lock" from
/// "background timeout".
public enum LockReason: String, Sendable {
    case explicit = "explicit-user-action"
    case background = "app-backgrounded"
    case inactivity = "inactivity-timeout"
    case authFailure = "auth-failure"
}

/// Lightweight mirror of the control-plane workspace shape.
///
/// In production the full workspace tree is materialized by the
/// `@aethelred/wallet-connect` package and synced down via the
/// authenticated API. For the app's local state we only need the
/// information the UI actually reads.
public struct WorkspaceContext: Codable, Sendable, Equatable {
    public let id: String
    public let kind: Kind
    public let displayName: String

    public enum Kind: String, Codable, Sendable, Equatable {
        case personal
        case team
        case enterprise
        case sovereign
    }

    public static let personal = WorkspaceContext(
        id: "workspace-personal",
        kind: .personal,
        displayName: "Personal"
    )
}
