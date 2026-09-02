import type {
  SimulationResult,
  BalanceChange,
  ApprovalChange,
  RiskSignal,
  RiskLevel,
  ContractInfo,
  DecodedCall,
} from "./types";
import { decodeCall } from "./abi-decoder";

/**
 * TransactionSimulator analyzes transactions before signing.
 *
 * The simulator is a two-layer system:
 *   1. **ABI decoder layer** (`./abi-decoder.ts`) — recognizes dangerous
 *      selectors (approve, setApprovalForAll, permit, transferFrom, etc.)
 *      and extracts their parameters with type-correct decoding.
 *   2. **Risk classification layer** (this file) — consumes the decoded
 *      call, the contract-info lookup, and the raw tx fields to produce
 *      a structured `SimulationResult` with balance changes, approval
 *      changes, and risk signals.
 *
 * The previous version had a `decodeSelector` that returned only `{ type }`
 * and never populated `decoded.amount`/`decoded.spender` — so the
 * unlimited-approval detection at line 69 was dead code. The new decoder
 * actually decodes the parameters, so the UI can now warn users about
 * unlimited approvals, collection-wide NFT grants, and permit signatures.
 *
 * Future work: full state-override eth_call simulation via Tenderly/Blowfish
 * for real balance-delta prediction. Heuristic analysis is sufficient for
 * the risk signals we care about right now.
 */
export class TransactionSimulator {
  async simulate(tx: {
    to?: string;
    from: string;
    value?: string;
    data?: string;
    chainId?: string;
  }): Promise<SimulationResult> {
    const balanceChanges: BalanceChange[] = [];
    const approvalChanges: ApprovalChange[] = [];
    const riskSignals: RiskSignal[] = [];
    const warnings: string[] = [];

    // ── 1. Native value transfer detection ──────────────────────
    if (tx.value && tx.value !== "0x0" && tx.value !== "0") {
      balanceChanges.push({
        kind: "native-transfer-out",
        asset: "native",
        symbol: "ETH",
        amount: tx.value,
        decimals: 18,
        direction: "out",
      });
    }

    // ── 2. Contract metadata lookup (heuristic) ─────────────────
    const contract = tx.to ? await this.analyzeContract(tx.to, tx.data) : null;

    // ── 3. ABI decode the calldata ──────────────────────────────
    const decodedCall = tx.data && tx.data.length > 2
      ? decodeCall(tx.to, tx.data)
      : null;

    // ── 4. Derive structured balance/approval changes from decoded call ──
    if (decodedCall) {
      this.deriveChangesFromDecodedCall(decodedCall, balanceChanges, approvalChanges);
      // The decoder already classified risk — surface it as a signal.
      if (decodedCall.risk !== "safe" && decodedCall.risk !== "low") {
        riskSignals.push({
          id: `decoded-${decodedCall.method}`,
          level: decodedCall.risk,
          category: decodedCall.method.includes("permit") || decodedCall.method.includes("approve")
            ? "approval-risk"
            : "contract-safety",
          title: this.titleForDecodedCall(decodedCall),
          description: decodedCall.warnings.join(" ") || "Risk detected by decoder.",
        });
      }
      warnings.push(...decodedCall.warnings);
    } else if (tx.data && tx.data.length > 2) {
      // Calldata present but the selector is not recognized. This must never
      // degrade into a quiet blind-sign: raise the risk to medium so the
      // approval severity chip reflects it, and put an explicit warning into
      // the prominent warnings block — the user is told the wallet could NOT
      // decode what they are about to authorize.
      riskSignals.push({
        id: "unknown-selector",
        level: "medium",
        category: "contract-safety",
        title: "Unknown contract method",
        description: `The calldata selector ${tx.data.slice(0, 10)} is not recognized by the wallet's risk decoder. Review the contract before proceeding.`,
      });
      warnings.push(
        `⚠ The wallet could not decode this contract call (selector ${tx.data.slice(0, 10)}). You are authorizing an action the wallet cannot explain — verify it with the dApp before approving.`,
      );
    }

    // ── 5. Contract-level risk signals ──────────────────────────
    if (contract) {
      if (!contract.verified) {
        riskSignals.push({
          id: "unverified-contract",
          level: "medium",
          category: "contract-safety",
          title: "Unverified contract",
          description: "The target contract source code is not verified on a block explorer. Exercise caution.",
        });
      }
      if (contract.isProxy) {
        riskSignals.push({
          id: "proxy-contract",
          level: "low",
          category: "contract-safety",
          title: "Proxy contract",
          description: "This is a proxy contract. The implementation can be upgraded by the proxy admin without warning.",
        });
      }
    }

    // ── 6. Contract deployment (no recipient) ──────────────────
    if (!tx.to) {
      riskSignals.push({
        id: "contract-deployment",
        level: "medium",
        category: "contract-safety",
        title: "Contract deployment",
        description: "This transaction deploys a new contract. Verify the bytecode is what you expect.",
      });
      balanceChanges.push({
        kind: "contract-deployment",
        asset: "native",
        symbol: "ETH",
        amount: tx.value ?? "0",
        decimals: 18,
        direction: "out",
      });
    }

    const overallRisk = this.computeOverallRisk(riskSignals);

    return {
      status: "success",
      balanceChanges,
      approvalChanges,
      contract,
      riskSignals,
      overallRisk,
      decodedCall: decodedCall ?? undefined,
      warnings,
      gasEstimate: {
        gasLimit: "21000",
        gasPrice: "20000000000",
        totalCostWei: "420000000000000",
        totalCostUsd: "$0.84",
      },
      simulatedAt: Date.now(),
    };
  }

