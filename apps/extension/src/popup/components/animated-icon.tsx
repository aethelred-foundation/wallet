import { useEffect, useRef, useState, type ComponentType } from "react";
import { DURATION, EASE, prefersReducedMotion } from "../design/motion";

/**
 * AnimatedIcon — SF-Symbol-style icon morph between two lucide icons.
 *
 * SwiftUI's SF Symbols have built-in bounce / rotation / replace
 * animations. lucide-react is a static-SVG library, but a cheap cross-
 * fade + scale over 180ms reads as a "morph" for small icons (the
 * viewer's brain fills in the rest). We use:
 *
 *   - Cross-fade (opacity 0 ↔ 1)
 *   - Scale (0.7 → 1 for the incoming icon, 1 → 0.7 for outgoing)
 *   - Slight rotation (-12deg → 0) for the incoming icon
 *
 * Both icons are rendered in the same absolute-positioned box so the
 * parent layout doesn't reflow mid-animation.
 *
 * Reduced-motion users get an instant swap (no animation).
 *
 * @example
 *   <AnimatedIcon from={EyeOff} to={Eye} active={showAmounts} size={16} />
 */

type LucideLike = ComponentType<{
  size?: number;
  strokeWidth?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}>;

export interface AnimatedIconProps {
  /** The icon shown when `active` is false. */
  from: LucideLike;
  /** The icon shown when `active` is true. */
  to: LucideLike;
  /** Toggle. */
  active: boolean;
  /** Pixel size. Default: 16 */
  size?: number;
  /** Stroke width for lucide icons. Default: 2 */
  strokeWidth?: number;
  /** Colour passed to both icons. Default: inherit. */
  color?: string;
  /** Additional className on the wrapper */
  className?: string;
  /** Optional aria-hidden override. Default: true */
  hidden?: boolean;
}

export function AnimatedIcon({
  from: From,
  to: To,
  active,
  size = 16,
  strokeWidth = 2,
  color,
  className,
  hidden = true,
}: AnimatedIconProps) {
  const [hasMounted, setHasMounted] = useState(false);
  const lastActiveRef = useRef(active);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const reduced = prefersReducedMotion();
  const animate = hasMounted && lastActiveRef.current !== active && !reduced;
  lastActiveRef.current = active;

  const transitionTime = reduced ? 0 : DURATION.fast;
  const iconTransition = `opacity ${transitionTime}ms ${EASE.out}, transform ${transitionTime}ms ${EASE.pop}`;

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: animate ? iconTransition : reduced ? "none" : iconTransition,
    transformOrigin: "center",
  };

  return (
    <span
      className={className}
      aria-hidden={hidden}
      style={{
        display: "inline-flex",
        position: "relative",
        width: size,
        height: size,
        verticalAlign: "middle",
      }}
    >
      <span
        style={{
          ...baseStyle,
          opacity: active ? 0 : 1,
          transform: active ? "scale(0.7) rotate(12deg)" : "scale(1) rotate(0deg)",
        }}
      >
        <From size={size} strokeWidth={strokeWidth} color={color} />
      </span>
      <span
        style={{
          ...baseStyle,
          opacity: active ? 1 : 0,
          transform: active ? "scale(1) rotate(0deg)" : "scale(0.7) rotate(-12deg)",
        }}
      >
        <To size={size} strokeWidth={strokeWidth} color={color} />
      </span>
    </span>
  );
}
