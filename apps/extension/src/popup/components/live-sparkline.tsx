import { memo, useEffect, useMemo, useRef, useState } from "react";

/**
 * LiveSparkline
 * ─────────────
 * A stroked-path sparkline with a "draw-in" entrance animation and
 * optional live drift — perfect for the balance card hero, where the
 * line should feel like it's breathing instead of sitting static.
 *
 * Difference from the existing `Sparkline` component:
 *   - Supports stroke-dashoffset draw-in animation on mount (the line
 *     traces itself in over ~900ms like an Apple Watch ring)
 *   - Optional ambient drift: micro-variations added to each point
 *     every N seconds so it feels alive even with no real data
 *   - Builds the path from a gradient stroke for extra polish
 *   - Supports a fill area under the line (with fadeout gradient)
 *
 * This is a cosmetic primitive — use it in heroes where motion signals
 * liveness. For small inline charts that just need to be accurate,
 * stick with the cheaper `Sparkline` component.
 */
export interface LiveSparklineProps {
  /** Data points, newest LAST (right edge of the chart) */
  data: number[];
  /** Width in pixels. Default: 200 */
  width?: number;
  /** Height in pixels. Default: 60 */
  height?: number;
  /** Stroke width. Default: 2 */
  strokeWidth?: number;
  /** Gradient stop colors from left → right. Default: accent red spectrum */
  colors?: [string, string];
  /** Whether to draw the filled area under the line. Default: true */
  showFill?: boolean;
  /** Draw-in animation duration on mount (ms). Default: 900 */
  drawDuration?: number;
  /** Ambient drift interval (ms). Set to 0 to disable. Default: 0 */
  driftIntervalMs?: number;
  /** Drift magnitude as a fraction of range. Default: 0.02 (2%) */
  driftMagnitude?: number;
  /** Additional className */
  className?: string;
}

function LiveSparklineImpl({
  data,
  width = 200,
  height = 60,
  strokeWidth = 2,
  colors = ["#c41e1e", "#ff6b6b"],
  showFill = true,
  drawDuration = 900,
  driftIntervalMs = 0,
  driftMagnitude = 0.02,
  className,
}: LiveSparklineProps) {
  const [points, setPoints] = useState<number[]>(data);
  const pathRef = useRef<SVGPathElement | null>(null);
  const gradientIdRef = useRef<string>(`spark-grad-${Math.random().toString(36).slice(2, 9)}`);
  const fillIdRef = useRef<string>(`spark-fill-${Math.random().toString(36).slice(2, 9)}`);

  // Sync incoming data prop changes into internal state so the parent
  // can drive real values while drift adds ambient noise on top.
  useEffect(() => {
    setPoints(data);
  }, [data]);

  // Ambient drift — adds small random deltas to points on an interval
  // to make the line feel "alive". Disabled when driftIntervalMs=0.
  useEffect(() => {
    if (!driftIntervalMs || driftIntervalMs <= 0 || points.length === 0) return;

    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const magnitude = range * driftMagnitude;

    const id = setInterval(() => {
      setPoints((prev) =>
        prev.map((v) => v + (Math.random() - 0.5) * 2 * magnitude),
      );
    }, driftIntervalMs);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driftIntervalMs, driftMagnitude]);

  // Compute the SVG path from points
  const { linePath, areaPath } = useMemo(() => {
    if (points.length < 2) return { linePath: "", areaPath: "" };

    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const pad = strokeWidth; // avoid clipping the stroke at the edges

    const xStep = (width - pad * 2) / (points.length - 1);

    const coords = points.map((v, i) => {
      const x = pad + i * xStep;
      const y = pad + (1 - (v - min) / range) * (height - pad * 2);
      return [x, y] as const;
    });

    const line = coords
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(" ");

    const area = line + ` L${coords[coords.length - 1][0].toFixed(2)},${height} L${coords[0][0].toFixed(2)},${height} Z`;

    return { linePath: line, areaPath: area };
  }, [points, width, height, strokeWidth]);

  // Trigger draw-in animation on mount by setting stroke-dashoffset
  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      path.style.strokeDasharray = "none";
      path.style.strokeDashoffset = "0";
      return;
    }

    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length} ${length}`;
    path.style.strokeDashoffset = `${length}`;
    // Force a browser reflow so the transition starts from the initial state
    // (otherwise React might batch the style write and no animation happens)
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    path.getBoundingClientRect();
    path.style.transition = `stroke-dashoffset ${drawDuration}ms cubic-bezier(0.45, 0, 0.15, 1)`;
    path.style.strokeDashoffset = "0";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only run on mount

  if (points.length < 2) return null;

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        {/* Line stroke gradient */}
        <linearGradient id={gradientIdRef.current} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={colors[0]} />
          <stop offset="100%" stopColor={colors[1]} />
        </linearGradient>
        {/* Fill under the line — fades to transparent at the bottom */}
        <linearGradient id={fillIdRef.current} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={colors[1]} stopOpacity="0.28" />
          <stop offset="100%" stopColor={colors[1]} stopOpacity="0" />
        </linearGradient>
      </defs>
      {showFill && (
        <path d={areaPath} fill={`url(#${fillIdRef.current})`} stroke="none" />
      )}
      <path
        ref={pathRef}
        d={linePath}
        fill="none"
        stroke={`url(#${gradientIdRef.current})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const LiveSparkline = memo(LiveSparklineImpl);
