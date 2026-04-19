/**
 * Transaction simulation and risk assessment types.
 * Inspired by Rabby's safety-first UX - translates opaque transactions
 * into understandable risk views.
 */

export type RiskLevel = "safe" | "low" | "medium" | "high" | "critical";

export type SimulationStatus = "success" | "revert" | "unknown" | "timeout";

export type ChangeKind =
  | "token-transfer-out"
  | "token-transfer-in"
  | "token-approval"
  | "token-approval-revoke"
  | "nft-transfer-out"
  | "nft-transfer-in"
  | "native-transfer-out"
  | "native-transfer-in"
  | "contract-interaction"
  | "contract-deployment"
  | "permission-grant"
  | "state-change";

export interface BalanceChange {
  kind: ChangeKind;
  asset: string;
  symbol: string;
  amount: string;
  decimals: number;
  usdValue?: string;
  direction: "in" | "out";
}

export interface ApprovalChange {
  kind: "token-approval" | "token-approval-revoke";
  asset: string;
  symbol: string;
  spender: string;
  spenderLabel?: string;
  allowance: string;
  isUnlimited: boolean;
}

export interface ContractInfo {
  address: string;
  name?: string;
  verified: boolean;
  isProxy: boolean;
  deployedAt?: number;
  interactionCount?: number;
  trustScore: RiskLevel;
}

export interface RiskSignal {
  id: string;
  level: RiskLevel;
  category: RiskCategory;
  title: string;
  description: string;
}

export type RiskCategory =
  | "contract-safety"
  | "approval-risk"
  | "phishing"
  | "value-risk"
  | "address-risk"
  | "gas-risk"
  | "compliance"
  | "policy-violation";

/**
 * A decoded contract call — the structured output of the ABI decoder.
 * Populated when the selector matches one of the dangerous selectors
 * the minimal decoder recognizes (approve, transferFrom, permit,
 * setApprovalForAll, Seaport fulfillOrder, etc.).
 *
 * Used by the approval UI to render real parameter values + warnings
 * instead of the old "Unknown contract call" fallback.
 */
export interface DecodedCall {
  /** The target contract address (pass-through from the tx). */
  to?: string;
  /** Method name resolved from the selector, e.g. "approve", "transfer". */
  method: string;
  /** 10-char hex selector including the 0x prefix. */
  selector: string;
  /** Decoded parameter map: name → string (bigints are stringified). */
  params: Record<string, string>;
  /** Pre-computed risk classification so the UI doesn't duplicate logic. */
  risk: RiskLevel;
  /** Human-readable warnings the UI should surface prominently. */
  warnings: string[];
  /** Optional extra metadata (e.g. isUnlimitedApproval, isPermit). */
  metadata?: Record<string, unknown>;
}

export interface SimulationResult {
  status: SimulationStatus;
  balanceChanges: BalanceChange[];
  approvalChanges: ApprovalChange[];
  contract: ContractInfo | null;
  riskSignals: RiskSignal[];
  overallRisk: RiskLevel;
  /**
   * If the transaction matched a recognized selector, the decoded call
   * data appears here. The approval UI consumes this to render specific
   * parameter cards (spender + amount for approve, from/to/tokenId for
   * safeTransferFrom, etc.) instead of a generic "contract interaction".
   */
  decodedCall?: DecodedCall;
  gasEstimate?: {
    gasLimit: string;
    gasPrice: string;
    totalCostWei: string;
    totalCostUsd?: string;
  };
  /** Human-readable warnings assembled from all sources. */
  warnings?: string[];
  simulatedAt: number;
}

export interface MessageAnalysis {
  isPermit: boolean;
  isDangerousSignature: boolean;
  decodedContent: string;
  riskSignals: RiskSignal[];
  overallRisk: RiskLevel;
}

export interface AddressReputation {
  address: string;
  label?: string;
  isContract: boolean;
  isKnownScam: boolean;
  isKnownProtocol: boolean;
  firstSeen?: number;
  transactionCount?: number;
  riskLevel: RiskLevel;
  tags: string[];
}

export interface NetworkConfig {
  chainId: string;
  name: string;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorerUrl?: string;
  isTestnet: boolean;
}
