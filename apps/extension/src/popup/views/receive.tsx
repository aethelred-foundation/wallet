import { useState } from "react";
import {
  ArrowLeft, Copy, Check, Share2, AlertTriangle, QrCode, Wallet,
} from "lucide-react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import { QRCode } from "../components/qr-code";
import { useNavigation } from "../router";
import "../../styles/legacy/transact.css";

export function ReceiveView({ state }: { state: AethelredWalletState }) {
  const { goBack } = useNavigation();
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const account = state.accounts[selectedIdx];

  if (!account) {
    return (
      <div className="view-padded">
        <button className="acc-back rcv-top-back" onClick={goBack} type="button">
          <ArrowLeft size={14} strokeWidth={2.3} />
          <span>Back</span>
        </button>
        <p>No account available.</p>
      </div>
    );
  }

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(account.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    const payload = {
      title: `${account.label} — Aethelred Wallet`,
      text: `Send to my ${account.namespace} address: ${account.address}`,
    };
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await (navigator as Navigator & { share: (data: ShareData) => Promise<void> }).share(payload);
        return;
      } catch {
        /* user cancelled or share failed — fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(account.address);
      showToast("Address copied to clipboard");
    } catch {
      showToast("Unable to share");
    }
  };

  const networkLabel =
    account.namespace === "eip155" ? "Ethereum · Polygon · Base" :
    account.namespace === "aethelred" ? "Aethelred L1" :
    String(account.namespace);

  return (
    <div className="view-padded">
      <button className="acc-back rcv-top-back" onClick={goBack} type="button">
        <ArrowLeft size={14} strokeWidth={2.3} />
        <span>Back</span>
      </button>

      {/* ─── Hero ─── */}
      <div className="rcv-hero">
        <span className="rcv-hero-kicker">RECEIVE</span>
        <strong className="rcv-hero-title">{account.label}</strong>
        <span className="rcv-hero-sub">{networkLabel}</span>
      </div>

      {/* Account switcher (when user has multiple) */}
      {state.accounts.length > 1 && (
        <div className="rcv-account-switch" role="tablist">
          {state.accounts.map((acc, i) => (
            <button
              key={acc.id}
              className={`rcv-account-chip ${selectedIdx === i ? "active" : ""}`}
              onClick={() => setSelectedIdx(i)}
              type="button"
              role="tab"
              aria-selected={selectedIdx === i}
            >
              <Wallet size={11} strokeWidth={2.4} />
              {acc.label}
            </button>
          ))}
        </div>
      )}

      {/* ─── Large QR code ─── */}
      <div className="rcv-qr-wrap">
        <div className="rcv-qr-card">
          <QRCode data={account.address} size={196} />
        </div>
      </div>

      {/* ─── Full address block ─── */}
      <div className="rcv-address-block">
        <code className="rcv-address-code">{account.address}</code>
        <button
          className={`rcv-copy-btn ${copied ? "ok" : ""}`}
          onClick={copyAddress}
          type="button"
          aria-label="Copy address"
        >
          {copied ? <Check size={11} strokeWidth={3} /> : <Copy size={11} strokeWidth={2.4} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* ─── Actions: Share + QR-code generator (copy as fallback) ─── */}
      <div className="rcv-actions">
        <button
          className="rcv-action-btn"
          onClick={copyAddress}
          type="button"
        >
          <QrCode size={14} strokeWidth={2.4} />
          Copy address
        </button>
        <button
          className="rcv-action-btn primary"
          onClick={handleShare}
          type="button"
        >
          <Share2 size={14} strokeWidth={2.4} />
          Share
        </button>
      </div>

      {/* ─── Warning banner ─── */}
      <div className="rcv-warning">
        <span className="rcv-warning-icon">
          <AlertTriangle size={14} strokeWidth={2.4} />
        </span>
        <div className="rcv-warning-text">
          <strong>Ethereum-compatible only</strong>
          <span>
            Only send Ethereum-compatible tokens to this address. Sending other
            tokens may result in loss.
          </span>
        </div>
      </div>

      {toast && (
        <div className="rcv-toast" role="status" aria-live="polite">
          <Check size={12} strokeWidth={3} />
          {toast}
        </div>
      )}
    </div>
  );
}
