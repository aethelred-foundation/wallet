import { memo } from "react";
import { Skeleton } from "../skeleton";

/**
 * AccountCardSkeleton — loading placeholder for an account card on the
 * Accounts view. Shape: avatar + display name + shortened address +
 * trailing chevron.
 */
function AccountCardSkeletonImpl({ className }: { className?: string }) {
  return (
    <div
      className={`ui-skeleton-account ${className ?? ""}`.trim()}
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        borderRadius: "var(--radius-xl, 14px)",
        border: "1px solid var(--line, rgba(255,255,255,0.08))",
        background: "var(--surface, rgba(255,255,255,0.02))",
      }}
    >
      <Skeleton variant="circle" size={40} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <Skeleton variant="line" width={110} height={14} />
        <Skeleton variant="line" width={160} height={10} />
      </div>
      <Skeleton width={14} height={14} radius={3} />
    </div>
  );
}

export const AccountCardSkeleton = memo(AccountCardSkeletonImpl);
