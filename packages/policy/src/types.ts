import type {
  DecisionOutcome,
  IntentKind,
  PolicyMode,
  TrustLevel,
  WorkspaceKind,
  WorkspaceRole,
} from "@aethelred/wallet-connect";

export interface PolicyRule {
  id: string;
  name: string;
  priority: number;
  conditions: PolicyCondition[];
  outcome: DecisionOutcome;
  message: string;
}

export type PolicyConditionField =
  | "intent.kind"
  | "app.trustLevel"
  | "workspace.kind"
  | "subject.role"
  | "amount"
  | "amountUsd"
  | "chainId"
  | "destination"
  | "destinationCategory"
  | "assetSymbol"
  | "assetCategory"
  | "session.exists"
  | "sessionAgeMs"
  | "requestedOperationCount24h"
  | "cumulativeValueSpentUsd24h";

export type PolicyConditionOperator =
  | "equals"
  | "not-equals"
  | "in"
  | "not-in"
  | "greater-than"
  | "less-than"
  | "exists"
  | "not-exists";

export interface PolicyCondition {
  field: PolicyConditionField;
  operator: PolicyConditionOperator;
  value: unknown;
}

export interface PolicyBundle {
  id: string;
  name: string;
  mode: PolicyMode;
  workspaceKind: WorkspaceKind;
  rules: PolicyRule[];
  version: number;
  createdAt: number;
}

export interface PolicyContext {
  subject: {
    id: string;
    role: WorkspaceRole;
  };
  workspace: {
    id: string;
    kind: WorkspaceKind;
  };
  app: {
    id: string;
    origin: string;
    trustLevel: TrustLevel;
  };
  intent: {
    kind: IntentKind;
    method: string;
  };
  session: {
    exists: boolean;
    id?: string;
  };
  account: {
    id: string;
    address: string;
    namespace: string;
  };
  chainId?: string;
  /**
   * Destination address for a transfer intent. Populated by the
   * caller (background.ts handleSendTransaction) from the decoded
   * tx `to` field, not from the raw intent payload — the old
   * context-builder pulled this from `intent.payload.destination`
   * which was never set by the EVM RPC path, making destination
   * rules dead code.
   */
  destination?: string;
  /**
   * Destination category — resolved by the caller from the
   * AddressBook + TokenListService so destination allowlist rules
   * can actually fire.
   */
  destinationCategory?: "known-contact" | "known-contract" | "unknown" | "blacklisted";
  /** USD value of the pending transfer, if known. */
  amountUsd?: number;
  /**
   * Raw amount in the asset's native unit (wei for ETH, base units
   * for ERC-20). Strings because bigint doesn't survive JSON.
   */
  amount?: number;
  assetId?: string;
  /** Token symbol, if resolved. */
  assetSymbol?: string;
  /**
   * Broad asset category — stablecoin / rwa / governance / etc.
   * Enables different spend thresholds per category.
   */
  assetCategory?: "native" | "staking" | "stablecoin" | "rwa" | "settlement" | "governance" | "unknown";
  /** How long the dApp session has been active, in ms. */
  sessionAgeMs?: number;
  /** Number of operations this subject has executed in the past 24h. */
  requestedOperationCount24h?: number;
  /** Cumulative USD value the subject has spent in the past 24h. */
  cumulativeValueSpentUsd24h?: number;
  deploymentTier?: string;
}

export interface PolicyEvaluationResult {
  outcome: DecisionOutcome;
  matchedRules: PolicyRule[];
  warnings: string[];
  requiresApproval: boolean;
  approvalDetails?: {
    requiredAction: string;
    reviewerRoles: WorkspaceRole[];
  };
  timestamp: number;
}

export interface PolicyDecision {
  intentId: string;
  result: PolicyEvaluationResult;
  bundleId: string;
  bundleVersion: number;
}
