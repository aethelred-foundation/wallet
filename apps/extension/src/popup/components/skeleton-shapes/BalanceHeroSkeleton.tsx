import { memo } from "react";
import { Skeleton } from "../skeleton";

/**
 * BalanceHeroSkeleton — loading placeholder shaped like
 * `.v2-balance-card` so the hero doesn't shift when data arrives.
 *
 * Reserves space for:
 *   - eyebrow (status dot + "Total Balance")
 *   - hero number (60px tall rectangle)
 *   - sparkline (44px tall)
 *   - change pill + action buttons
 */
function BalanceHeroSkeletonImpl({ className }: { className?: string }) {
  return (
    <section
      className={`ui-skeleton-balance v2-balance-card ${className ?? ""}`.trim()}
      aria-hidden="true"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 20,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Skeleton variant="line" width={100} height={10} />
        <Skeleton variant="line" width={30} height={10} />
      </div>
      <Skeleton width="70%" height={56} radius={12} />
      <Skeleton width="100%" height={44} radius={8} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Skeleton variant="line" width={90} height={16} />
        <Skeleton variant="line" width={60} height={10} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <Skeleton variant="circle" size={36} />
            <Skeleton variant="line" width={40} height={8} />
          </div>
        ))}
      </div>
    </section>
  );
}

export const BalanceHeroSkeleton = memo(BalanceHeroSkeletonImpl);
