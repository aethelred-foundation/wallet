/**
 * Component Gallery stories.
 * ──────────────────────────
 * A single file that hosts stories for every presentational primitive
 * in the popup. Grouped by title so Storybook's sidebar reads like a
 * design system reference.
 *
 * Every exported story runs in both themes via the global theme
 * toolbar; visual regression captures both variants and diffs them
 * against the per-component `__image_snapshots__/` set.
 *
 * Why a single gallery file: a gallery keeps the component-count
 * invariant visible at a glance (we need >= 15 stories, per the
 * testing-infra spec) and avoids the ceremony of 25 tiny sibling
 * `.stories.tsx` files for components that are mostly one-prop knobs.
 */

import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { CurrencyText } from "../currency-text";
import { Skeleton, SkeletonText, SkeletonTokenRow, SkeletonCard } from "../skeleton";
import { EmptyState } from "../empty-state";
import { AnimatedNumber } from "../animated-number";
import { Card } from "../card";

/* ───────────────────── CurrencyText ───────────────────── */

const CurrencyMeta: Meta<typeof CurrencyText> = {
  title: "Components/CurrencyText",
  component: CurrencyText,
};
export default CurrencyMeta;

type CurrencyStory = StoryObj<typeof CurrencyText>;

export const Currency_Default: CurrencyStory = { args: { value: 1_234.56 } };
export const Currency_Compact: CurrencyStory = { args: { value: 1_234_000, compact: true } };
export const Currency_Huge: CurrencyStory = {
  args: { value: 42_987_654.32 },
  name: "Huge value (alignment check)",
};
export const Currency_Negative: CurrencyStory = { args: { value: -250.75 } };
export const Currency_Zero: CurrencyStory = { args: { value: 0 } };

/* ───────────────────── Skeleton variants ───────────────────── */

export const Skeleton_Rect: StoryObj = {
  render: () => <Skeleton width={240} height={16} />,
  name: "Skeleton / rectangle",
};
export const Skeleton_Circle: StoryObj = {
  render: () => <Skeleton variant="circle" size={40} />,
  name: "Skeleton / circle",
};
export const Skeleton_Text: StoryObj = {
  render: () => <SkeletonText lines={4} />,
  name: "Skeleton / paragraph",
};
export const Skeleton_TokenRow: StoryObj = {
  render: () => <SkeletonTokenRow />,
  name: "Skeleton / token row",
};
export const Skeleton_Card: StoryObj = {
  render: () => <SkeletonCard />,
  name: "Skeleton / card",
};

/* ───────────────────── TokenRow ───────────────────── */

function TokenRow({ symbol, price, change }: { symbol: string; price: number; change: number }) {
  const tone = change > 0 ? "#34d399" : change < 0 ? "#f87171" : "#9ca3af";
  return (
    <div
      className="token-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div style={{ width: 36, height: 36, borderRadius: "50%", background: tone, opacity: 0.85 }} />
      <div style={{ flex: 1 }}>
        <strong>{symbol}</strong>
      </div>
      <CurrencyText value={price} />
      <span style={{ color: tone, fontVariantNumeric: "tabular-nums" }}>
        {change > 0 ? "+" : ""}
        {change.toFixed(2)}%
      </span>
    </div>
  );
}

export const TokenRow_Up: StoryObj = { render: () => <TokenRow symbol="ETH" price={2450.1} change={3.42} /> };
export const TokenRow_Down: StoryObj = { render: () => <TokenRow symbol="BTC" price={58900} change={-1.8} /> };
export const TokenRow_Flat: StoryObj = { render: () => <TokenRow symbol="USDC" price={1.0} change={0} /> };

/* ───────────────────── StatusBadge ───────────────────── */

type BadgeTone = "verified" | "pending" | "expired" | "revoked" | "danger";
function StatusBadge({ tone, label }: { tone: BadgeTone; label: string }) {
  const palette: Record<BadgeTone, string> = {
    verified: "#10b981",
    pending: "#f59e0b",
    expired: "#6b7280",
    revoked: "#f87171",
    danger: "#dc2626",
  };
  return (
    <span
      className="status-badge"
      style={{
        display: "inline-flex",
        gap: 6,
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: 999,
        border: `1px solid ${palette[tone]}`,
        color: palette[tone],
        fontSize: 12,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: palette[tone] }} />
      {label}
    </span>
  );
}

export const Badge_Verified: StoryObj = { render: () => <StatusBadge tone="verified" label="Verified" /> };
export const Badge_Pending: StoryObj = { render: () => <StatusBadge tone="pending" label="Pending" /> };
export const Badge_Expired: StoryObj = { render: () => <StatusBadge tone="expired" label="Expired" /> };
export const Badge_Revoked: StoryObj = { render: () => <StatusBadge tone="revoked" label="Revoked" /> };
export const Badge_Danger: StoryObj = { render: () => <StatusBadge tone="danger" label="Critical" /> };

