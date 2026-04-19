import { useMemo } from "react";
import {
  Trophy, Coins, Star, Users,
  TrendingUp, Award, Sparkles, ArrowUpRight, Check,
} from "lucide-react";
import { DappLogo } from "../components/dapp-logo";

/* ─── Data ─────────────────────────────────────────────────────────── *
 * Fixture data for rewards. `numericUsd` is added where the string
 * value maps to a USD amount — used to compute hero totals. */

interface StakingYield {
  earned: string;
  asset: string;
  usdValue: string;
  numericUsd: number;
  apy: string;
  source: string;
}

interface ComplianceRewards {
  discount: string;
  saved: string;
  numericUsd: number;
  streak: string;
  streakMonths: number;
  status: "Bronze" | "Silver" | "Gold" | "Platinum";
}

interface EcosystemIncentive {
  dapp: "Cruzible" | "ZeroID" | "NoblePay" | "Shiora" | "TerraQura";
  earned: string;
  numericAethel: number;
  activity: string;
}

interface ReferralCredits {
  totalReferred: number;
  totalEarned: string;
  numericEarned: number;
  pendingPayout: string;
  numericPending: number;
  targetReferrals: number;
}

const STAKING: StakingYield = {
  earned: "24,800", asset: "AETHEL", usdValue: "$61,256",
  numericUsd: 61256, apy: "8.4%", source: "Cruzible Vault",
};

const COMPLIANCE: ComplianceRewards = {
  discount: "15%", saved: "$4,200", numericUsd: 4200,
  streak: "12 months", streakMonths: 12, status: "Gold",
};

const ECOSYSTEM: EcosystemIncentive[] = [
  { dapp: "Cruzible", earned: "1,240 AETHEL", numericAethel: 1240, activity: "Staking rewards" },
  { dapp: "ZeroID",   earned: "500 AETHEL",   numericAethel: 500,  activity: "Identity registration" },
  { dapp: "NoblePay", earned: "200 AETHEL",   numericAethel: 200,  activity: "Settlement volume bonus" },
];

const REFERRALS: ReferralCredits = {
  totalReferred: 3, totalEarned: "$15,000", numericEarned: 15_000,
  pendingPayout: "$5,000", numericPending: 5_000, targetReferrals: 5,
};

/* Tier progression ladder. Each tier has a threshold in months and a
   gradient used for the medallion. The user reaches the next tier when
   their streak crosses the threshold. */
const TIER_LADDER = [
  { name: "Bronze",   threshold: 3,  from: "#b08968", to: "#cd7f32" },
  { name: "Silver",   threshold: 6,  from: "#9ca3af", to: "#d1d5db" },
  { name: "Gold",     threshold: 12, from: "#f59e0b", to: "#fbbf24" },
  { name: "Platinum", threshold: 18, from: "#6366f1", to: "#a5b4fc" },
] as const;

