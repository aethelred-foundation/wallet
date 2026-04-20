import { Skeleton } from "../skeleton";

/**
 * ApprovalRowSkeleton — loading placeholder for an approval row on the
 * Approvals view. Shape: dapp logo + title + sub-text + approve/reject
 * button row.
 */
export function ApprovalRowSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`ui-skeleton-approval ${className ?? ""}`.trim()}
      aria-hidden="true"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        borderRadius: "var(--radius-2xl, 20px)",
        border: "1px solid var(--line, rgba(255,255,255,0.08))",
        background: "var(--surface, rgba(255,255,255,0.02))",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Skeleton variant="circle" size={36} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton variant="line" width={140} height={13} />
          <Skeleton variant="line" width={200} height={10} />
        </div>
        <Skeleton width={52} height={20} radius={10} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Skeleton width="50%" height={34} radius={10} />
        <Skeleton width="50%" height={34} radius={10} />
      </div>
    </div>
  );
}
