import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, CheckCircle2, Clock, Globe, FileCheck,
  Sparkles, ArrowUpRight, Scan, AlertTriangle, Send, XCircle,
  KeyRound,
} from "lucide-react";
import {
  SCHEMA_KYC_STATUS,
  SCHEMA_JURISDICTION,
  SCHEMA_ACCREDITED_INVESTOR,
  SCHEMA_VASP_LICENSE,
  SCHEMA_SANCTIONS_CLEAR,
  type SchemaId,
  type VerifiableCredential,
  type PresentationRequest,
} from "@aethelred/wallet-credentials";
import { DappLogo } from "../components/dapp-logo";
import { useBackground } from "../hooks/use-background";

/* ─── Data ─────────────────────────────────────────────────────────── *
 * Regulatory passport fixture. Now includes holder identity and a
 * passport number formatted like a real MRZ (machine-readable zone)
 * code — 6 groups separated by middle-dots to evoke official documents. */

type AppStatus = "active" | "pending";

interface PortableApp {
  name: "Cruzible" | "ZeroID" | "TerraQura" | "Shiora" | "NoblePay";
  status: AppStatus;
  lastVerified: string;
}

const PASSPORT = {
  holder: {
    initial: "A",
    name: "Aethelred Operations",
    role: "Enterprise Treasury Signer",
  },
  passportNumber: "AE·26·ENH·OPS·7E3D·9A4F",
  status: "verified" as const,
  level: "Enhanced",
  jurisdiction: "ADGM, UAE",
  jurisdictionCode: "AE",
  verifiedAt: "Apr 1, 2026",
  expiresAt: "Apr 1, 2027",
  frameworks: ["ADGM-DLT", "FATF", "MiCA"],
  portableApps: [
    { name: "Cruzible",  status: "active",  lastVerified: "Apr 11" },
    { name: "ZeroID",    status: "active",  lastVerified: "Apr 8"  },
    { name: "TerraQura", status: "active",  lastVerified: "Apr 5"  },
    { name: "Shiora",    status: "pending", lastVerified: "—"      },
    { name: "NoblePay",  status: "active",  lastVerified: "Apr 3"  },
  ] as PortableApp[],
  screeningHistory: {
    totalScreenings: 847,
    flagged: 2,
    cleared: 845,
    lastScreened: "2 minutes ago",
  },
};

function parseDate(s: string): Date { return new Date(s); }
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/* ─── Hex helpers ──────────────────────────────────────────────────── *
 * Used by the direct-request (QR/paste) flow to shape nonce/challenge. */

const HEX32 = (seed: string): `0x${string}` =>
  (`0x${seed.padEnd(64, "0")}`.slice(0, 66)) as `0x${string}`;
const HEX16 = (seed: string): `0x${string}` =>
  (`0x${seed.padEnd(32, "0")}`.slice(0, 34)) as `0x${string}`;

/* ─── Schema labelling ─────────────────────────────────────────────── */

const SCHEMA_LABEL: Record<string, string> = {
  [SCHEMA_KYC_STATUS]: "KYC Status",
  [SCHEMA_JURISDICTION]: "Jurisdiction",
  [SCHEMA_ACCREDITED_INVESTOR]: "Accredited Investor",
  [SCHEMA_VASP_LICENSE]: "VASP Licence",
  [SCHEMA_SANCTIONS_CLEAR]: "Sanctions Clear",
};

function schemaLabel(id: SchemaId): string {
  return SCHEMA_LABEL[id as string] ?? String(id);
}

type CredStatus = "verified" | "expired" | "revoked";
function credStatus(c: VerifiableCredential, now: number): CredStatus {
  if (c.attestation.revokedAt !== undefined) return "revoked";
  if (c.attestation.expiresAt !== undefined && c.attestation.expiresAt < now) return "expired";
  return "verified";
}

