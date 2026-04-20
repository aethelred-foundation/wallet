import { memo } from "react";
import { Skeleton } from "../skeleton";

/**
 * TokenRowSkeleton — loading placeholder shaped like `.v2-token-card`
 * so the real token card can swap in without layout shift. Matches:
 *
 *   [logo 36px] [name 80px / sub 120px]    [value 60px / change 40px]
 *
 * The same shape is used on Home V2, Portfolio, and Markets — render
 * ~3 of these while live balances load.
 */
function TokenRowSkeletonImpl({ className }: { className?: string }) {
  return (
    <div
      className={`ui-skeleton-token-row ${className ?? ""}`.trim()}
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3, 12px)",
        padding: "var(--space-3, 12px) var(--space-4, 16px)",
        borderRadius: "var(--radius-xl, 14px)",
        border: "1px solid var(--line, rgba(255,255,255,0.08))",
        background: "var(--surface, rgba(255,255,255,0.02))",
      }}
    >
      <Skeleton variant="circle" size={36} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <Skeleton variant="line" width={80} height={12} />
        <Skeleton variant="line" width={120} height={10} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <Skeleton variant="line" width={60} height={12} />
        <Skeleton variant="line" width={40} height={10} />
      </div>
    </div>
  );
}

export const TokenRowSkeleton = memo(TokenRowSkeletonImpl);
