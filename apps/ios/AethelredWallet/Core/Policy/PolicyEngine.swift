import Foundation

/// Field a policy condition can inspect.
public enum PolicyConditionField: String, Codable, Sendable, Equatable {
    case intentKind = "intent.kind"
    case appTrustLevel = "app.trustLevel"
    case workspaceKind = "workspace.kind"
    case subjectRole = "subject.role"
    case amount
    case amountUsd
    case chainId
    case destination
    case destinationCategory
    case assetSymbol
    case assetCategory
    case sessionExists = "session.exists"
    case sessionAgeMs
    case requestedOperationCount24h
    case cumulativeValueSpentUsd24h
}

/// Operator used by a policy condition.
public enum PolicyConditionOperator: String, Codable, Sendable, Equatable {
    case equals
    case notEquals = "not-equals"
    case inList = "in"
    case notInList = "not-in"
    case greaterThan = "greater-than"
    case lessThan = "less-than"
    case exists
    case notExists = "not-exists"
}

/// Condition expressing a single rule predicate. The `value` is encoded
/// as a ``PolicyConditionValue`` rather than `Any` to keep the engine
/// `Sendable`-clean.
public struct PolicyCondition: Codable, Sendable, Equatable {
    public let field: PolicyConditionField
    public let conditionOperator: PolicyConditionOperator
    public let value: PolicyConditionValue

    public init(
        field: PolicyConditionField,
        conditionOperator: PolicyConditionOperator,
        value: PolicyConditionValue
    ) {
        self.field = field
        self.conditionOperator = conditionOperator
        self.value = value
    }
}

/// Typed value a condition can be compared against.
public enum PolicyConditionValue: Codable, Sendable, Equatable {
    case string(String)
    case stringList([String])
    case number(Double)
    case boolean(Bool)
    case null
}

/// Priority-ordered rule.
public struct PolicyRule: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let priority: Int
    public let conditions: [PolicyCondition]
    public let outcome: DecisionOutcome
    public let message: String

    public init(
        id: String,
        name: String,
        priority: Int,
        conditions: [PolicyCondition],
        outcome: DecisionOutcome,
        message: String
    ) {
        self.id = id
        self.name = name
        self.priority = priority
        self.conditions = conditions
        self.outcome = outcome
        self.message = message
    }
}

/// Result of evaluating the rule set against a context.
public struct PolicyEvaluationResult: Sendable, Equatable {
    public let outcome: DecisionOutcome
    public let matchedRules: [PolicyRule]
    public let warnings: [String]
    public let requiresApproval: Bool
    public let timestamp: Int64
}

/// Minimal deterministic policy engine. Order rules by priority (higher
/// first) and apply the first one whose conditions all evaluate true.
/// If no rule matches, the default is `allow` — the wallet's control
/// plane is expected to ship rule bundles that include a catch-all deny
/// for sensitive intents.
public struct PolicyEngine: Sendable {

    private let rules: [PolicyRule]
    private let now: @Sendable () -> Int64

    public init(
        rules: [PolicyRule],
        now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.rules = rules.sorted { $0.priority > $1.priority }
        self.now = now
    }

    public func evaluate(context: PolicyContext) -> PolicyEvaluationResult {
        var warnings: [String] = []
        var matched: [PolicyRule] = []

        for rule in rules where rule.conditions.allSatisfy({ matches(condition: $0, context: context) }) {
            matched.append(rule)
            let needsApproval = rule.outcome == .requireApproval
                || rule.outcome == .challengeBiometric
            return PolicyEvaluationResult(
                outcome: rule.outcome,
                matchedRules: matched,
                warnings: warnings,
                requiresApproval: needsApproval,
                timestamp: now()
            )
        }

        warnings.append("No policy rule matched; defaulting to allow.")
        return PolicyEvaluationResult(
            outcome: .allow,
            matchedRules: [],
            warnings: warnings,
            requiresApproval: false,
            timestamp: now()
        )
    }

    // MARK: Predicate application

    private func matches(condition: PolicyCondition, context: PolicyContext) -> Bool {
        let value = fieldValue(condition.field, in: context)
        switch condition.conditionOperator {
        case .equals:
            return equal(value, condition.value)
        case .notEquals:
            return !equal(value, condition.value)
        case .inList:
            guard case .stringList(let list) = condition.value,
                  let stringValue = stringCast(value)
            else {
                return false
            }
            return list.contains(stringValue)
        case .notInList:
            guard case .stringList(let list) = condition.value else {
                return true
            }
            if let stringValue = stringCast(value) {
                return !list.contains(stringValue)
            }
            return true
        case .greaterThan:
            return compare(value, condition.value) == .greater
        case .lessThan:
            return compare(value, condition.value) == .less
        case .exists:
            return !isNil(value)
        case .notExists:
            return isNil(value)
        }
    }

    private func fieldValue(
        _ field: PolicyConditionField,
        in context: PolicyContext
    ) -> PolicyConditionValue {
        switch field {
        case .intentKind:
            return .string(context.intent.kind.rawValue)
        case .appTrustLevel:
            return .string(context.app.trustLevel.rawValue)
        case .workspaceKind:
            return .string(context.workspace.kind.rawValue)
        case .subjectRole:
            return .string(context.subject.role.rawValue)
        case .amount:
            return context.amount.map { .number($0) } ?? .null
        case .amountUsd:
            return context.amountUsd.map { .number($0) } ?? .null
        case .chainId:
            return context.chainId.map { .number(Double($0)) } ?? .null
        case .destination:
            return context.destination.map { .string($0) } ?? .null
        case .destinationCategory:
            return context.destinationCategory.map { .string($0.rawValue) } ?? .null
        case .assetSymbol:
            return context.assetSymbol.map { .string($0) } ?? .null
        case .assetCategory:
            return context.assetCategory.map { .string($0.rawValue) } ?? .null
        case .sessionExists:
            return .boolean(context.session.exists)
        case .sessionAgeMs:
            return context.sessionAgeMs.map { .number(Double($0)) } ?? .null
        case .requestedOperationCount24h:
            return context.requestedOperationCount24h.map { .number(Double($0)) } ?? .null
        case .cumulativeValueSpentUsd24h:
            return context.cumulativeValueSpentUsd24h.map { .number($0) } ?? .null
        }
    }

    private func equal(
        _ lhs: PolicyConditionValue,
        _ rhs: PolicyConditionValue
    ) -> Bool {
        switch (lhs, rhs) {
        case (.string(let a), .string(let b)):
            return a == b
        case (.number(let a), .number(let b)):
            return a == b
        case (.boolean(let a), .boolean(let b)):
            return a == b
        case (.null, .null):
            return true
        default:
            return false
        }
    }

    private enum ComparisonResult {
        case less, equal, greater, incomparable
    }

    private func compare(
        _ lhs: PolicyConditionValue,
        _ rhs: PolicyConditionValue
    ) -> ComparisonResult {
        if case .number(let left) = lhs, case .number(let right) = rhs {
            if left < right { return .less }
            if left > right { return .greater }
            return .equal
        }
        return .incomparable
    }

    private func stringCast(_ value: PolicyConditionValue) -> String? {
        if case .string(let inner) = value { return inner }
        return nil
    }

    private func isNil(_ value: PolicyConditionValue) -> Bool {
        if case .null = value { return true }
        return false
    }
}