  /**
   * Translate a `DecodedCall` into `BalanceChange` and `ApprovalChange`
   * entries. Keeps the simulator's structured output consistent whether
   * the tx was an ERC-20 transfer or an NFT safeTransferFrom.
   */
  private deriveChangesFromDecodedCall(
    decoded: DecodedCall,
    balanceChanges: BalanceChange[],
    approvalChanges: ApprovalChange[],
  ): void {
    const tokenAddress = decoded.to ?? "unknown";

    switch (decoded.method) {
      case "transfer": {
        balanceChanges.push({
          kind: "token-transfer-out",
          asset: tokenAddress,
          symbol: "TOKEN",
          amount: decoded.params.amount ?? "0",
          decimals: 18,
          direction: "out",
        });
        break;
      }
      case "transferFrom":
      case "safeTransferFrom": {
        balanceChanges.push({
          kind: decoded.method === "safeTransferFrom" ? "nft-transfer-out" : "token-transfer-out",
          asset: tokenAddress,
          symbol: decoded.method === "safeTransferFrom" ? "NFT" : "TOKEN",
          amount: decoded.params.amount ?? decoded.params.tokenId ?? "0",
          decimals: decoded.method === "safeTransferFrom" ? 0 : 18,
          direction: "out",
        });
        break;
      }
      case "approve":
      case "permit": {
        const amount = decoded.params.amount ?? decoded.params.value ?? "0";
        const isUnlimited = !!decoded.metadata?.isUnlimitedApproval;
        approvalChanges.push({
          kind: "token-approval",
          asset: tokenAddress,
          symbol: "TOKEN",
          spender: decoded.params.spender ?? "unknown",
          allowance: amount,
          isUnlimited,
        });
        break;
      }
      case "setApprovalForAll": {
        const isGrant = decoded.params.approved === "true";
        approvalChanges.push({
          kind: isGrant ? "token-approval" : "token-approval-revoke",
          asset: tokenAddress,
          symbol: "NFT-COLLECTION",
          spender: decoded.params.operator ?? "unknown",
          allowance: isGrant ? "UNLIMITED" : "0",
          isUnlimited: isGrant,
        });
        break;
      }
      case "increaseAllowance": {
        approvalChanges.push({
          kind: "token-approval",
          asset: tokenAddress,
          symbol: "TOKEN",
          spender: decoded.params.spender ?? "unknown",
          allowance: decoded.params.addedValue ?? "0",
          isUnlimited: !!decoded.metadata?.isUnlimitedApproval,
        });
        break;
      }
      case "decreaseAllowance": {
        approvalChanges.push({
          kind: "token-approval-revoke",
          asset: tokenAddress,
          symbol: "TOKEN",
          spender: decoded.params.spender ?? "unknown",
          allowance: decoded.params.subtractedValue ?? "0",
          isUnlimited: false,
        });
        break;
      }
      case "seaport-fulfill": {
        // Seaport fulfillOrder is structurally dense — we classify as
        // risk but don't pretend to decode the order struct.
        break;
      }
      default:
        break;
    }
  }

  /**
   * Build a human-readable title for a decoded call, used as the
   * `riskSignals[].title` field. The UI shows this prominently.
   */
  private titleForDecodedCall(decoded: DecodedCall): string {
    switch (decoded.method) {
      case "approve":
        return decoded.metadata?.isUnlimitedApproval
          ? "UNLIMITED token approval"
          : "Token approval";
      case "setApprovalForAll":
        return decoded.params.approved === "true"
          ? "⚠ NFT collection approval (unlimited)"
          : "NFT collection revoke";
      case "permit":
        return decoded.metadata?.isUnlimitedApproval
          ? "UNLIMITED token permit"
          : "Token permit signature";
      case "increaseAllowance":
        return decoded.metadata?.isUnlimitedApproval
          ? "UNLIMITED allowance increase"
          : "Allowance increase";
      case "transferFrom":
      case "safeTransferFrom":
        return "Transfer from another account";
      case "seaport-fulfill":
        return "OpenSea order fulfillment";
      case "malformed":
        return "Malformed calldata";
      default:
        return decoded.method;
    }
  }

  private async analyzeContract(address: string, _data?: string): Promise<ContractInfo> {
    // Heuristic analysis — in production, query block explorer APIs.
    const isWellKnown = KNOWN_CONTRACTS.has(address.toLowerCase());
    return {
      address,
      name: isWellKnown ? KNOWN_CONTRACTS.get(address.toLowerCase()) : undefined,
      verified: isWellKnown,
      isProxy: false,
      trustScore: isWellKnown ? "safe" : "medium",
    };
  }

  private computeOverallRisk(signals: RiskSignal[]): RiskLevel {
    if (signals.some((s) => s.level === "critical")) return "critical";
    if (signals.some((s) => s.level === "high")) return "high";
    if (signals.some((s) => s.level === "medium")) return "medium";
    if (signals.some((s) => s.level === "low")) return "low";
    return "safe";
  }
}

const KNOWN_CONTRACTS = new Map<string, string>([
  ["0xdac17f958d2ee523a2206206994597c13d831ec7", "Tether USD (USDT)"],
  ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "USD Coin (USDC)"],
  ["0x6b175474e89094c44da98b954eedeac495271d0f", "Dai Stablecoin (DAI)"],
  ["0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", "Wrapped Ether (WETH)"],
  ["0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", "Uniswap (UNI)"],
]);