function formatDate(ms: number | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function shortHex(hex: `0x${string}`, keep = 6): string {
  if (hex.length <= 2 + keep * 2 + 1) return hex;
  return `${hex.slice(0, 2 + keep)}…${hex.slice(-keep)}`;
}

export function RegulatoryPassportView() {
  const validity = useMemo(() => {
    const now = new Date();
    const issued = parseDate(PASSPORT.verifiedAt);
    const expires = parseDate(PASSPORT.expiresAt);
    const total = daysBetween(issued, expires) || 1;
    const elapsed = Math.max(0, daysBetween(issued, now));
    const remaining = Math.max(0, daysBetween(now, expires));
    const percentElapsed = Math.min(100, Math.round((elapsed / total) * 100));
    const months = Math.round(remaining / 30);
    const label = remaining <= 0
      ? "Expired"
      : months >= 12
        ? `${Math.floor(months / 12)}y left`
        : `${months} months left`;
    return { percentElapsed, remaining, label };
  }, []);

  const cleanRate = useMemo(() => {
    const { totalScreenings, cleared } = PASSPORT.screeningHistory;
    if (totalScreenings === 0) return { pct: 100, pctLabel: "100%" };
    const pct = (cleared / totalScreenings) * 100;
    return { pct, pctLabel: pct.toFixed(2) + "%" };
  }, []);

  const activeAppCount = PASSPORT.portableApps.filter(a => a.status === "active").length;

  /* ─── Credentials state (live) ──────────────────────────────── *
   * WALLET-02: the passport shows the holder's REAL seal-anchored
   * credentials from the wallet's credential store (background
   * `credentials-list`), not demo data. On a fresh wallet with no
   * credentials yet, the list is honestly empty. */
  const { send } = useBackground();
  const [credentials, setCredentials] = useState<VerifiableCredential[]>([]);
  const [credentialsLoaded, setCredentialsLoaded] = useState(false);
  const [requests, setRequests] = useState<PresentationRequest[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await send("credentials-list", { includeRevoked: true });
        const list = (result as { result?: VerifiableCredential[] })?.result
          ?? (Array.isArray(result) ? (result as VerifiableCredential[]) : []);
        if (!cancelled) setCredentials(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setCredentials([]);
      } finally {
        if (!cancelled) setCredentialsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [send]);
  const [activeRequest, setActiveRequest] = useState<PresentationRequest | null>(null);
  const [selectedUids, setSelectedUids] = useState<Set<`0x${string}`>>(new Set());
  const [presentedAck, setPresentedAck] = useState<string | null>(null);

  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const credentialsSorted = useMemo(
    () => [...credentials].sort((a, b) => b.attestation.issuedAt - a.attestation.issuedAt),
    [credentials]
  );

  const handleRevoke = (uid: `0x${string}`) => {
    // Optimistic local mark, then persist through the background credential
    // store so the revocation is real (and survives reload), not view-only.
    setCredentials((prev) =>
      prev.map((c) =>
        c.attestation.uid === uid
          ? {
              ...c,
              attestation: {
                ...c.attestation,
                revokedAt: Date.now(),
                revocationReason: "Revoked by holder [actor=popup]",
              },
            }
          : c
      )
    );
    void send("credentials-revoke", { uid, reason: "Revoked by holder" }).catch(() => {
      /* background rejected — the optimistic mark stays; a reload re-syncs */
    });
  };

  const openRequest = (req: PresentationRequest) => {
    // Pre-select credentials whose schema matches.
    const pre = new Set<`0x${string}`>();
    for (const claim of req.requiredClaims) {
      const match = credentials.find(
        (c) =>
          c.attestation.schemaId === claim.schemaId &&
          credStatus(c, nowTick) === "verified"
      );
      if (match) pre.add(match.attestation.uid);
    }
    setSelectedUids(pre);
    setActiveRequest(req);
  };

  const toggleSelected = (uid: `0x${string}`) => {
    setSelectedUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const confirmPresent = () => {
    if (!activeRequest) return;
    setPresentedAck(activeRequest.requesterName);
    setRequests((prev) => prev.filter((r) => r.requesterId !== activeRequest.requesterId));
    setActiveRequest(null);
    setSelectedUids(new Set());
    window.setTimeout(() => setPresentedAck(null), 4000);
  };

  const rejectRequest = (req: PresentationRequest) => {
    setRequests((prev) => prev.filter((r) => r.requesterId !== req.requesterId));
  };

  const eligibleForRequest = (req: PresentationRequest | null): VerifiableCredential[] => {
    if (!req) return [];
    const wanted = new Set(req.requiredClaims.map((r) => r.schemaId));
    return credentials.filter(
      (c) =>
        wanted.has(c.attestation.schemaId) &&
        credStatus(c, nowTick) === "verified"
    );
  };

  return (
    <div className="view-padded">
      {/* ═════ Passport hero ═════ */}
      <div className="pp-passport">
        {/* Background layers (in z-order behind content) */}
        <div className="pp-passport-pattern" aria-hidden="true" />
        <div className="pp-passport-cube" aria-hidden="true">
          <svg viewBox="0 0 120 120" width="200" height="200">
            <defs>
              <linearGradient id="ppCubeG" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.14)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
              </linearGradient>
            </defs>
            <path d="M60 10 L100 32 L100 78 L60 100 L20 78 L20 32 Z"
                  fill="url(#ppCubeG)" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
            <path d="M60 10 L100 32 L60 54 L20 32 Z"
                  fill="rgba(255,255,255,0.08)" />
            <path d="M60 54 L100 32 L100 78 L60 100 Z"
                  fill="rgba(0,0,0,0.12)" />
          </svg>
        </div>
        <div className="pp-passport-shine" aria-hidden="true" />

        {/* Top brand strip */}
        <div className="pp-passport-strip">
          <div className="pp-strip-brand">
            <ShieldCheck size={11} strokeWidth={2.6} />
            <span>AETHELRED · REGULATORY PASSPORT</span>
          </div>
          <div className="pp-strip-code">{PASSPORT.jurisdictionCode}</div>
        </div>

        {/* Identity row: monogram + name + circular seal */}
        <div className="pp-passport-identity">
          <div className="pp-monogram">
            <span>{PASSPORT.holder.initial}</span>
          </div>
          <div className="pp-identity-text">
            <strong className="pp-holder-name">{PASSPORT.holder.name}</strong>
            <span className="pp-holder-role">{PASSPORT.holder.role}</span>
          </div>
          <div className="pp-seal">
            <div className="pp-seal-outer">
              <div className="pp-seal-inner">
                <CheckCircle2 size={18} strokeWidth={2.8} />
              </div>
            </div>
            <span className="pp-seal-label">VERIFIED</span>
          </div>
        </div>

        {/* Tier + jurisdiction compact row */}
        <div className="pp-passport-meta">
          <div className="pp-meta-item">
            <span className="pp-meta-label">TIER</span>
            <strong>{PASSPORT.level} KYC</strong>
          </div>
          <div className="pp-meta-sep" />
          <div className="pp-meta-item">
            <span className="pp-meta-label">JURISDICTION</span>
            <strong className="pp-meta-juris">
              <Globe size={10} strokeWidth={2.6} /> {PASSPORT.jurisdiction}
            </strong>
          </div>
        </div>

        {/* Validity section */}
        <div className="pp-passport-validity">
          <div className="pp-validity-header">
            <div className="pp-validity-dates">
              <div>
                <span className="pp-validity-mini-label">ISSUED</span>
                <strong>{PASSPORT.verifiedAt}</strong>
              </div>
              <div className="pp-validity-arrow">→</div>
              <div>
                <span className="pp-validity-mini-label">EXPIRES</span>
                <strong>{PASSPORT.expiresAt}</strong>
              </div>
            </div>
            <span className={`pp-validity-remaining ${
              validity.remaining < 60 ? "warn" : validity.remaining < 180 ? "soon" : "ok"
            }`}>
              {validity.label}
            </span>
          </div>
          <div className="pp-validity-track">
            <div
              className={`pp-validity-fill ${
                validity.percentElapsed > 85 ? "warn" : validity.percentElapsed > 60 ? "soon" : "ok"
              }`}
              style={{ width: `${validity.percentElapsed}%` }}
            />
          </div>
        </div>

        {/* Framework chips */}
        <div className="pp-frameworks">
          {PASSPORT.frameworks.map(f => (
            <div className="pp-framework" key={f}>
              <FileCheck size={10} strokeWidth={2.6} />
              <span>{f}</span>
            </div>
          ))}
        </div>

        {/* Machine-readable zone — passport number */}
        <div className="pp-mrz">
          <span className="pp-mrz-label">PPN</span>
          <code className="pp-mrz-code">{PASSPORT.passportNumber}</code>
        </div>
      </div>

      {/* ═════ Your credentials section ═════ */}
      <div className="pp-section-label">
        <span>YOUR CREDENTIALS</span>
        <span className="pp-section-hint">
          {credentialsSorted.filter((c) => credStatus(c, nowTick) === "verified").length} verified ·
          {" "}{credentialsSorted.length} total
        </span>
      </div>

      {presentedAck ? (
        <div className="rp-ack" role="status">
          <CheckCircle2 size={13} strokeWidth={2.8} />
          <span>Presented credentials to <strong>{presentedAck}</strong></span>
        </div>
      ) : null}

      <div className="rp-cred-list">
        {credentialsLoaded && credentialsSorted.length === 0 ? (
          <div className="rp-req-empty">
            No credentials yet. Seal-anchored credentials you receive from
            Aethelred dApps will appear here.
          </div>
        ) : null}
        {credentialsSorted.map((c) => {
          const status = credStatus(c, nowTick);
          return (
            <div key={c.attestation.uid} className={`rp-cred ${status}`}>
              <div className="rp-cred-header">
                <div className="rp-cred-schema">
                  <KeyRound size={11} strokeWidth={2.6} />
                  <strong>{schemaLabel(c.attestation.schemaId)}</strong>
                </div>
                <span className={`rp-badge ${status}`}>
                  <span className="rp-badge-dot" />
                  {status === "verified" ? "Verified" : status === "expired" ? "Expired" : "Revoked"}
                </span>
              </div>
              <div className="rp-cred-meta">
                <span className="rp-cred-issuer">
                  {c.attestation.issuer.name}
                </span>
                <span className="rp-cred-sep">·</span>
                <span>{c.attestation.issuer.jurisdiction}</span>
              </div>
              <div className="rp-cred-dates">
                <span>Issued {formatDate(c.attestation.issuedAt)}</span>
                {c.attestation.expiresAt ? (
                  <>
                    <span className="rp-cred-sep">·</span>
                    <span>Expires {formatDate(c.attestation.expiresAt)}</span>
                  </>
                ) : null}
              </div>
              <div className="rp-cred-uid" title={c.attestation.uid}>
                {shortHex(c.attestation.uid)}
              </div>
              {c.attestation.revocationReason ? (
                <div className="rp-cred-revoked-reason">
                  <AlertTriangle size={10} strokeWidth={2.6} />
                  <span>{c.attestation.revocationReason}</span>
                </div>
              ) : null}
              <div className="rp-cred-actions">
                <button
                  type="button"
                  className="rp-btn"
                  disabled={status !== "verified"}
                  onClick={() => {
                    const req: PresentationRequest = {
                      requesterId: "direct-present",
                      requesterName: "Direct share",
                      requiredClaims: [{ schemaId: c.attestation.schemaId }],
                      nonce: HEX16("direct"),
                      challenge: HEX32("direct"),
                      issuedAt: Date.now(),
                      expiresAt: Date.now() + 5 * 60_000,
                    };
                    setSelectedUids(new Set([c.attestation.uid]));
                    setActiveRequest(req);
                  }}
                >
                  <Send size={10} strokeWidth={2.6} />
                  Present
                </button>
                <button
                  type="button"
                  className="rp-btn danger"
                  disabled={status === "revoked"}
                  onClick={() => handleRevoke(c.attestation.uid)}
                >
                  <XCircle size={10} strokeWidth={2.6} />
                  Revoke
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ═════ Credential requests section ═════ */}
      <div className="pp-section-label">
        <span>CREDENTIAL REQUESTS</span>
        <span className="pp-section-hint">
          {requests.length === 0 ? "No pending requests" : `${requests.length} awaiting response`}
        </span>
      </div>

      <div className="rp-req-list">
        {requests.length === 0 ? (
          <div className="rp-req-empty">
            <CheckCircle2 size={14} strokeWidth={2.6} />
            <span>All caught up.</span>
          </div>
        ) : (
          requests.map((r) => (
            <div key={r.requesterId} className="rp-req">
              <div className="rp-req-header">
                <strong>{r.requesterName}</strong>
                <span className="rp-req-expiry">
                  <Clock size={10} strokeWidth={2.6} />
                  Expires {formatDate(r.expiresAt)}
                </span>
              </div>
              <div className="rp-req-claims">
                {r.requiredClaims.map((claim) => (
                  <span key={String(claim.schemaId)} className="rp-req-claim">
                    {schemaLabel(claim.schemaId)}
                    {claim.predicate ? ` · ${claim.predicate.field} ${claim.predicate.op} ${String(claim.predicate.value)}` : ""}
                  </span>
                ))}
              </div>
              <div className="rp-req-actions">
                <button type="button" className="rp-btn primary" onClick={() => openRequest(r)}>
                  <CheckCircle2 size={10} strokeWidth={2.8} />
                  Accept
                </button>
                <button type="button" className="rp-btn danger" onClick={() => rejectRequest(r)}>
                  <XCircle size={10} strokeWidth={2.8} />
                  Decline
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ═════ Presentation confirm ═════ */}
      {activeRequest ? (
        <div className="rp-modal" role="dialog" aria-modal="true">
          <div className="rp-modal-card">
            <div className="rp-modal-header">
              <strong>Present to {activeRequest.requesterName}</strong>
              <button type="button" className="rp-modal-close" onClick={() => setActiveRequest(null)}>
                <XCircle size={14} strokeWidth={2.6} />
              </button>
            </div>
            <p className="rp-modal-sub">
              Choose which credentials to disclose. Nothing is shared until you tap Confirm.
            </p>
            <div className="rp-modal-list">
              {eligibleForRequest(activeRequest).map((c) => {
                const checked = selectedUids.has(c.attestation.uid);
                return (
                  <label key={c.attestation.uid} className={`rp-modal-choice ${checked ? "on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelected(c.attestation.uid)}
                    />
                    <div className="rp-modal-choice-body">
                      <strong>{schemaLabel(c.attestation.schemaId)}</strong>
                      <span>{c.attestation.issuer.name}</span>
                    </div>
                  </label>
                );
              })}
              {eligibleForRequest(activeRequest).length === 0 ? (
                <div className="rp-modal-empty">
                  <AlertTriangle size={12} strokeWidth={2.6} />
                  <span>No matching verified credentials.</span>
                </div>
              ) : null}
            </div>
            <div className="rp-modal-actions">
              <button
                type="button"
                className="rp-btn"
                onClick={() => setActiveRequest(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rp-btn primary"
                disabled={selectedUids.size === 0}
                onClick={confirmPresent}
              >
                <Send size={10} strokeWidth={2.6} />
                Confirm & present
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ═════ Portable Access section ═════ */}
      <div className="pp-section-label">
        <span>PORTABLE ACCESS</span>
        <span className="pp-section-hint">{activeAppCount} active · verify once, use everywhere</span>
      </div>

      <div className="pp-apps-list">
        {PASSPORT.portableApps.map(app => {
          const isActive = app.status === "active";
          return (
            <div className={`pp-app-row ${isActive ? "" : "pending"}`} key={app.name}>
              <div className="pp-app-logo">
                <DappLogo name={app.name} size={28} />
              </div>
              <div className="pp-app-info">
                <strong>{app.name}</strong>
                <span>
                  {isActive ? (
                    <>
                      <CheckCircle2 size={9} strokeWidth={3} />
                      Verified {app.lastVerified}
                    </>
                  ) : (
                    <>
                      <Clock size={9} strokeWidth={2.6} />
                      Verification pending
                    </>
                  )}
                </span>
              </div>
              <div className={`pp-app-badge ${isActive ? "active" : "pending"}`}>
                <span className="pp-app-dot" />
                {isActive ? "Live" : "Pending"}
              </div>
            </div>
          );
        })}
      </div>

      {/* ═════ Compliance Record ═════ */}
      <div className="pp-section-label">
        <span>COMPLIANCE RECORD</span>
      </div>

      <div className="pp-clean-card">
        <div className="pp-clean-top">
          <div className="pp-clean-icon">
            <Sparkles size={16} strokeWidth={2.3} />
          </div>
          <div className="pp-clean-info">
            <span className="pp-clean-label">CLEAN RATE</span>
            <strong className="pp-clean-value">{cleanRate.pctLabel}</strong>
          </div>
          <div className="pp-clean-trend">
            <ArrowUpRight size={13} strokeWidth={2.6} />
          </div>
        </div>

        <div className="pp-clean-track">
          <div className="pp-clean-fill" style={{ width: `${cleanRate.pct}%` }} />
        </div>

        <div className="pp-clean-stats">
          <div className="pp-clean-stat">
            <span>Cleared</span>
            <strong className="positive">{PASSPORT.screeningHistory.cleared.toLocaleString()}</strong>
          </div>
          <div className="pp-clean-divider" />
          <div className="pp-clean-stat">
            <span>Flagged</span>
            <strong className={PASSPORT.screeningHistory.flagged > 0 ? "warn" : ""}>
              {PASSPORT.screeningHistory.flagged}
            </strong>
          </div>
          <div className="pp-clean-divider" />
          <div className="pp-clean-stat">
            <span>Total</span>
            <strong>{PASSPORT.screeningHistory.totalScreenings.toLocaleString()}</strong>
          </div>
        </div>

        <div className="pp-clean-footer">
          <Scan size={11} strokeWidth={2.3} />
          <span>Last screened {PASSPORT.screeningHistory.lastScreened}</span>
        </div>
      </div>
    </div>
  );
}