/* ───────────────────── RiskIndicator ───────────────────── */

function RiskIndicator({ level }: { level: "low" | "medium" | "high" }) {
  const colors = { low: "#10b981", medium: "#f59e0b", high: "#dc2626" };
  return (
    <div style={{ display: "inline-flex", gap: 2 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 12 + i * 4,
            background: i <= ["low", "medium", "high"].indexOf(level) ? colors[level] : "#2a2a30",
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  );
}

export const Risk_Low: StoryObj = { render: () => <RiskIndicator level="low" /> };
export const Risk_Medium: StoryObj = { render: () => <RiskIndicator level="medium" /> };
export const Risk_High: StoryObj = { render: () => <RiskIndicator level="high" /> };

/* ───────────────────── PressableButton ───────────────────── */

function PressableButton({
  size = "md",
  destructive,
  disabled,
  children,
}: {
  size?: "sm" | "md" | "lg";
  destructive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const scale = { sm: 12, md: 14, lg: 16 }[size];
  const pad = { sm: "6px 10px", md: "10px 14px", lg: "14px 20px" }[size];
  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        padding: pad,
        fontSize: scale,
        borderRadius: 12,
        border: "1px solid transparent",
        background: destructive ? "#dc2626" : "#5b8cfe",
        color: "white",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

export const Button_Small: StoryObj = { render: () => <PressableButton size="sm">Confirm</PressableButton> };
export const Button_Medium: StoryObj = { render: () => <PressableButton size="md">Confirm</PressableButton> };
export const Button_Large: StoryObj = { render: () => <PressableButton size="lg">Confirm</PressableButton> };
export const Button_Destructive: StoryObj = {
  render: () => <PressableButton destructive>Revoke all</PressableButton>,
};
export const Button_Disabled: StoryObj = {
  render: () => <PressableButton disabled>Waiting…</PressableButton>,
};

/* ───────────────────── ActionTile ───────────────────── */

function ActionTile({ kind, label }: { kind: "send" | "batch" | "settle"; label: string }) {
  const colors = { send: "#5b8cfe", batch: "#a78bfa", settle: "#10b981" };
  return (
    <button
      type="button"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        padding: 16,
        width: 96,
        borderRadius: 16,
        background: `${colors[kind]}22`,
        border: `1px solid ${colors[kind]}44`,
        color: "inherit",
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: colors[kind],
        }}
      />
      <span style={{ fontSize: 13 }}>{label}</span>
    </button>
  );
}

export const Tile_Send: StoryObj = { render: () => <ActionTile kind="send" label="Send" /> };
export const Tile_Batch: StoryObj = { render: () => <ActionTile kind="batch" label="Batch" /> };
export const Tile_Settle: StoryObj = { render: () => <ActionTile kind="settle" label="Settle" /> };

/* ───────────────────── BalanceHero ───────────────────── */

function BalanceHero({ state }: { state: "loading" | "zero" | "populated" | "hidden" }) {
  return (
    <Card variant="glass" padding="lg" elevation={3}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>Total balance</div>
      {state === "loading" && <Skeleton width={220} height={40} />}
      {state === "zero" && (
        <div style={{ fontSize: 40, fontWeight: 700 }}>
          <CurrencyText value={0} />
        </div>
      )}
      {state === "populated" && (
        <div style={{ fontSize: 40, fontWeight: 700 }}>
          <CurrencyText value={12345.67} />
        </div>
      )}
      {state === "hidden" && (
        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: 4 }}>••••••</div>
      )}
    </Card>
  );
}

export const Hero_Loading: StoryObj = { render: () => <BalanceHero state="loading" /> };
export const Hero_Zero: StoryObj = { render: () => <BalanceHero state="zero" /> };
export const Hero_Populated: StoryObj = { render: () => <BalanceHero state="populated" /> };
export const Hero_Hidden: StoryObj = { render: () => <BalanceHero state="hidden" /> };

/* ───────────────────── ApprovalCard ───────────────────── */

function ApprovalCard({ state }: { state: "pending" | "approved" | "rejected" | "escalated" }) {
  const color = { pending: "#f59e0b", approved: "#10b981", rejected: "#f87171", escalated: "#a78bfa" }[state];
  return (
    <Card variant="solid" padding="lg" elevation={1}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
        <strong>Transfer to 0xCAFE…BABE</strong>
      </div>
      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
        State: <span style={{ color }}>{state}</span>
      </div>
    </Card>
  );
}

