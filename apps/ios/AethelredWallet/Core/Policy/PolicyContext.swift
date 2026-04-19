import Foundation

/// Shape of the context that the policy engine evaluates rules against.
/// Mirrors `PolicyContext` in `packages/policy/src/types.ts` so the iOS
/// wallet can reuse the same rule schema.
public struct PolicyContext: Sendable, Equatable {

    public struct SubjectCtx: Sendable, Equatable {
        public let id: String
        public let role: SubjectRole
    }

    public struct WorkspaceCtx: Sendable, Equatable {
        public let id: String
        public let kind: WorkspaceContext.Kind
    }

    public struct AppCtx: Sendable, Equatable {
        public let id: String
        public let origin: String
        public let trustLevel: TrustLevel
    }

    public struct IntentCtx: Sendable, Equatable {
        public let kind: IntentKind
        public let method: String
    }

    public struct SessionCtx: Sendable, Equatable {
        public let exists: Bool
        public let id: String?
    }

    public struct AccountCtx: Sendable, Equatable {
        public let id: String
        public let address: String
        public let namespace: ChainNamespace
    }

    public let subject: SubjectCtx
    public let workspace: WorkspaceCtx
    public let app: AppCtx
    public let intent: IntentCtx
    public let session: SessionCtx
    public let account: AccountCtx
    public let chainId: Int?
    public let destination: String?
    public let destinationCategory: DestinationCategory?
    public let amountUsd: Double?
    public let amount: Double?
    public let assetId: String?
    public let assetSymbol: String?
    public let assetCategory: AssetCategory?
    public let sessionAgeMs: Int64?
    public let requestedOperationCount24h: Int?
    public let cumulativeValueSpentUsd24h: Double?
    public let deploymentTier: String?

    public init(
        subject: SubjectCtx,
        workspace: WorkspaceCtx,
        app: AppCtx,
        intent: IntentCtx,
        session: SessionCtx,
        account: AccountCtx,
        chainId: Int? = nil,
        destination: String? = nil,
        destinationCategory: DestinationCategory? = nil,
        amountUsd: Double? = nil,
        amount: Double? = nil,
        assetId: String? = nil,
        assetSymbol: String? = nil,
        assetCategory: AssetCategory? = nil,
        sessionAgeMs: Int64? = nil,
        requestedOperationCount24h: Int? = nil,
        cumulativeValueSpentUsd24h: Double? = nil,
        deploymentTier: String? = nil
    ) {
        self.subject = subject
        self.workspace = workspace
        self.app = app
        self.intent = intent
        self.session = session
        self.account = account
        self.chainId = chainId
        self.destination = destination
        self.destinationCategory = destinationCategory
        self.amountUsd = amountUsd
        self.amount = amount
        self.assetId = assetId
        self.assetSymbol = assetSymbol
        self.assetCategory = assetCategory
        self.sessionAgeMs = sessionAgeMs
        self.requestedOperationCount24h = requestedOperationCount24h
        self.cumulativeValueSpentUsd24h = cumulativeValueSpentUsd24h
        self.deploymentTier = deploymentTier
    }
}

/// Trust level enumeration mirrored from `wallet-connect`.
public enum TrustLevel: String, Codable, Sendable, Equatable {
    case firstParty = "first-party"
    case verified
    case known
    case unknown
    case blocked
}

/// Intent kinds the engine understands.
public enum IntentKind: String, Codable, Sendable, Equatable {
    case transferNative = "transfer-native"
    case transferErc20 = "transfer-erc20"
    case contractCall = "contract-call"
    case signMessage = "sign-message"
    case signTypedData = "sign-typed-data"
    case approveSpender = "approve-spender"
    case revokeSpender = "revoke-spender"
}

/// Destination categorization.
public enum DestinationCategory: String, Codable, Sendable, Equatable {
    case knownContact = "known-contact"
    case knownContract = "known-contract"
    case unknown
    case blacklisted
}

/// Asset category.
public enum AssetCategory: String, Codable, Sendable, Equatable {
    case native
    case staking
    case stablecoin
    case rwa
    case settlement
    case governance
    case unknown
}

/// Decision outcome returned by a rule match.
public enum DecisionOutcome: String, Codable, Sendable, Equatable {
    case allow
    case deny
    case requireApproval = "require-approval"
    case challengeBiometric = "challenge-biometric"
}
