/**
 * Inline SVG sparkline chart for 7-day price trends.
 * Deterministic from symbol — same symbol always renders same chart.
 */

interface SparklineProps {
  symbol: string;
  width?: number;
  height?: number;
  positive?: boolean;
}

function generatePoints(symbol: string, count: number): number[] {
  let hash = 5381;
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) + hash + symbol.charCodeAt(i)) >>> 0;
  }

  const points: number[] = [];
  let value = 50 + (hash % 30);
  for (let i = 0; i < count; i++) {
    const delta = ((hash * (i + 1) * 7) >>> 0) % 20 - 10;
    value = Math.max(10, Math.min(90, value + delta));
    points.push(value);
    hash = ((hash << 3) + hash + i * 13) >>> 0;
  }
  return points;
}

export function Sparkline({ symbol, width = 80, height = 28, positive = true }: SparklineProps) {
  const points = generatePoints(symbol, 24);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((p - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });

  const color = positive ? "var(--success)" : "var(--danger)";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
