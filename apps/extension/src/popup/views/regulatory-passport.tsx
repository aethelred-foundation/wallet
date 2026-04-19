import { useMemo } from "react";
import {
  ShieldCheck, CheckCircle2, Clock, Globe, FileCheck,
  Sparkles, ArrowUpRight, Scan,
} from "lucide-react";
import { DappLogo } from "../components/dapp-logo";

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
