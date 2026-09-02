import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft, AlertTriangle, CheckCircle2, Clock, Copy, Check, ExternalLink,
  Fuel, Hash, Loader2, Share2, Zap,
} from "lucide-react";
import { useBackground } from "../hooks/use-background";
import { useNavigation } from "../router";
import { useComingSoon } from "../hooks/use-coming-soon";
import { useCopyToClipboard } from "../hooks/use-copy-to-clipboard";
import { TokenLogo } from "../components/token-logo";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";
import "../../styles/legacy/tx-detail.css";

type TxStatus = "pending" | "confirmed" | "failed" | "dropped";

interface TxRecord {
  hash: string; type?: string; status: TxStatus;
  from: string; to: string; asset?: string; amount?: string;
  value: string; fee?: string; submittedAt: number;
  chainId: string; blockNumber?: number; confirmations?: number; nonce?: number;
}

const STATUS_META: Record<TxStatus, {
  label: string; kicker: string; icon: typeof CheckCircle2;
  color: string; soft: string; spin?: boolean;
}> = {
  pending:   { label: "Transaction pending",   kicker: "SUBMITTING",  icon: Loader2,       color: "#ff9f0a", soft: "rgba(255,159,10,0.14)", spin: true },
  confirmed: { label: "Confirmed",              kicker: "CONFIRMED",   icon: CheckCircle2,  color: "#34c759", soft: "rgba(52,199,89,0.14)" },
  failed:    { label: "Transaction failed",     kicker: "FAILED",      icon: AlertTriangle, color: "#ff3b30", soft: "rgba(255,59,48,0.14)" },
  dropped:   { label: "Transaction dropped",    kicker: "DROPPED",     icon: AlertTriangle, color: "#ff3b30", soft: "rgba(255,59,48,0.14)" },
};

const EXPLORERS: Record<string, string> = {
  "0x1":      "https://etherscan.io/tx/",
  "0x89":     "https://polygonscan.com/tx/",
  "0xa4b1":   "https://arbiscan.io/tx/",
  "0x2105":   "https://basescan.org/tx/",
  "0xa":      "https://optimistic.etherscan.io/tx/",
  "0xaa36a7": "https://sepolia.etherscan.io/tx/",
};

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
const shortHash = (h: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "—");

const KvRow = ({ label, value }: { label: ReactNode; value: ReactNode }) => (
  <div className="txd-kv-row"><span>{label}</span><strong>{value}</strong></div>
);
const AddrRow = ({ label, value, onCopy, done }: { label: string; value: string; onCopy: () => void; done: boolean }) => (
  <div className="txd-kv-row"><span>{label}</span>
    <div><code>{shortHash(value)}</code>
      <button type="button" onClick={onCopy} aria-label={`Copy ${label}`}>
        {done ? <Check size={10} /> : <Copy size={10} />}
      </button></div>
  </div>
);

