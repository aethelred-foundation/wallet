/**
 * Message types for communication between extension contexts:
 *   inpage (page world) ↔ content script ↔ background service worker ↔ popup
 *
 * All messages use correlation IDs to link request/response pairs.
 */

export type BridgeMessageKind =
  | "rpc-request"
  | "rpc-response"
  | "state-update"
  | "approval-request"
  | "approval-response"
  | "lock-state"
  | "popup-ready"
  | "content-ready"
  | "get-state"
  | "unlock-request"
  | "lock-request"
  | "init-wallet"
  | "import-wallet"
  | "get-recovery-phrase"
  | "navigate-to-approval"
  // Chain data handlers
  | "get-balances"
  | "get-gas"
  | "derive-account"
  | "set-active-account"
  | "add-token"
  | "remove-token"
  | "get-tokens"
  | "get-networks"
  | "switch-network"
  | "get-tx-history"
  | "rename-account"
  | "get-audit-events"
  // Per-account ERC-20 approvals listing. The popup's Token Approvals
  // view calls this to populate its risk-audit table; the background
  // aggregates from historical `Approval` events and reconciles the
  // current allowance via `allowance(owner, spender)`. Returns a
  // `RawAllowancePayload[]` or `null` when the handler is not wired.
  | "get-token-allowances"
  // Popup-initiated transaction flow (split from rpc-request to avoid
  // the send.tsx deadlock where the view would unmount while awaiting
  // its own approval). Flow: prepare-tx creates a draft + approval,
  // returns ApprovalDetail; user confirms inline; execute-tx signs
  // and broadcasts.
  | "prepare-tx"
  | "execute-tx"
  | "cancel-tx"
  // EIP-1193 provider events forwarded from background → content → inpage
  | "provider-event"
  // Transaction lifecycle events (pending → confirmed/failed) — broadcast
  // from the tx-receipt poller to both the popup and the inpage provider
  // so dApps waiting on `waitForTransaction` actually see state change.
  | "tx-updated"
  // Gas-fee-bump / speed-up / cancel support. popup → background:
  //   tx-pending-list    returns PendingTransaction[] tracked for the
  //                      active account (used by Activity view's
  //                      "Pending" section).
  //   tx-speed-up        bumps fees on an existing pending tx, signed
  //                      and broadcast via the normal prepare-tx flow
  //                      so policy still applies.
  //   tx-cancel          issues a zero-value self-send at the same
  //                      nonce to supersede a stuck pending tx.
  | "tx-pending-list"
  | "tx-speed-up"
  | "tx-cancel"
  // Passkey / WebAuthn 2FA
  | "passkey-enroll"
  | "passkey-verify"
  | "passkey-remove"
  | "passkey-list"
  // Rename an already-enrolled passkey. The popup's security settings
  // panel allows the user to give each authenticator a friendly name
  // ("MacBook Touch ID", "YubiKey 5C", …) — this message rewrites the
  // label field on the stored credential metadata without touching the
  // underlying public key material.
  | "passkey-set-label"
  // WalletConnect v2 — popup ↔ background plumbing. The SDK wiring
  // itself lives in apps/extension/src/services/walletconnect-manager.ts;
  // these message kinds are the contract between the two surfaces.
  | "wc-pair"
  | "wc-sessions"
  | "wc-disconnect"
  | "wc-session-proposal"
  | "wc-approve-proposal"
  | "wc-reject-proposal";

export interface BridgeMessage {
  kind: BridgeMessageKind;
  correlationId: string;
  payload: unknown;
  origin?: string;
  timestamp: number;
}

export interface RpcRequestPayload {
  method: string;
  params?: readonly unknown[] | object;
}