export function RewardsView() {
  /* Compute the aggregate hero metrics and tier progression once per
     render of the fixture data. Each memo receives no deps because
     nothing upstream changes — React treats them as effectively cached. */
  const totals = useMemo(() => {
    const totalUsd =
      STAKING.numericUsd +
      COMPLIANCE.numericUsd +
      REFERRALS.numericEarned +
      REFERRALS.numericPending;
    const totalAethel =
      Number(STAKING.earned.replace(/,/g, "")) +
      ECOSYSTEM.reduce((s, e) => s + e.numericAethel, 0);
    return {
      totalUsd: "$" + totalUsd.toLocaleString(),
      totalAethel: totalAethel.toLocaleString() + " AETHEL",
    };
  }, []);

  /* Figure out the user's current tier + the NEXT tier for progression. */
  const tierInfo = useMemo(() => {
    const months = COMPLIANCE.streakMonths;
    const current = [...TIER_LADDER].reverse().find(t => months >= t.threshold) ?? TIER_LADDER[0];
    const nextIndex = TIER_LADDER.findIndex(t => t.name === current.name) + 1;
    const next = TIER_LADDER[nextIndex] ?? null;
    const pctToNext = next
      ? Math.round(((months - current.threshold) / (next.threshold - current.threshold)) * 100)
      : 100;
    return { current, next, pctToNext };
  }, []);

  /* Ecosystem percent contribution — for relative-bar rendering. */
  const ecoMax = Math.max(...ECOSYSTEM.map(e => e.numericAethel));

  return (
    <div className="view-padded">
      {/* ═════ Hero — total rewards earned ═════ */}
      <div className="rw-hero">
        <div className="rw-hero-top">
          <div className="rw-hero-icon">
            <Trophy size={20} strokeWidth={2.3} />
          </div>
          <div className="rw-hero-title-block">
            <span className="rw-hero-label">TOTAL REWARDS</span>
            <strong className="rw-hero-value">{totals.totalUsd}</strong>
            <span className="rw-hero-sub">{totals.totalAethel} earned</span>
          </div>
          <div
            className="rw-tier-medal"
            style={{ background: `linear-gradient(135deg, ${tierInfo.current.from} 0%, ${tierInfo.current.to} 100%)` }}
            title={`${tierInfo.current.name} tier`}
          >
            <Sparkles size={13} strokeWidth={2.6} />
            <span>{tierInfo.current.name}</span>
          </div>
        </div>
        {tierInfo.next && (
          <div className="rw-hero-progression">
            <div className="rw-hero-progression-header">
              <span>Progress to {tierInfo.next.name}</span>
              <span className="rw-hero-progression-value">
                {COMPLIANCE.streakMonths} / {tierInfo.next.threshold} months
              </span>
            </div>
            <div className="rw-hero-progression-track">
              <div
                className="rw-hero-progression-fill"
                style={{
                  width: `${tierInfo.pctToNext}%`,
                  background: `linear-gradient(90deg, ${tierInfo.current.from} 0%, ${tierInfo.next.from} 100%)`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ═════ Staking Yields — feature card ═════ */}
      <div className="rw-section-label">Featured</div>
      <div className="rw-staking-card">
        <div className="rw-staking-top">
          <div className="rw-staking-icon">
            <Coins size={16} strokeWidth={2.3} />
          </div>
          <div className="rw-staking-header">
            <span className="rw-staking-label">STAKING YIELDS</span>
            <strong>{STAKING.source}</strong>
          </div>
          <div className="rw-apy-pill">
            <TrendingUp size={10} strokeWidth={2.6} />
            {STAKING.apy} APY
          </div>
        </div>
        <div className="rw-staking-body">
          <div className="rw-staking-value">
            {STAKING.earned}
            <span className="rw-staking-asset">{STAKING.asset}</span>
          </div>
          <span className="rw-staking-usd">≈ {STAKING.usdValue}</span>
        </div>
      </div>

      {/* ═════ Compliance tier benefits ═════ */}
      <div className="rw-section-label">Tier Benefits</div>
      <div className="rw-tier-card">
        <div className="rw-tier-left">
          <div
            className="rw-tier-badge"
            style={{ background: `linear-gradient(135deg, ${tierInfo.current.from} 0%, ${tierInfo.current.to} 100%)` }}
          >
            <Award size={20} strokeWidth={2.3} />
          </div>
          <div className="rw-tier-info">
            <strong className="rw-tier-name">{tierInfo.current.name} Tier</strong>
            <span className="rw-tier-sub">Clean AML record · {COMPLIANCE.streak}</span>
          </div>
        </div>
        <div className="rw-tier-benefits">
          <div className="rw-tier-benefit">
            <span className="rw-tier-benefit-label">Fee discount</span>
            <strong className="rw-tier-benefit-value positive">{COMPLIANCE.discount}</strong>
          </div>
          <div className="rw-tier-benefit-divider" />
          <div className="rw-tier-benefit">
            <span className="rw-tier-benefit-label">Total saved</span>
            <strong className="rw-tier-benefit-value">{COMPLIANCE.saved}</strong>
          </div>
        </div>
      </div>

      {/* ═════ Ecosystem incentives ═════ */}
      <div className="rw-section-label">Ecosystem Earnings</div>
      <div className="rw-eco-card">
        <div className="rw-eco-header">
          <div className="rw-eco-icon">
            <Star size={15} strokeWidth={2.3} />
          </div>
          <div className="rw-eco-header-info">
            <strong>dApp Incentives</strong>
            <span>AETHEL rewards across the ecosystem</span>
          </div>
        </div>
        <div className="rw-eco-list">
          {ECOSYSTEM.map(inc => {
            const pct = Math.round((inc.numericAethel / ecoMax) * 100);
            return (
              <div className="rw-eco-row" key={inc.dapp}>
                <div className="rw-eco-logo">
                  <DappLogo name={inc.dapp} size={22} />
                </div>
                <div className="rw-eco-body">
                  <div className="rw-eco-body-top">
                    <strong>{inc.dapp}</strong>
                    <strong className="rw-eco-amount">{inc.earned}</strong>
                  </div>
                  <div className="rw-eco-body-bottom">
                    <span className="rw-eco-activity">{inc.activity}</span>
                  </div>
                  <div className="rw-eco-bar-track">
                    <div className="rw-eco-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═════ Referrals ═════ */}
      <div className="rw-section-label">Referral Program</div>
      <div className="rw-referral-card">
        <div className="rw-referral-top">
          <div className="rw-referral-icon">
            <Users size={15} strokeWidth={2.3} />
          </div>
          <div className="rw-referral-header">
            <strong>Institutional Referrals</strong>
            <span>{REFERRALS.totalReferred} of {REFERRALS.targetReferrals} orgs referred</span>
          </div>
        </div>

        {/* Referral slot visualization — filled circles for referred,
            hollow for remaining target. Reads instantly as progress
            toward a next-tier incentive milestone. */}
        <div className="rw-referral-slots">
          {Array.from({ length: REFERRALS.targetReferrals }).map((_, i) => {
            const filled = i < REFERRALS.totalReferred;
            return (
              <div key={i} className={`rw-referral-slot ${filled ? "filled" : ""}`}>
                {filled ? <Check size={11} strokeWidth={3.2} /> : <span>{i + 1}</span>}
              </div>
            );
          })}
        </div>

        <div className="rw-referral-stats">
          <div className="rw-referral-stat">
            <span>Earned</span>
            <strong>{REFERRALS.totalEarned}</strong>
          </div>
          <div className="rw-referral-divider" />
          <div className="rw-referral-stat">
            <span>Pending payout</span>
            <strong className="positive">
              {REFERRALS.pendingPayout}
              <ArrowUpRight size={12} strokeWidth={2.6} />
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}
