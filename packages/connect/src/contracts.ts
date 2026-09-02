export type AethelredMode = "personal" | "enterprise" | "sovereign";

export type TrustLevel = "first-party" | "partner" | "unverified";

export type AppReadiness = "live" | "design" | "planned";

export type AccountNamespace = "eip155" | "aethelred";

export type CustodyMode =
  | "local"
  | "imported"
  | "hardware"
  | "institutional"
  | "approval-bound";

export type AssuranceLevel =
  | "passkey"
  | "device-key"
  | "hardware"
  | "approval-bound";

export type WorkspaceKind = "personal" | "enterprise" | "sovereign";

export type WorkspaceRole =
  | "owner"
  | "operator"
  | "treasury-admin"
  | "compliance-reviewer";

export type PolicyMode =
  | "guided"
  | "approval-required"
  | "dual-control"
  | "committee";

export type IntentKind =
  | "connect"
  | "sign-message"
  | "sign-transaction"
  | "switch-workspace"
  | "session-update";

export type DecisionOutcome =
  | "allow"
  | "warn"
  | "approval-required"
  | "deny";

export interface EIP1193RequestArguments {
  method: string;
  params?: readonly unknown[] | object;
}

export interface AppIdentity {
  id: string;
  name: string;
  origin: string;
  trustLevel: TrustLevel;
}

export interface WalletAccount {
  id: string;
  label: string;
  address: string;
  namespace: AccountNamespace;
  custody: CustodyMode;
  assurance: AssuranceLevel;
}

export interface SubjectSummary {
  id: string;
  displayName: string;
  kind: "person" | "service";
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: WorkspaceKind;
  role: WorkspaceRole;
  summary: string;
}

export interface PolicySummary {
  mode: PolicyMode;
  highlights: string[];
}

export interface SessionSummary {
  id: string;
  appName: string;
  origin: string;
  trustLevel: TrustLevel;
  permissions: string[];
  status: "active" | "pending" | "revoked";
  /** Authoritative session creation time when available. */
  createdAt?: number;
}

export interface AppCatalogEntry {
  id: string;
  name: string;
  category: string;
  trustLevel: TrustLevel;
  readiness: AppReadiness;
  integrationMode: "evm" | "compatibility" | "native";
  summary: string;
}

/**
 * Discriminated `ApprovalDetail` union — the structured payload that
 * the approval UI uses to render a proper confirmation screen for each
 * kind of dApp request.
 *
 * Before this type existed, the approval UI only had {title, summary,
 * appName, requiredAction} — all plain strings — and had to regex-scrape
 * the summary string for an amount/asset. That worked for the demo intent
 * protocol but completely broke for real `eth_sendTransaction` / signing
 * requests, where the user would see "Confirm transaction" with no
 * recipient, no value, no gas fee, and no permit warning — a security
 * regression from the previous auto-sign behavior.
 *
 * Each variant carries only the fields the UI actually needs to render.
 * Hex values (`value`, `gasLimit`, etc.) are strings rather than bigints
 * because the summary is serialized over `chrome.runtime.sendMessage`
 * which uses JSON — bigints don't survive that trip.
 */
export type ApprovalDetail =
  | {
      kind: "tx";
      chainId: string;
      from: string;
      to: string | null;
      /** Hex-encoded wei */
      value: string;
      /** 0x-prefixed hex calldata */
      data: string;
      nonce: number;
      /** Hex-encoded gas limit */
      gasLimit: string;
      /** Hex-encoded max fee per gas */
      maxFeePerGas: string;
      /** Hex-encoded max priority fee per gas */
      maxPriorityFeePerGas: string;
      /** Total fee in wei (hex) — gasLimit × maxFeePerGas */
      estimatedFee: string;
      /** Overall risk level from the tx simulator */
      simulationRisk: "safe" | "low" | "medium" | "high" | "critical";
      /** Human-readable warnings from simulation (unlimited approval, etc.) */
      warnings: string[];
      /** Decoded method name if recognizable (e.g. "approve", "transfer") */
      decodedMethod?: string;
      /** Decoded parameters when the selector is known */
      decodedParams?: Record<string, string>;
      /**
       * Immutable spending facts produced by the background's authoritative
       * calldata/token resolver. Approval UIs must fail closed when absent or
       * inconsistent; they must never infer token transfers from summary text
       * or label `tx.value` as the ERC-20 amount.
       */
      reviewedSpending?:
        | {
            kind: "native";
            recipient: string | null;
            /** Exact decimal amount, without locale rounding. */
            amount: string;
            /** Exact unsigned base-unit integer. */
            amountBaseUnits: string;
            /** Verified asset decimals used to derive `amount`. */
            decimals: number;
            symbol: string;
            /** Canonical hex native value reviewed with this transaction. */
            nativeValue: string;
          }
        | {
            kind: "erc20";
            /** Recipient decoded from transfer(address,uint256) calldata. */
            recipient: string;
            /** Exact decimal token amount using verified on-chain decimals. */
            amount: string;
            /** Exact uint256 token amount from calldata. */
            amountBaseUnits: string;
            /** Verified on-chain ERC-20 decimals used to derive `amount`. */
            decimals: number;
            symbol: string;
            /** The calldata target; shown separately from the recipient. */
            tokenContract: string;
            /** ERC-20 transfer native value is independently verified zero. */
            nativeValue: "0x0";
          };
      /** USD value of the transfer, if known */
      amountUsd?: number;
      /** Symbol of the token being transferred, if ERC-20 or native */
      assetSymbol?: string;
    }
  | {
      kind: "personal_sign";
      from: string;
      /** Preview of the decoded message (first ~200 chars of UTF-8) */
      preview: string;
      /** Raw hex in case the user wants to inspect it */
      rawHex: string;
      /** True if the heuristic analyzer flagged this as a permit */
      isPermit: boolean;
      risk: "safe" | "low" | "medium" | "high" | "critical";
    }
  | {
      kind: "eth_signTypedData_v4";
      from: string;
      primaryType: string;
      domain: {
        name?: string;
        version?: string;
        chainId?: string | number;
        verifyingContract?: string;
      };
      /** The raw message struct for inspection */
      message: Record<string, unknown>;
      /** True if the heuristic analyzer flagged this as a permit */
      isPermit: boolean;
      risk: "safe" | "low" | "medium" | "high" | "critical";
    }
  | {
      kind: "wallet_addEthereumChain";
      chainId: string;
      chainName: string;
      rpcUrls: string[];
      nativeCurrency: { name: string; symbol: string; decimals: number };
      blockExplorerUrls?: string[];
    }
  | {
      kind: "wallet_watchAsset";
      tokenAddress: string;
      symbol: string;
      decimals: number;
      chainId: string;
    }
  | {
      kind: "connect";
      /** Permissions the dApp is requesting */
      permissions: string[];
      accountAddresses: string[];
    };

