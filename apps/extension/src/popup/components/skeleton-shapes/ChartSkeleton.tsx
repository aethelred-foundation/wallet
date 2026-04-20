import { memo, useMemo } from "react";
import { Skeleton } from "../skeleton";

/**
 * ChartSkeleton — loading placeholder for a line chart. Renders a
 * faint polyline with a shimmer overlay so the user gets a sense of
 * shape while the real chart resolves.
 */
function ChartSkeletonImpl({
  className,
  width = 320,
  height = 120,
}: {
  className?: string;
  width?: number;
  height?: number;
}) {
  // Deterministic "trend-ish" polyline so every instance looks the same.
  const pathD = useMemo(() => {
    const pts = 14;
    const vals = Array.from({ length: pts }, (_, i) => {
      const phase = (i / pts) * Math.PI * 2;
      return 0.5 + Math.sin(phase + 0.6) * 0.25 + (i / pts) * 0.15;
    });
    return vals
      .map((v, i) => {
        const x = (i / (pts - 1)) * width;
        const y = height - v * height * 0.7 - height * 0.1;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }, [width, height]);

  return (
    <div
      className={`ui-skeleton-chart ${className ?? ""}`.trim()}
      aria-hidden="true"
      style={{
        position: "relative",
        width,
        height,
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid var(--line, rgba(255,255,255,0.06))",
        background: "var(--surface, rgba(255,255,255,0.02))",
      }}
    >
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <path
          d={pathD}
          fill="none"
          stroke="var(--text-3, rgba(255,255,255,0.12))"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <Skeleton
        width="100%"
        height="100%"
        radius={0}
        style={{ position: "absolute", inset: 0, opacity: 0.6 }}
      />
    </div>
  );
}

export const ChartSkeleton = memo(ChartSkeletonImpl);
