import { Skeleton } from "../skeleton";

/**
 * SettingsRowSkeleton — loading placeholder for a settings row. Shape:
 * icon tile + title + subtitle + trailing chevron or toggle.
 */
export function SettingsRowSkeleton({
  className,
  trailing = "chevron",
}: {
  className?: string;
  trailing?: "chevron" | "toggle";
}) {
  return (
    <div
      className={`ui-skeleton-settings ${className ?? ""}`.trim()}
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        borderBottom: "1px solid var(--line, rgba(255,255,255,0.06))",
      }}
    >
      <Skeleton width={28} height={28} radius={8} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <Skeleton variant="line" width={100} height={12} />
        <Skeleton variant="line" width={160} height={10} />
      </div>
      {trailing === "chevron"
        ? <Skeleton width={12} height={12} radius={2} />
        : <Skeleton width={36} height={22} radius={11} />}
    </div>
  );
}
