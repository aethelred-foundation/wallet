import { useEffect, useRef, useState } from "react";
import { DURATION, EASE, prefersReducedMotion } from "../../design/motion";

/**
 * SuccessMorph — the classic "drawn checkmark in a circle" success
 * confirmation, used after approvals, transactions, and copy actions.
 *
 * Implementation:
 *
 *   1. SVG path with a known length, revealed via
 *      `stroke-dashoffset` animating from `length` to 0. This is the
 *      canonical way to animate an SVG path drawing itself.
 *   2. Reduced-motion users get the final state instantly (no draw).
 *   3. The circle around it draws first, then the checkmark — 2-step
 *      staggered animation.
 *
 * Sized via the `size` prop (default 40px); all internal coordinates are
 * relative to a 52x52 viewBox so the component scales crisply at any
 * size.
 *
 * @example
 *   {justApproved && <SuccessMorph size={52} />}
 */

export interface SuccessMorphProps {
  /** Pixel size of the rendered square. Default: 40 */
  size?: number;
  /** Stroke colour. Default: the global success green. */
  color?: string;
  /** If true, plays the draw animation when mounted. Default: true */
  animate?: boolean;
  /** Additional className for the wrapper SVG */
  className?: string;
  /** Called when the draw animation completes */
  onComplete?: () => void;
}

const CIRCLE_LEN = 150;  // 2 * PI * 24 ≈ 150.8 — close enough
const CHECK_LEN = 36;

export function SuccessMorph({
  size = 40,
  color = "#34c759",
  animate = true,
  className,
  onComplete,
}: SuccessMorphProps) {
  const [phase, setPhase] = useState<"idle" | "circle" | "check" | "done">(
    animate ? "idle" : "done",
  );
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    if (!animate) {
      setPhase("done");
      return;
    }
    if (prefersReducedMotion()) {
      setPhase("done");
      onComplete?.();
      return;
    }

    // Start circle draw on next frame so the initial stroke-dashoffset
    // paints first.
    const raf = requestAnimationFrame(() => {
      setPhase("circle");
      timersRef.current.push(
        window.setTimeout(() => {
          setPhase("check");
        }, DURATION.normal),
        window.setTimeout(() => {
          setPhase("done");
          onComplete?.();
        }, DURATION.normal + DURATION.fast + 50),
      );
    });

    return () => {
      cancelAnimationFrame(raf);
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
  }, [animate, onComplete]);

  const isDrawingCircle = phase === "idle";
  const isDrawingCheck = phase === "idle" || phase === "circle";

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 52 52"
      fill="none"
      stroke={color}
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle
        cx="26"
        cy="26"
        r="24"
        style={{
          strokeDasharray: CIRCLE_LEN,
          strokeDashoffset: isDrawingCircle ? CIRCLE_LEN : 0,
          transition: prefersReducedMotion()
            ? "none"
            : `stroke-dashoffset ${DURATION.normal}ms ${EASE.spring}`,
        }}
      />
      <path
        d="M 14 26 L 23 34 L 38 19"
        style={{
          strokeDasharray: CHECK_LEN,
          strokeDashoffset: isDrawingCheck ? CHECK_LEN : 0,
          transition: prefersReducedMotion()
            ? "none"
            : `stroke-dashoffset ${DURATION.fast}ms ${EASE.pop}`,
        }}
      />
    </svg>
  );
}