/**
 * ApprovalSummary is the serializable shape of a pending approval that
 * crosses the background → popup bridge. The optional `detail` field
 * carries the full kind-specific payload so the approval UI can render
 * an informed confirmation screen; legacy callers that only populated
 * {title, summary, appName, requiredAction, status} continue to work
 * (with degraded UI).
 */
export interface ApprovalSummary {
  id: string;
  title: string;
  summary: string;
  appName: string;
  /** The domain/origin that initiated the request. Defaults to `appName`. */
  origin?: string;
  /**
   * Trust classification derived by the wallet from the authenticated origin.
   * Callers must never infer this from the mutable, dApp-supplied `appName`.
   */
  trustLevel?: TrustLevel;
  requiredAction: string;
  status: "pending" | "approved" | "rejected";
  /** Unix ms when the approval was created. */
  createdAt?: number;
  /** Unix ms when the approval will auto-reject. */
  expiresAt?: number;
  /** Structured, kind-specific detail for rich rendering in the UI. */
  detail?: ApprovalDetail;
}

export interface AethelredWalletState {
  mode: AethelredMode;
  locked: boolean;
  subject: SubjectSummary;
  activeWorkspace: WorkspaceSummary;
  accounts: WalletAccount[];
  /**
   * The id of the currently-selected account. Defaults to the first
   * account in `accounts` when unset. `send.tsx`, `swap.tsx`, and every
   * RPC handler that needs to resolve "from" now reads this instead of
   * hardcoding `accounts[0]`, fixing the multi-account regression where
   * the wallet always signed from the first account regardless of the
   * UI selection.
   */
  activeAccountId?: string;
  policy: PolicySummary;
  sessions: SessionSummary[];
  pendingApprovals: ApprovalSummary[];
  catalog: AppCatalogEntry[];
  /**
   * The chain history for the current chain. Populated by background.ts
   * from `txManager.getAll()` after restoring state on chain switch so
   * the UI's activity tab can render accurate history when the user
   * switches back and forth between chains (fixes GAP I).
   */
  txHistory?: WalletTransactionRecord[];
}

/** Exact authoritative transaction fields retained by the wallet. */
export interface WalletTransactionRecord {
  hash: string;
  from: string;
  to: string;
  value: string;
  nonce: number;
  gasLimit: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
  data: string;
  chainId: string;
  status: "pending" | "confirmed" | "failed" | "dropped";
  submittedAt: number;
  confirmedAt?: number;
  blockNumber?: number;
  blockHash?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
  error?: string;
}

export interface IntentRequest {
  id?: string;
  kind: IntentKind;
  method: string;
  app: AppIdentity;
  chainId?: string;
  payload?: Record<string, unknown>;
}

export interface IntentResponse {
  intentId: string;
  outcome: DecisionOutcome;
  summary: string;
  warnings: string[];
  result?: unknown;
  approvalId?: string;
}

export interface ProviderRpcErrorShape extends Error {
  code: number;
  data?: unknown;
}

export type ProviderEventName =
  | "accountsChanged"
  | "chainChanged"
  | "connect"
  | "disconnect"
  | "message"
  | "aethelred:stateChanged";

export interface AethelredConnectKernel {
  getState(): AethelredWalletState;
  request(args: EIP1193RequestArguments): Promise<unknown>;
  subscribe(listener: (state: AethelredWalletState) => void): () => void;
}

export interface DiscoveryInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}
