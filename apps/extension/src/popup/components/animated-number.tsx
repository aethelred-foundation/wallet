import { memo, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * AnimatedNumber
 * ──────────────
 * Smoothly interpolates from the previous value to the new value over a
 * configurable duration, using an easing curve that matches the rest of
 * the motion system (spring-physics ease-out).
 *
 * Apple-style count-up animation is one of the fastest ways to make a
 * dashboard feel "alive" — when the user first sees the balance card on
 * Home, the number tickers in from 0 over ~1.2s, which reads as
 * confidence rather than randomness.
 *
 * Why rAF instead of CSS transitions:
 *   CSS `transition` can't animate the TEXT CONTENT of an element, only
 *   its visual properties. We need to animate a string value inside a
 *   <span>, which means we need JS to interpolate and re-render per
 *   frame. requestAnimationFrame gives us 60fps without blocking the
 *   main thread.
 *
 * Reduced-motion support:
 *   Respects `prefers-reduced-motion: reduce` by snapping to the target
 *   value immediately — no animation for users who need it.
 *
 * Usage:
 *   <AnimatedNumber
 *     value={summary.totalValue}
 *     format={(v) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
 *     duration={1200}
 *   />
 */
export interface AnimatedNumberProps {
  /** The target value to animate toward */
  value: number;
  /**
   * How to format each intermediate value for display. May return a
   * plain string OR a ReactNode (e.g. a <CurrencyText /> element that
   * splits the currency symbol into its own span). Default: toFixed(0).
   */
  format?: (value: number) => ReactNode;
  /** Animation duration in milliseconds. Default: 1000 */
  duration?: number;
  /** Starting value — useful for first-load count-up. Default: 0 */
  from?: number;
  /** Additional className for the wrapper span */
  className?: string;
  /** Optional inline style override */
  style?: React.CSSProperties;
}

/** Ease-out cubic — smooth deceleration toward the target */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function AnimatedNumberImpl({
  value,
  format = (v) => v.toFixed(0),
  duration = 1000,
  from,
  className,
  style,
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState<number>(from ?? value);
  const frameRef = useRef<number | null>(null);
  const startValueRef = useRef<number>(from ?? value);
  const targetValueRef = useRef<number>(value);
  const startTimeRef = useRef<number | null>(null);
  const isMountedRef = useRef<boolean>(false);

  useEffect(() => {
    // Reduced motion: jump straight to the target, no animation
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      setDisplayValue(value);
      return;
    }

    // First mount: animate from `from` (or current display) to value
    // Subsequent updates: animate from the CURRENT display value to new value
    // This means rapid updates produce smooth chaining, not jumping
    startValueRef.current = isMountedRef.current ? displayValue : (from ?? value);
    targetValueRef.current = value;
    startTimeRef.current = null;
    isMountedRef.current = true;

    const tick = (now: number) => {
      if (startTimeRef.current == null) startTimeRef.current = now;
      const elapsed = now - startTimeRef.current;
      const progress = Math.min(1, elapsed / duration);
      const eased = easeOutCubic(progress);
      const nextValue =
        startValueRef.current + (targetValueRef.current - startValueRef.current) * eased;

      setDisplayValue(nextValue);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return (
    <span className={className} style={style}>
      {format(displayValue)}
    </span>
  );
}

/* Memoized — although it owns rAF state internally, parents re-render
 * frequently (balance tickers, live feeds) and shallow-prop equality
 * avoids running the effect-teardown loop when nothing has actually
 * changed. `format` callbacks are typically stable function refs from
 * call-sites (defined outside render or via useCallback). */
export const AnimatedNumber = memo(AnimatedNumberImpl);
