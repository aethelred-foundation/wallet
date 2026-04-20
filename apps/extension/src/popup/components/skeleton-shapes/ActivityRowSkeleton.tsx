import { memo } from "react";
import { Skeleton } from "../skeleton";

/**
 * ActivityRowSkeleton — loading placeholder for an entry on the Activity
 * view. Shape: directional icon + amount + description + time.
 */
function ActivityRowSkeletonImpl({ className }: { className?: string }) {
  return (
    <div
      className={`ui-skeleton-activity ${className ?? ""}`.trim()}
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderBottom: "1px solid var(--line, rgba(255,255,255,0.06))",
      }}
    >
      <Skeleton variant="circle" size={32} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <Skeleton variant="line" width={120} height={12} />
        <Skeleton variant="line" width={90} height={10} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <Skeleton variant="line" width={70} height={12} />
        <Skeleton variant="line" width={40} height={10} />
      </div>
    </div>
  );
}

export const ActivityRowSkeleton = memo(ActivityRowSkeletonImpl);
