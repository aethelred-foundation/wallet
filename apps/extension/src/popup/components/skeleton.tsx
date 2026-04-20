import { memo, type CSSProperties } from "react";

/**
 * Skeleton
 * ────────
 * Shimmer-animated placeholder for content that's still loading.
 * Powered by the `.motion-shimmer` utility class in motion.css which
 * uses a linear-gradient background-position animation.
 *
 * Backward-compat: the earlier version of this file had a simpler API
 * `Skeleton({ width, height, radius })`. The new API is a superset —
 * all three props still work, plus `variant`, `size`, and shaped helpers
 * below (SkeletonText, SkeletonTokenRow).
 *
 * Three prefabricated shapes:
 *   - <Skeleton />                       — rectangle (default)
 *   - <Skeleton variant="circle" />      — circle
 *   - <Skeleton variant="line" />        — thin text line
 *
 * For multi-line text, compose <SkeletonText lines={3} /> which stacks
 * three skeleton lines of varying widths for a natural paragraph feel.
 */

export type SkeletonVariant = "rect" | "circle" | "line";

export interface SkeletonProps {
  variant?: SkeletonVariant;
  /** Width in px or CSS length. Default: 100% (for rect) or 100px (for line) */
  width?: number | string;
  /** Height in px or CSS length. Default: 16px (rect/line) or matches size (circle) */
  height?: number | string;
  /** For circles only — sets width=height=size */
  size?: number;
  /** Border radius override. Default: radius-md for rect, pill for line, 50% for circle */
  radius?: number | string;
  /** Additional className */
  className?: string;
  /** Inline style override */
  style?: CSSProperties;
}

function toCss(value: number | string | undefined, fallback: string): string {
  if (value == null) return fallback;
  return typeof value === "number" ? `${value}px` : value;
}

function SkeletonImpl({
  variant = "rect",
  width,
  height,
  size,
  radius,
  className,
  style,
}: SkeletonProps) {
  let finalWidth: string;
  let finalHeight: string;
  let finalRadius: string;

  if (variant === "circle") {
    const s = size ?? 32;
    finalWidth = typeof s === "number" ? `${s}px` : s;
    finalHeight = finalWidth;
    finalRadius = "50%";
  } else if (variant === "line") {
    finalWidth = toCss(width, "100px");
    finalHeight = toCss(height, "12px");
    finalRadius = toCss(radius, "var(--radius-pill)");
  } else {
    finalWidth = toCss(width, "100%");
    finalHeight = toCss(height, "16px");
    finalRadius = toCss(radius, "var(--radius-md)");
  }

  return (
    <div
      className={`ui-skeleton motion-shimmer ${className ?? ""}`.trim()}
      aria-hidden="true"
      style={{
        width: finalWidth,
        height: finalHeight,
        borderRadius: finalRadius,
        ...style,
      }}
    />
  );
}

export const Skeleton = memo(SkeletonImpl);

/**
 * SkeletonText — stacks `n` skeleton lines of varying widths for a
 * natural paragraph-like loading placeholder. Widths follow a descending
 * pattern so the last line looks shorter (mimicking real text flow).
 */
export interface SkeletonTextProps {
  lines?: number;
  /** Gap between lines, as a design-token variable or px */
  gap?: string | number;
  /** Optional className passed to the wrapper */
  className?: string;
}

const LINE_WIDTHS = ["92%", "78%", "88%", "64%", "82%"];

function SkeletonTextImpl({ lines = 2, gap, className }: SkeletonTextProps) {
  const gapValue = gap == null ? "var(--space-1)" : typeof gap === "number" ? `${gap}px` : gap;
  return (
    <div
      className={`ui-skeleton-text ${className ?? ""}`.trim()}
      style={{ display: "flex", flexDirection: "column", gap: gapValue }}
    >
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          variant="line"
          width={LINE_WIDTHS[i % LINE_WIDTHS.length]}
        />
      ))}
    </div>
  );
}

export const SkeletonText = memo(SkeletonTextImpl);

/**
 * SkeletonTokenRow — pre-composed loading state for the standard
 * "logo + name/symbol + price/change" row used in home-v2, portfolio,
 * and markets. Drop it into a list map while real data loads.
 */
function SkeletonTokenRowImpl({ className }: { className?: string }) {
  return (
    <div
      className={`ui-skeleton-row ${className ?? ""}`.trim()}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-3)",
        borderRadius: "var(--radius-xl)",
        border: "1px solid var(--line)",
      }}
    >
      <Skeleton variant="circle" size={36} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <Skeleton variant="line" width={80} height={12} />
        <Skeleton variant="line" width={120} height={10} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--space-1)" }}>
        <Skeleton variant="line" width={60} height={12} />
        <Skeleton variant="line" width={40} height={10} />
      </div>
    </div>
  );
}

export const SkeletonTokenRow = memo(SkeletonTokenRowImpl);

/**
 * SkeletonCard — pre-composed loading state for a card with a title
 * and two lines of body text. Matches the Card primitive's default
 * padding/radius so you can swap skeleton → real content without
 * layout shift.
 */
function SkeletonCardImpl({ className }: { className?: string }) {
  return (
    <div
      className={`ui-skeleton-card ${className ?? ""}`.trim()}
      style={{
        padding: "var(--space-4)",
        borderRadius: "var(--radius-2xl)",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-1)",
      }}
    >
      <Skeleton variant="line" width={120} height={20} />
      <div style={{ height: "var(--space-2)" }} />
      <Skeleton variant="line" width="92%" />
      <div style={{ height: "var(--space-1)" }} />
      <Skeleton variant="line" width="70%" />
    </div>
  );
}

export const SkeletonCard = memo(SkeletonCardImpl);
