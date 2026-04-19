import type { CSSProperties, ReactNode } from "react";

/**
 * GradientMeshBg
 * ──────────────
 * Apple/Stripe-style animated mesh gradient background. Three radial
 * gradient blobs slowly orbit each other to create an ambient color
 * wash that brings the Balance Card hero to life without being
 * distracting.
 *
 * Implementation notes:
 *   - Pure CSS, no JS animation loop — the browser GPU-composites
 *     three transform-translated blurred divs
 *   - The `breathe` and `orbit-slow` keyframes in motion.css do all
 *     the work; this component is just the DOM scaffolding
 *   - `prefers-reduced-motion` is respected globally in motion.css
 *     (all animations snap to duration 0.01ms), so we don't need to
 *     handle it here
 *   - Blobs live INSIDE a positioned wrapper so content can sit on top
 *     at any z-index without leaking the background beyond the parent
 *
 * Usage — wrap the balance card:
 *   <div className="balance-card">
 *     <GradientMeshBg
 *       colors={["#c41e1e", "#8b5cf6", "#0ea5e9"]}
 *       intensity={0.35}
 *     />
 *     <div className="balance-content">...</div>
 *   </div>
 */

export interface GradientMeshBgProps {
  /** Three brand colors for the three orbiting blobs */
  colors?: [string, string, string];
  /** Overall opacity of the mesh, 0–1. Default: 0.4 */
  intensity?: number;
  /** Blur radius in pixels. Larger = softer blend. Default: 80 */
  blur?: number;
  /** Optional className on the wrapper */
  className?: string;
  /** Children rendered on top of the background (usually the card content) */
  children?: ReactNode;
  /** If true, the component only renders the background layer without
   *  a wrapper — use when the parent already has its own wrapper. */
  bareMode?: boolean;
}

const DEFAULT_COLORS: [string, string, string] = ["#c41e1e", "#8b5cf6", "#0ea5e9"];

export function GradientMeshBg({
  colors = DEFAULT_COLORS,
  intensity = 0.4,
  blur = 80,
  className,
  children,
  bareMode = false,
}: GradientMeshBgProps) {
  const blobStyle: CSSProperties = {
    position: "absolute",
    width: "60%",
    aspectRatio: "1 / 1",
    borderRadius: "50%",
    filter: `blur(${blur}px)`,
    opacity: intensity,
    pointerEvents: "none",
    willChange: "transform",
  };

  const background = (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        borderRadius: "inherit",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {/* Blob 1 — top-left, gentle breathe */}
      <div
        style={{
          ...blobStyle,
          top: "-20%",
          left: "-15%",
          background: colors[0],
          animation: "breathe 8s var(--ease-in-out, ease-in-out) infinite",
        }}
      />
      {/* Blob 2 — top-right, orbiting */}
      <div
        style={{
          ...blobStyle,
          top: "-10%",
          right: "-20%",
          background: colors[1],
          animation: "breathe 11s var(--ease-in-out, ease-in-out) infinite reverse",
          animationDelay: "-2s",
        }}
      />
      {/* Blob 3 — bottom-center, offset */}
      <div
        style={{
          ...blobStyle,
          bottom: "-25%",
          left: "20%",
          background: colors[2],
          animation: "breathe 13s var(--ease-in-out, ease-in-out) infinite",
          animationDelay: "-5s",
        }}
      />
    </div>
  );

  if (bareMode) return background;

  return (
    <div
      className={className}
      style={{
        position: "relative",
        isolation: "isolate", // creates a new stacking context so children stay above
      }}
    >
      {background}
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}
