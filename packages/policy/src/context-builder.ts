import type { IntentRequest, WalletAccount, WorkspaceRole } from "@aethelred/wallet-connect";
import type { Workspace } from "@aethelred/wallet-identity";
import type { PolicyContext } from "./types";

/**
 * Build a PolicyContext from the caller-known values. The EVM RPC
 * path (`eth_sendTransaction`) populates the spending fields directly
 * from the decoded tx + price service — previously they came from
 * `intent.payload.{destination,amount,assetId}` which was NEVER set
 * by the EVM path, making spend-limit and destination rules dead
 * code. Now those fields are first-class parameters so the caller
 * must explicitly provide them.
 */
export function buildPolicyContext(opts: {
  intent: IntentRequest;
  subjectId: string;
  subjectRole: WorkspaceRole;
  workspace: Workspace;
  account: WalletAccount;
  sessionExists: boolean;
  sessionId?: string;
  /* ─── Spending-rule fields (previously dead) ─── */
  destination?: string;
  destinationCategory?: "known-contact" | "known-contract" | "unknown" | "blacklisted";
  amount?: number;
  amountUsd?: number;
  assetId?: string;
  assetSymbol?: string;
  assetCategory?: "native" | "staking" | "stablecoin" | "rwa" | "settlement" | "governance" | "unknown";
  sessionAgeMs?: number;
  /* ─── Velocity-rule fields (from VelocityTracker) ─── */
  requestedOperationCount24h?: number;
  cumulativeValueSpentUsd24h?: number;
}): PolicyContext {
  return {
    subject: {
      id: opts.subjectId,
      role: opts.subjectRole,
    },
    workspace: {
      id: opts.workspace.id,
      kind: opts.workspace.kind,
    },
    app: {
      id: opts.intent.app.id,
      origin: opts.intent.app.origin,
      trustLevel: opts.intent.app.trustLevel,
    },
    intent: {
      kind: opts.intent.kind,
      method: opts.intent.method,
    },
    session: {
      exists: opts.sessionExists,
      id: opts.sessionId,
    },
    account: {
      id: opts.account.id,
      address: opts.account.address,
      namespace: opts.account.namespace,
    },
    chainId: opts.intent.chainId,
    // Caller provides these explicitly — intent.payload is no longer
    // the source of truth because the EVM RPC path never sets it.
    destination: opts.destination,
    destinationCategory: opts.destinationCategory,
    amount: opts.amount,
    amountUsd: opts.amountUsd,
    assetId: opts.assetId,
    assetSymbol: opts.assetSymbol,
    assetCategory: opts.assetCategory,
    sessionAgeMs: opts.sessionAgeMs,
    requestedOperationCount24h: opts.requestedOperationCount24h,
    cumulativeValueSpentUsd24h: opts.cumulativeValueSpentUsd24h,
  };
}
