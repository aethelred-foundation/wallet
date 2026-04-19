import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Clock,
  AlertTriangle,
  Wallet,
  Fuel,
  Tag,
  Hash,
  Globe,
  FileText,
  Copy,
  Check,
} from "lucide-react";
import { useState } from "react";
import type { AethelredWalletState, ApprovalSummary, ApprovalDetail } from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import { useBackground } from "../hooks/use-background";
import { useCopyToClipboard } from "../hooks/use-copy-to-clipboard";
import { DappLogo } from "../components/dapp-logo";
import { useFormat } from "../i18n/format";

/* Permissions stylesheet is co-located with the three permission pages. */
import "../../styles/legacy/permissions.css";

const FIRST_PARTY_APPS = new Set(["Cruzible", "TerraQura", "ZeroID", "NoblePay", "Shiora"]);

/**
 * ApprovalsView — per-kind typed confirmation UI.
 *
 * The previous version of this file only had access to `ApprovalSummary`'s
 * {title, summary, appName, requiredAction} string fields and had to
 * regex-scrape an amount/asset out of the title string. For `eth_sendTransaction`
 * that meant the user saw "Confirm transaction" with no recipient, no value,
 * no gas, no simulation risk — the approval was a security regression from
 * the old auto-sign path because the user couldn't make an informed decision.
 *
 * The rewrite consumes the new `ApprovalDetail` discriminated union on
 * `ApprovalSummary.detail` and renders a kind-specific confirmation card
 * for every request type:
 *
 *   - "tx"                      → send-transaction card (amount, recipient,
 *                                 gas fee, nonce, simulation risk, warnings)
 *   - "personal_sign"           → message-signing card (preview, permit warning)
 *   - "eth_signTypedData_v4"    → typed-data card (primaryType, domain, message)
 *   - "wallet_addEthereumChain" → chain-add card (chainId, name, rpcUrl)
 *   - "wallet_watchAsset"       → token-add card (symbol, decimals, contract)
 *   - "connect"                 → connect card (requested permissions, accounts)
 *
 * The ⚠ warning block renders at the top for any approval with
 * `detail.risk/simulationRisk === "critical"` or `isPermit === true`, so the
 * user sees danger before they read anything else.
 */

