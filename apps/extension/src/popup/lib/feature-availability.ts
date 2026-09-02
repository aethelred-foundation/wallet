import type { ViewName } from "../router";
import { IS_PRODUCTION_BUILD } from "./release-mode";

export interface UnreleasedFeature {
  name: string;
  reason: string;
}

const PRODUCTION_UNRELEASED_VIEWS: Partial<Record<ViewName, UnreleasedFeature>> = {
  markets: {
    name: "Markets",
    reason: "Authoritative market data, news, and research sources are not connected in this release.",
  },
  "app-catalog": {
    name: "App Catalog",
    reason: "No verified deployment registry currently supplies dApp catalog metadata.",
  },
  swap: {
    name: "Swap",
    reason: "Live quote, allowance, slippage, and router-calldata verification are not yet connected.",
  },
  "wallet-connect": {
    name: "WalletConnect",
    reason: "The audited WalletConnect v2 SDK transport is not packaged in this release.",
  },
  "regulatory-passport": {
    name: "Regulatory Passport",
    reason: "No verified credential issuer is connected to this wallet release.",
  },
  "id-verification": {
    name: "ID Verification",
    reason: "No live ZeroID verification record is available through the wallet bridge yet.",
  },
  "digital-assets": {
    name: "Digital Assets",
    reason: "Certificates and tokenized documents need an authoritative on-chain index before release.",
  },
  rewards: {
    name: "Rewards",
    reason: "A live rewards ledger and claim transaction flow are not connected.",
  },
  "machine-delegation": {
    name: "Machine Delegation",
    reason: "Agent grants and revocations need durable policy-backed storage before release.",
  },
  "developer-tools": {
    name: "Developer Tools",
    reason: "Development-only diagnostics are excluded from production wallets.",
  },
  "token-approvals": {
    name: "Token Approvals",
    reason: "A complete on-chain allowance index is not connected, so the wallet cannot safely claim that an account has no approvals.",
  },
  "tx-detail": {
    name: "Transaction Details",
    reason: "Chain-aware transaction lookup and explorer routing are not connected in this release.",
  },
};

export function getUnreleasedFeature(view: ViewName): UnreleasedFeature | null {
  if (!IS_PRODUCTION_BUILD) return null;
  return PRODUCTION_UNRELEASED_VIEWS[view] ?? null;
}

export function isViewReleased(view: ViewName): boolean {
  return getUnreleasedFeature(view) === null;
}
