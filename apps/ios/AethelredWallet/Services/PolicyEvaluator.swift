import Foundation

/// Wraps ``PolicyEngine`` with a context builder + result cache.
///
/// Policy engines are pure value types — this service layer adds the
/// transaction-specific ergonomics: a fluent builder for the
/// ``PolicyContext`` and a time-bound cache so we don't re-evaluate
/// the same set of inputs repeatedly.
public actor PolicyEvaluator {

    private struct Cached {
        let result: PolicyEvaluationResult
        let fetchedAt: Date
    }

    private var cache: [Int: Cached] = [:]
    private let engine: PolicyEngine
    private let ttl: TimeInterval
    private let now: @Sendable () -> Date

    public init(
        engine: PolicyEngine,
        ttl: TimeInterval = 2,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.engine = engine
        self.ttl = ttl
        self.now = now
    }

    /// Evaluate + cache the outcome for a given context.
    public func evaluate(context: PolicyContext) -> PolicyEvaluationResult {
        let key = context.cacheKey
        if let cached = cache[key], now().timeIntervalSince(cached.fetchedAt) < ttl {
            return cached.result
        }
        let result = engine.evaluate(context: context)
        cache[key] = Cached(result: result, fetchedAt: now())
        return result
    }

    /// Drop every cached decision. Call on explicit policy updates.
    public func invalidate() {
        cache.removeAll()
    }
}

private extension PolicyContext {
    /// Coarse hash so repeated evaluations of the same tx reuse the
    /// prior outcome.
    var cacheKey: Int {
        var hasher = Hasher()
        hasher.combine(subject.id)
        hasher.combine(workspace.id)
        hasher.combine(app.id)
        hasher.combine(intent.kind.rawValue)
        hasher.combine(intent.method)
        hasher.combine(account.id)
        hasher.combine(chainId ?? -1)
        hasher.combine(destination ?? "")
        hasher.combine(amountUsd ?? 0)
        return hasher.finalize()
    }
}

/// Utility builder for ``PolicyContext`` — used by ViewModels that
/// need to construct a context from the live ``AppState``.
public struct PolicyContextBuilder: Sendable {
    private var subject: PolicyContext.SubjectCtx?
    private var workspace: PolicyContext.WorkspaceCtx?
    private var app: PolicyContext.AppCtx?
    private var intent: PolicyContext.IntentCtx?
    private var session: PolicyContext.SessionCtx
    private var account: PolicyContext.AccountCtx?
    private var chainId: Int?
    private var destination: String?
    private var destinationCategory: DestinationCategory?
    private var amountUsd: Double?
    private var amount: Double?
    private var assetSymbol: String?
    private var assetCategory: AssetCategory?

    public init() {
        self.session = PolicyContext.SessionCtx(exists: false, id: nil)
    }

    public func subject(_ subject: PolicyContext.SubjectCtx) -> PolicyContextBuilder {
        var copy = self; copy.subject = subject; return copy
    }

    public func workspace(_ workspace: PolicyContext.WorkspaceCtx) -> PolicyContextBuilder {
        var copy = self; copy.workspace = workspace; return copy
    }

    public func app(_ app: PolicyContext.AppCtx) -> PolicyContextBuilder {
        var copy = self; copy.app = app; return copy
    }

    public func intent(kind: IntentKind, method: String) -> PolicyContextBuilder {
        var copy = self; copy.intent = PolicyContext.IntentCtx(kind: kind, method: method); return copy
    }

    public func session(exists: Bool, id: String?) -> PolicyContextBuilder {
        var copy = self; copy.session = PolicyContext.SessionCtx(exists: exists, id: id); return copy
    }

    public func account(_ account: PolicyContext.AccountCtx) -> PolicyContextBuilder {
        var copy = self; copy.account = account; return copy
    }

    public func chain(_ chainId: Int) -> PolicyContextBuilder {
        var copy = self; copy.chainId = chainId; return copy
    }

    public func destination(
        _ destination: String?,
        category: DestinationCategory? = nil
    ) -> PolicyContextBuilder {
        var copy = self
        copy.destination = destination
        copy.destinationCategory = category
        return copy
    }

    public func amount(_ amount: Double?, usd: Double?) -> PolicyContextBuilder {
        var copy = self; copy.amount = amount; copy.amountUsd = usd; return copy
    }

    public func asset(symbol: String?, category: AssetCategory? = nil) -> PolicyContextBuilder {
        var copy = self; copy.assetSymbol = symbol; copy.assetCategory = category; return copy
    }

    public func build() throws -> PolicyContext {
        guard let subject, let workspace, let app, let intent, let account else {
            throw PolicyEvaluatorError.missingRequiredField
        }
        return PolicyContext(
            subject: subject,
            workspace: workspace,
            app: app,
            intent: intent,
            session: session,
            account: account,
            chainId: chainId,
            destination: destination,
            destinationCategory: destinationCategory,
            amountUsd: amountUsd,
            amount: amount,
            assetId: nil,
            assetSymbol: assetSymbol,
            assetCategory: assetCategory
        )
    }
}

public enum PolicyEvaluatorError: LocalizedError, Sendable {
    case missingRequiredField

    public var errorDescription: String? {
        switch self {
        case .missingRequiredField:
            return "PolicyContextBuilder is missing a required field."
        }
    }
}