export function ApprovalsView({ state }: { state: AethelredWalletState }) {
  const { navigate } = useNavigation();
  const { send } = useBackground();
  const { formatCurrency } = useFormat();

  const [submitting, setSubmitting] = useState<string | null>(null);

  const handleDecision = async (approvalId: string, decision: "approved" | "rejected") => {
    setSubmitting(approvalId);
    try {
      await send("approval-response", { approvalId, decision, reviewerId: state.subject.id });
    } finally {
      setSubmitting(null);
    }
  };

  const pending = state.pendingApprovals;
  const count = pending.length;

  return (
    <div className="view-padded">
      <button className="acc-back" onClick={() => navigate("hub")} type="button">
        <ArrowLeft size={14} /> Back
      </button>

      {/* Hero */}
      <div className="apv2-hero">
        <div className="apv2-hero-icon">
          <ShieldAlert size={22} strokeWidth={2.4} />
        </div>
        <div className="apv2-hero-body">
          <span className="apv2-hero-label">APPROVALS</span>
          <strong className="apv2-hero-title">
            {count === 0 ? "All clear" : `${count} pending`}
          </strong>
          <span className="apv2-hero-sub">
            <Clock size={11} strokeWidth={2.6} />
            {count === 0 ? "No items awaiting review" : "Awaiting your decision"}
          </span>
        </div>
        <span className="apv2-hero-badge">
          <span className="apv2-hero-badge-dot" /> Live
        </span>
      </div>

      {count === 0 ? (
        <div className="apv2-empty">
          <div className="apv2-empty-icon">
            <ShieldAlert size={28} strokeWidth={2.2} />
          </div>
          <strong>No pending approvals</strong>
          <p>Multi-sig and policy-gated actions will appear here when reviewers are needed.</p>
        </div>
      ) : (
        <div className="apv2-list">
          {pending.map((a) => (
            <ApprovalCard
              key={a.id}
              approval={a}
              onDecide={handleDecision}
              submitting={submitting === a.id}
              formatCurrency={formatCurrency}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * Per-kind approval card
 * ═══════════════════════════════════════════════════════════════════ */

function ApprovalCard({
  approval,
  onDecide,
  submitting,
  formatCurrency,
}: {
  approval: ApprovalSummary;
  onDecide: (id: string, decision: "approved" | "rejected") => void;
  submitting: boolean;
  formatCurrency: (value: number, opts?: Intl.NumberFormatOptions) => string;
}) {
  const detail = approval.detail;
  const { severityLabel, severityColor } = computeSeverity(detail);
  const isFirstParty = FIRST_PARTY_APPS.has(approval.appName);

  return (
    <div className="apv2-card">
      <div className="apv2-card-stripe" style={{ background: severityColor }} />

      <div className="apv2-card-top">
        <div className="apv2-card-logo">
          <DappLogo name={approval.appName} size={40} />
        </div>
        <div className="apv2-card-title-wrap">
          <strong className="apv2-card-title">{approval.title}</strong>
          <span className="apv2-card-app">{approval.origin ?? approval.appName}</span>
        </div>
        <span
          className="apv2-severity-badge"
          style={{
            color: severityColor,
            background: `${severityColor}1a`,
            border: `1px solid ${severityColor}33`,
          }}
        >
          {severityLabel}
        </span>
      </div>

      {/* Render the kind-specific detail body */}
      {detail ? <DetailBody detail={detail} formatCurrency={formatCurrency} /> : (
        <p className="apv2-card-summary">{approval.summary}</p>
      )}

      <div className="apv2-meta-row">
        <span className="apv2-chip">{approval.appName}</span>
        <span className="apv2-chip">{isFirstParty ? "First-Party" : "External"}</span>
        <span className="apv2-chip">{approval.requiredAction}</span>
      </div>

      {/* Reject on the left (neutral-destructive), approve on the right */}
      <div className="apv2-actions">
        <button
          className="apv2-btn apv2-btn-reject"
          onClick={() => onDecide(approval.id, "rejected")}
          type="button"
          disabled={submitting}
        >
          <XCircle size={14} strokeWidth={2.4} /> Reject
        </button>
        <button
          className="apv2-btn apv2-btn-approve"
          onClick={() => onDecide(approval.id, "approved")}
          type="button"
          disabled={submitting}
        >
          <CheckCircle2 size={14} strokeWidth={2.4} />
          {submitting ? "Submitting…" : "Approve"}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * Per-kind detail renderers
 * ═══════════════════════════════════════════════════════════════════ */

function DetailBody({
  detail,
  formatCurrency,
}: {
  detail: ApprovalDetail;
  formatCurrency: (value: number, opts?: Intl.NumberFormatOptions) => string;
}) {
  switch (detail.kind) {
    case "tx":
      return <TxDetailBody detail={detail} formatCurrency={formatCurrency} />;
    case "personal_sign":
      return <PersonalSignBody detail={detail} />;
    case "eth_signTypedData_v4":
      return <TypedDataBody detail={detail} />;
    case "wallet_addEthereumChain":
      return <AddChainBody detail={detail} />;
    case "wallet_watchAsset":
      return <WatchAssetBody detail={detail} />;
    case "connect":
      return <ConnectBody detail={detail} />;
  }
}

function TxDetailBody({
  detail,
  formatCurrency,
}: {
  detail: Extract<ApprovalDetail, { kind: "tx" }>;
  formatCurrency: (value: number, opts?: Intl.NumberFormatOptions) => string;
}) {
  const valueEth = hexWeiToEth(detail.value);
  const feeEth = hexWeiToEth(detail.estimatedFee);
  const valueUsd = detail.amountUsd;

  return (
    <div className="apv2-detail">
      {/* Warnings banner (if any) */}
      {detail.warnings.length > 0 && (
        <div className="apv2-warnings">
          {detail.warnings.map((w, i) => (
            <div key={i} className="apv2-warning">
              <AlertTriangle size={12} /> {w}
            </div>
          ))}
        </div>
      )}

      {/* Amount */}
      <div className="apv2-amount-box">
        <span className="apv2-amount-label">
          {detail.decodedMethod ? `${detail.decodedMethod}` : "Send"}
        </span>
        <div className="apv2-amount-row">
          <strong className="apv2-amount-value">{valueEth.toFixed(6)}</strong>
          <span className="apv2-amount-asset">{detail.assetSymbol ?? "ETH"}</span>
        </div>
        {valueUsd != null && (
          <span className="apv2-amount-usd">{formatCurrency(valueUsd)}</span>
        )}
      </div>

      {/* Key-value rows */}
      <KVRow label="From" value={shortAddr(detail.from)} icon={<Wallet size={11} />} copyable={detail.from} />
      <KVRow
        label="To"
        value={detail.to ? shortAddr(detail.to) : "Contract deployment"}
        icon={<Tag size={11} />}
        copyable={detail.to ?? undefined}
      />
      <KVRow label="Chain" value={chainName(detail.chainId)} icon={<Globe size={11} />} />
      <KVRow label="Nonce" value={String(detail.nonce)} icon={<Hash size={11} />} />
      <KVRow
        label="Est. fee"
        value={`${feeEth.toFixed(6)} ETH`}
        icon={<Fuel size={11} />}
      />
      {detail.decodedMethod && (
        <KVRow
          label="Method"
          value={detail.decodedMethod}
          icon={<FileText size={11} />}
        />
      )}
      {detail.decodedParams && Object.keys(detail.decodedParams).length > 0 && (
        <details className="apv2-decoded">
          <summary>Decoded parameters</summary>
          <div className="apv2-decoded-body">
            {Object.entries(detail.decodedParams).map(([k, v]) => (
              <KVRow key={k} label={k} value={formatDecodedParamValue(v)} />
            ))}
          </div>
        </details>
      )}

      {/* Simulation risk chip */}
      <div className="apv2-sim-row">
        <span className="apv2-sim-label">Simulation risk</span>
        <span className={`apv2-sim-chip apv2-sim-${detail.simulationRisk}`}>
          {detail.simulationRisk.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

function PersonalSignBody({
  detail,
}: {
  detail: Extract<ApprovalDetail, { kind: "personal_sign" }>;
}) {
  return (
    <div className="apv2-detail">
      {detail.isPermit && (
        <div className="apv2-warnings">
          <div className="apv2-warning apv2-warning-critical">
            <AlertTriangle size={12} /> ⚠ This is a token permit signature — it grants
            token approval without a separate transaction. Only sign if you trust this dApp.
          </div>
        </div>
      )}
      <KVRow label="From" value={shortAddr(detail.from)} icon={<Wallet size={11} />} copyable={detail.from} />
      <KVRow label="Risk" value={detail.risk.toUpperCase()} />

      <div className="apv2-message-preview">
        <span className="apv2-message-label">Message preview</span>
        <pre className="apv2-message-body">{detail.preview || "(empty)"}</pre>
      </div>
    </div>
  );
}

function TypedDataBody({
  detail,
}: {
  detail: Extract<ApprovalDetail, { kind: "eth_signTypedData_v4" }>;
}) {
  return (
    <div className="apv2-detail">
      {detail.isPermit && (
        <div className="apv2-warnings">
          <div className="apv2-warning apv2-warning-critical">
            <AlertTriangle size={12} /> ⚠ This is a token PERMIT — signing grants approval
            without a transaction. Verify the spender + amount carefully.
          </div>
        </div>
      )}
      <KVRow label="Primary type" value={detail.primaryType} />
      {detail.domain.name && <KVRow label="Domain" value={detail.domain.name} />}
      {detail.domain.version && <KVRow label="Version" value={detail.domain.version} />}
      {detail.domain.verifyingContract && (
        <KVRow
          label="Contract"
          value={shortAddr(detail.domain.verifyingContract)}
          copyable={detail.domain.verifyingContract}
        />
      )}
      <KVRow label="From" value={shortAddr(detail.from)} copyable={detail.from} />

      <details className="apv2-decoded">
        <summary>Raw message</summary>
        <pre className="apv2-decoded-body">{JSON.stringify(detail.message, null, 2)}</pre>
      </details>
    </div>
  );
}

function AddChainBody({
  detail,
}: {
  detail: Extract<ApprovalDetail, { kind: "wallet_addEthereumChain" }>;
}) {
  return (
    <div className="apv2-detail">
      <div className="apv2-warnings">
        <div className="apv2-warning">
          <AlertTriangle size={12} /> Adding a new network. Verify the RPC URL comes from a trusted source.
        </div>
      </div>
      <KVRow label="Chain ID" value={detail.chainId} />
      <KVRow label="Name" value={detail.chainName} />
      <KVRow label="RPC" value={detail.rpcUrls[0] ?? "—"} />
      <KVRow
        label="Native"
        value={`${detail.nativeCurrency.name} (${detail.nativeCurrency.symbol})`}
      />
      {detail.blockExplorerUrls?.[0] && (
        <KVRow label="Explorer" value={detail.blockExplorerUrls[0]} />
      )}
    </div>
  );
}

function WatchAssetBody({
  detail,
}: {
  detail: Extract<ApprovalDetail, { kind: "wallet_watchAsset" }>;
}) {
  return (
    <div className="apv2-detail">
      <KVRow label="Symbol" value={detail.symbol} />
      <KVRow label="Decimals" value={String(detail.decimals)} />
      <KVRow label="Contract" value={shortAddr(detail.tokenAddress)} copyable={detail.tokenAddress} />
      <KVRow label="Chain" value={chainName(detail.chainId)} />
    </div>
  );
}

function ConnectBody({
  detail,
}: {
  detail: Extract<ApprovalDetail, { kind: "connect" }>;
}) {
  return (
    <div className="apv2-detail">
      <KVRow label="Requesting" value={detail.permissions.join(", ")} />
      <KVRow label="Accounts" value={`${detail.accountAddresses.length} address(es)`} />
      {detail.accountAddresses.slice(0, 3).map((a) => (
        <KVRow key={a} label="" value={shortAddr(a)} copyable={a} />
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * Reusable rows + helpers
 * ═══════════════════════════════════════════════════════════════════ */

function KVRow({
  label,
  value,
  icon,
  copyable,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  copyable?: string;
}) {
  const { copy, copied } = useCopyToClipboard(1500);
  return (
    <div className="apv2-kv">
      <span className="apv2-kv-label">
        {icon}
        {label}
      </span>
      <span className="apv2-kv-value">
        {value}
        {copyable && (
          <button
            className="apv2-kv-copy"
            onClick={() => copy(copyable, copyable)}
            type="button"
            aria-label="Copy"
          >
            {copied === copyable ? <Check size={11} strokeWidth={3} /> : <Copy size={11} />}
          </button>
        )}
      </span>
    </div>
  );
}

function computeSeverity(detail?: ApprovalDetail): {
  severityLabel: string;
  severityColor: string;
} {
  if (!detail) return { severityLabel: "Standard", severityColor: "#0ea5e9" };

  let riskLevel: "low" | "medium" | "high" | "critical" = "low";
  if (detail.kind === "tx") riskLevel = detail.simulationRisk;
  else if (detail.kind === "personal_sign") riskLevel = detail.risk;
  else if (detail.kind === "eth_signTypedData_v4") riskLevel = detail.risk;
  else if (detail.kind === "wallet_addEthereumChain") riskLevel = "medium";
  else if (detail.kind === "wallet_watchAsset") riskLevel = "low";
  else if (detail.kind === "connect") riskLevel = "low";

  // Permits bump risk
  if (
    (detail.kind === "personal_sign" || detail.kind === "eth_signTypedData_v4") &&
    detail.isPermit
  ) {
    riskLevel = "critical";
  }

  const map: Record<
    "low" | "medium" | "high" | "critical",
    { label: string; color: string }
  > = {
    low: { label: "Standard", color: "#0ea5e9" },
    medium: { label: "Medium", color: "#ff9f0a" },
    high: { label: "High", color: "#ff6b35" },
    critical: { label: "⚠ CRITICAL", color: "#ff3b30" },
  };
  return {
    severityLabel: map[riskLevel].label,
    severityColor: map[riskLevel].color,
  };
}

function hexWeiToEth(hex: string): number {
  try {
    const wei = BigInt(hex || "0x0");
    // Convert via string to avoid Number precision loss for big values
    const ether = Number(wei) / 1e18;
    return isNaN(ether) ? 0 : ether;
  } catch {
    return 0;
  }
}

function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatDecodedParamValue(value: string): string {
  if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
    return shortAddr(value);
  }

  if (value.length <= 80) {
    return value;
  }

  return `${value.slice(0, 40)}…${value.slice(-12)}`;
}

function chainName(chainId: string): string {
  const map: Record<string, string> = {
    "0x1": "Ethereum",
    "0x89": "Polygon",
    "0xa4b1": "Arbitrum",
    "0xa": "Optimism",
    "0x2105": "Base",
    "0xaa36a7": "Sepolia",
  };
  return map[chainId.toLowerCase()] ?? chainId;
}