export const Approval_Pending: StoryObj = { render: () => <ApprovalCard state="pending" /> };
export const Approval_Approved: StoryObj = { render: () => <ApprovalCard state="approved" /> };
export const Approval_Rejected: StoryObj = { render: () => <ApprovalCard state="rejected" /> };
export const Approval_Escalated: StoryObj = { render: () => <ApprovalCard state="escalated" /> };

/* ───────────────────── EmptyState variants ───────────────────── */

export const Empty_Info: StoryObj = {
  render: () => (
    <EmptyState icon="ℹ" title="Nothing here yet" description="Approvals will appear here." tone="info" />
  ),
};
export const Empty_Warning: StoryObj = {
  render: () => (
    <EmptyState icon="⚠" title="Heads up" description="Session expiring soon." tone="warning" />
  ),
};
export const Empty_Success: StoryObj = {
  render: () => <EmptyState icon="✓" title="All caught up" description="No pending items." tone="success" />,
};

/* ───────────────────── InlineAlert ───────────────────── */

function InlineAlert({ tone, children }: { tone: "info" | "warning" | "danger"; children: React.ReactNode }) {
  const palette = { info: "#5b8cfe", warning: "#f59e0b", danger: "#dc2626" };
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: 12,
        border: `1px solid ${palette[tone]}66`,
        background: `${palette[tone]}22`,
        borderRadius: 12,
        fontSize: 13,
      }}
    >
      <span>{children}</span>
    </div>
  );
}

export const Alert_Info: StoryObj = { render: () => <InlineAlert tone="info">New version available.</InlineAlert> };
export const Alert_Warning: StoryObj = {
  render: () => <InlineAlert tone="warning">Low-confidence simulation.</InlineAlert>,
};
export const Alert_Danger: StoryObj = {
  render: () => <InlineAlert tone="danger">This address is sanctioned.</InlineAlert>,
};

/* ───────────────────── SegmentedPillBar ───────────────────── */

function SegmentedPillBar({ active = "home" }: { active?: string }) {
  const opts = ["Home", "Portfolio", "Markets", "Hub"];
  return (
    <div
      style={{
        display: "inline-flex",
        padding: 4,
        borderRadius: 999,
        background: "rgba(255,255,255,0.06)",
      }}
    >
      {opts.map((o) => (
        <button
          key={o}
          type="button"
          style={{
            padding: "6px 14px",
            border: "none",
            background: active.toLowerCase() === o.toLowerCase() ? "rgba(255,255,255,0.12)" : "transparent",
            borderRadius: 999,
            color: "inherit",
            fontSize: 13,
          }}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export const SegmentedBar_Default: StoryObj = { render: () => <SegmentedPillBar active="home" /> };
export const SegmentedBar_Markets: StoryObj = { render: () => <SegmentedPillBar active="markets" /> };

/* ───────────────────── AllocationRing ───────────────────── */

function AllocationRing({ segments }: { segments: Array<{ color: string; pct: number }> }) {
  let acc = 0;
  const stops = segments
    .map((s) => {
      const from = acc;
      acc += s.pct;
      return `${s.color} ${from}% ${acc}%`;
    })
    .join(", ");
  return (
    <div
      style={{
        width: 120,
        height: 120,
        borderRadius: "50%",
        background: `conic-gradient(${stops})`,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: "var(--surface, #0a0a0b)",
          display: "grid",
          placeItems: "center",
          fontSize: 12,
        }}
      >
        Total
      </div>
    </div>
  );
}

export const Ring_Balanced: StoryObj = {
  render: () => (
    <AllocationRing
      segments={[
        { color: "#5b8cfe", pct: 40 },
        { color: "#a78bfa", pct: 25 },
        { color: "#10b981", pct: 20 },
        { color: "#f59e0b", pct: 15 },
      ]}
    />
  ),
};
export const Ring_Concentrated: StoryObj = {
  render: () => (
    <AllocationRing
      segments={[
        { color: "#5b8cfe", pct: 85 },
        { color: "#a78bfa", pct: 15 },
      ]}
    />
  ),
};

/* ───────────────────── CurrencyText (split-symbol showcase) ───────────────────── */

export const Currency_Split_Small: StoryObj = {
  render: () => (
    <div style={{ fontSize: 16 }}>
      <CurrencyText value={12345.67} />
    </div>
  ),
};
export const Currency_Split_Hero: StoryObj = {
  render: () => (
    <div style={{ fontSize: 56, fontWeight: 800 }}>
      <CurrencyText value={12345.67} />
    </div>
  ),
};

/* ───────────────────── AnimatedNumber ───────────────────── */

export const Animated_Number: StoryObj = {
  render: () => (
    <div style={{ fontSize: 32 }}>
      <AnimatedNumber value={12345} format={(v) => v.toFixed(0)} duration={1200} />
    </div>
  ),
};
