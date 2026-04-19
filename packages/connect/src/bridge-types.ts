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
  // Passkey / WebAuthn 2FA
  | "passkey-enroll"
  | "passkey-verify"
  | "passkey-remove"
  | "passkey-list";

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

/** Identifier for postMessage channel between inpage and content script */
export const AETHELRED_CHANNEL = "aethelred-wallet-bridge";

export interface ChannelMessage {
  channel: typeof AETHELRED_CHANNEL;
  message: BridgeMessage;
}
