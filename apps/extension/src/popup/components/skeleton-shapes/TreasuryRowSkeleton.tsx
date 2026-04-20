import { memo } from "react";
import { Skeleton } from "../skeleton";

/**
 * TreasuryRowSkeleton — loading placeholder for treasury / market rows
 * (large value column, trend sparkline, allocation %).
 */
function TreasuryRowSkeletonImpl({ className }: { className?: string }) {
  return (
    <div
      className={`ui-skeleton-treasury ${className ?? ""}`.trim()}
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 14,
        borderRadius: "var(--radius-xl, 14px)",
        border: "1px solid var(--line, rgba(255,255,255,0.08))",
      }}
    >
      <Skeleton variant="circle" size={34} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <Skeleton variant="line" width={90} height={12} />
        <Skeleton variant="line" width={140} height={10} />
      </div>
      <Skeleton width={54} height={24} radius={4} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <Skeleton variant="line" width={80} height={12} />
        <Skeleton variant="line" width={36} height={10} />
      </div>
    </div>
  );
}

export const TreasuryRowSkeleton = memo(TreasuryRowSkeletonImpl);