export function TxDetailView() {
  const { send } = useBackground();
  const { navigate, params } = useNavigation();
  const comingSoon = useComingSoon();
  const txHash = params?.txHash ?? "";

  const [tx, setTx] = useState<TxRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const { copy: copyToClipboard, copied, error: copyError } = useCopyToClipboard(1800);

  useEffect(() => {
    send("get-tx", { hash: txHash })
      .then((r) => {
        const record = r as TxRecord | null | undefined;
        if (record?.hash) setTx(record);
      })
      .catch(() => { /* show not-found */ })
      .finally(() => setLoading(false));
  }, [txHash, send]);

  const meta = useMemo(() => tx ? STATUS_META[tx.status] : STATUS_META.pending, [tx]);
  const StatusIcon = meta.icon;

  const copy = (text: string, label: string) => {
    void copyToClipboard(text, label);
  };

  if (!loading && !tx) {
    return (
      <div className="view-padded">
        <button className="acc-back" onClick={() => navigate("activity")} type="button">
          <ArrowLeft size={14} strokeWidth={2.3} /><span>Activity</span>
        </button>
        <div className="acc-empty">
          <AlertTriangle size={20} />
          <strong>Transaction not found</strong>
          <span>Hash {shortHash(txHash)} could not be located.</span>
        </div>
      </div>
    );
  }

  // Loading fallback — transient; keeps rail stable.
  const t: TxRecord = tx ?? { hash: txHash, status: "pending", from: "", to: "", value: "0x0", submittedAt: Date.now(), chainId: "0x1" };
  const explorerUrl = (EXPLORERS[t.chainId] ?? EXPLORERS["0x1"]) + t.hash;
  const share = () => copy(explorerUrl, "share");
  const speedUpUnavailable = IS_PRODUCTION_BUILD && t.status === "pending";

  return (
    <div className="view-padded">
      <button className="acc-back" onClick={() => navigate("activity")} type="button">
        <ArrowLeft size={14} strokeWidth={2.3} /><span>Activity</span>
      </button>

      {/* Status hero — adapts gradient + icon to tx state */}
      <div className="txd-hero" style={{
        background: `linear-gradient(135deg, ${meta.soft} 0%, rgba(255,255,255,0.02) 100%)`,
        borderColor: `${meta.color}50`,
      }}>
        <div className="txd-hero-badge" style={{
          background: `linear-gradient(135deg, ${meta.color} 0%, ${meta.color}c0 100%)`,
          boxShadow: `0 8px 26px ${meta.color}55`,
        }}>
          <StatusIcon size={22} strokeWidth={2.4} className={meta.spin ? "txd-spin" : ""} />
        </div>
        <span className="txd-hero-kicker" style={{ color: meta.color }}>{meta.kicker}</span>
        <strong className="txd-hero-title">{meta.label}</strong>
        <span className="txd-hero-sub">{formatRelative(t.submittedAt)}</span>

        <div className="txd-hash-chip">
          <Hash size={11} strokeWidth={2.6} />
          <code>{shortHash(t.hash)}</code>
          <button type="button" onClick={() => copy(t.hash, "hash")} aria-label="Copy hash">
            {copied === "hash" ? <Check size={11} strokeWidth={3} /> : <Copy size={11} strokeWidth={2.4} />}
          </button>
        </div>
      </div>

      {/* Amount card */}
      {t.amount && (
        <div className="txd-amount-card">
          <TokenLogo symbol={t.asset ?? "AETHEL"} size={40} />
          <div className="txd-amount-body">
            <strong className="txd-amount-main">{t.amount} <span>{t.asset}</span></strong>
          </div>
        </div>
      )}

      {/* Details KV */}
      <div className="txd-section-label">DETAILS</div>
      <div className="txd-kv">
        <AddrRow label="From" value={t.from} onCopy={() => copy(t.from, "from")} done={copied === "from"} />
        <AddrRow label="To"   value={t.to}   onCopy={() => copy(t.to,   "to")}   done={copied === "to"} />
        <KvRow label="Network" value={t.chainId} />
        {t.fee && <KvRow label={<><Fuel size={11} /> Gas fee</>} value={t.fee} />}
        {t.blockNumber != null && <KvRow label="Block" value={`#${t.blockNumber.toLocaleString()}`} />}
        {t.confirmations != null && <KvRow label="Confirmations" value={String(t.confirmations)} />}
        {t.nonce != null && <KvRow label="Nonce" value={String(t.nonce)} />}
      </div>

      {/* Actions row */}
      <div className="txd-actions">
        <button className="txd-action" type="button" onClick={() => window.open(explorerUrl, "_blank")}>
          <ExternalLink size={14} strokeWidth={2.4} /><span>Explorer</span>
        </button>
        {t.status === "pending" && !speedUpUnavailable && (
          <button
            className="txd-action is-coming-soon"
            type="button"
            onClick={() => comingSoon("Speed up transaction", "gas bumping ships in v1.0")}
          >
            <Zap size={14} strokeWidth={2.4} /><span>Speed up</span>
          </button>
        )}
        <button className="txd-action" type="button" onClick={share}>
          {copied === "share" ? <Check size={14} strokeWidth={3} /> : <Share2 size={14} strokeWidth={2.4} />}
          <span>{copied === "share" ? "Copied" : "Share"}</span>
        </button>
      </div>

      {loading && (
        <div className="txd-loading"><Clock size={12} /> Loading transaction…</div>
      )}
      {copyError ? (
        <div className="form-error" role="alert">Unable to copy transaction details.</div>
      ) : null}
    </div>
  );
}