export interface RpcResponsePayload {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface ApprovalRequestPayload {
  approvalId: string;
  title: string;
  summary: string;
  appName: string;
  appOrigin: string;
  intentKind: string;
  requiredAction: string;
}

export interface ApprovalResponsePayload {
  approvalId: string;
  decision: "approved" | "rejected";
  reviewerId: string;
}

export interface LockStatePayload {
  locked: boolean;
  initialized: boolean;
}

export interface InitWalletPayload {
  password: string;
  label?: string;
}

export interface ImportWalletPayload {
  password: string;
  mnemonic: string[];
  label?: string;
}

export interface InitWalletResultPayload {
  mnemonic: string[];
  address: string;
}

export function createCorrelationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createBridgeMessage(
  kind: BridgeMessageKind,
  payload: unknown,
  origin?: string
): BridgeMessage {
  return {
    kind,
    correlationId: createCorrelationId(),
    payload,
    origin,
    timestamp: Date.now(),
  };
}

// ─── WalletConnect v2 bridge payloads ───────────────────────────────
// The popup drives pairing / approval / disconnect; the background
// owns the long-lived Web3Wallet client and forwards proposals + RPC
// back to the popup via `provider-event` (for RPC) and
// `wc-session-proposal` (for proposals that need a user decision).
//
// These payload shapes are kept string-based and JSON-serialisable —
// Chrome `runtime.sendMessage` uses structured clone, but sticking to
// the common-denominator shape keeps the bridge portable across
// postMessage transports (e.g. native messaging, QR-pairing bridge).

/**
 * Payload for `wc-pair` — popup → background.
 *
 * `uri` is the raw string the user pasted or scanned. The background
 * runs it through {@link parseWalletConnectUri} before calling the
 * SDK, so the popup does NOT have to pre-validate.
 */
export interface WcPairPayload {
  uri: string;
}

/**
 * Payload for `wc-sessions` — popup → background.
 *
 * A pull request; empty body. The background replies with a
 * `WalletConnectSession[]` snapshot.
 */
export interface WcSessionsPayload {
  /** Optional hint to refresh the mirror before replying. */
  refresh?: boolean;
}

/**
 * Payload for `wc-disconnect` — popup → background.
 *
 * `topic` is the session topic the user chose to revoke. The
 * background fires `session_delete` on the SDK and emits an
 * `session-revoked` audit event before replying.
 */
export interface WcDisconnectPayload {
  topic: string;
  /** Optional free-form reason — shown in audit log. */
  reason?: string;
}

/**
 * Payload for `wc-session-proposal` — background → popup.
 *
 * The full proposal object the SDK handed us; the popup renders it
 * for approval. The correlationId on the BridgeMessage wrapper is
 * reused as the proposal's key so approve / reject responses line up.
 */
export interface WcSessionProposalPayload {
  proposalId: number;
  pairingTopic: string;
  peer: {
    publicKey: string;
    metadata: {
      name: string;
      description: string;
      url: string;
      icons: string[];
    };
  };
  requiredNamespaces: Record<
    string,
    {
      chains?: string[];
      methods: string[];
      events: string[];
    }
  >;
  optionalNamespaces: Record<
    string,
    {
      chains?: string[];
      methods: string[];
      events: string[];
    }
  >;
  sessionProperties?: Record<string, string>;
  expiry: number;
}

/**
 * Payload for `wc-approve-proposal` — popup → background.
 *
 * `accounts` is the final CAIP-10 set the user chose; `namespaces`
 * is the resolved per-namespace block the wallet will hand back to
 * the dApp.
 */
export interface WcApproveProposalPayload {
  proposalId: number;
  accounts: string[];
  namespaces: Record<
    string,
    {
      accounts: string[];
      methods: string[];
      events: string[];
      chains?: string[];
    }
  >;
}

/**
 * Payload for `wc-reject-proposal` — popup → background.
 */
export interface WcRejectProposalPayload {
  proposalId: number;
  /** Optional reason — defaults to "User rejected." */
  reason?: string;
}

// ─── Gas-fee-bump / speed-up / cancel bridge payloads ──────────────
// Shared between the popup's Activity view and the background handler.
// Keep these JSON-serialisable (no bigints) — the background converts
// bigint gas values to decimal strings before emitting.

/**
 * Payload for `tx-pending-list` — popup → background.
 *
 * `fromAddress` is optional; when omitted the background returns the
 * pending set for the currently active account.
 */
export interface TxPendingListPayload {
  fromAddress?: string;
}

/**
 * Serialized projection of a tracked pending transaction. The
 * background holds `bigint` fields internally but flattens them to
 * decimal strings before crossing the bridge, so the popup can parse
 * them with `BigInt(s)` without needing a custom JSON reviver.
 */
export interface PendingTxSummary {
  txHash: string;
  nonce: number;
  fromAddress: string;
  chainId: number;
  submittedAt: number;
  to: string;
  value: string;
  data: string;
  type: "eip1559" | "legacy";
  /** Decimal-string gas values of the ORIGINAL tx. */
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
  gasLimit: string;
  /** If set, the user already issued a replacement for this tx. */
  replacedBy?: string;
  replacementKind?: "speed-up" | "cancel";
  /** Precomputed bumped-fee suggestions the UI renders as side-by-side previews. */
  suggestion?: {
    minBumpPercent: number;
    speedUp: { maxFeePerGas: string; maxPriorityFeePerGas: string; gasPrice?: string };
    cancel: { maxFeePerGas: string; maxPriorityFeePerGas: string; gasPrice?: string };
  };
}

/**
 * Payload for `tx-speed-up` — popup → background.
 *
 * The background resolves `txHash` → tracked pending tx, calls
 * `computeReplacementGas`, feeds the bumped tx through the same
 * `prepare-tx` machinery that normal sends use (so policy engine
 * still evaluates, and a second-reviewer approval is still enforced
 * when the policy bundle requires it), and returns a draftId.
 */
export interface TxSpeedUpPayload {
  txHash: string;
  /** Optional bump percent override; defaults to 11. */
  bumpPercent?: number;
}

/**
 * Payload for `tx-cancel` — popup → background.
 *
 * Same semantics as `tx-speed-up` but the resulting draft is a
 * zero-value self-send at the same nonce.
 */
export interface TxCancelPayload {
  txHash: string;
  bumpPercent?: number;
}

/**
 * Shared reply shape for tx-speed-up / tx-cancel. The returned
 * `draftId` is compatible with the existing `execute-tx` flow so the
 * popup can drive confirmation UX through the same code path as
 * ordinary sends.
 */
export interface TxReplacementResult {
  draftId: string;
  replacementKind: "speed-up" | "cancel";
  originalTxHash: string;
}

/** Identifier for postMessage channel between inpage and content script */
export const AETHELRED_CHANNEL = "aethelred-wallet-bridge";

export interface ChannelMessage {
  channel: typeof AETHELRED_CHANNEL;
  message: BridgeMessage;
}
