import { useEffect, useRef, useState, type ReactNode } from "react";
import { DURATION, EASE, prefersReducedMotion } from "../design/motion";

/**
 * PageTransition
 * ──────────────
 * Fades + slides a new page into view when the React `viewKey` changes.
 * Unlike a naive `key={view}` trick (which kills and remounts the whole
 * subtree on every navigation — losing scroll, timers, and async state),
 * this wrapper keeps the child mounted and only re-applies the entrance
 * animation by toggling a className.
 *
 * v2 enhancements:
 *   - Directional awareness: forward navigation (deeper into hierarchy)
 *     uses `fade-up`; back navigation uses `slide-in-left`. Direction is
 *     inferred from the built-in history stack.
 *   - Reduced-motion support: the new view snaps in with a minimal
 *     120ms fade when the user has set `prefers-reduced-motion: reduce`
 *     or the in-app override.
 *
 * CSS dependencies (defined in motion.css via keyframes):
 *   `fade-up`, `slide-in-right`, `slide-in-left`.
 *
 * Why not framer-motion:
 *   - Zero extra bundle weight (Chrome extensions are size-sensitive)
 *   - Zero provider setup
 *   - The animations we need are trivially expressible in CSS keyframes
 *
 * Usage in App.tsx:
 *   <PageTransition viewKey={view}>
 *     <ViewRouter state={state} />
 *   </PageTransition>
 */

export type TransitionDirection = "forward" | "back" | "auto";

export interface PageTransitionProps {
  /** Value that changes when a new page is being shown */
  viewKey: string;
  /** The page content */
  children: ReactNode;
  /** Additional classNames to apply alongside the transition classes */
  className?: string;
  /**
   * Override the inferred direction. "auto" (default) uses the module's
   * built-in history stack to decide forward vs back.
   */
  direction?: TransitionDirection;
}

/**
 * Simple module-level history stack: remembers the last N viewKeys so
 * PageTransition can tell if we're navigating forward (new key never
 * seen) or back (key matches one seen before).
 */
const historyStack: string[] = [];
const HISTORY_MAX = 32;

function pushHistory(key: string): "forward" | "back" {
  // If the new key matches the previous entry two back, treat as "back".
  const prevPrevIdx = historyStack.length - 2;
  if (prevPrevIdx >= 0 && historyStack[prevPrevIdx] === key) {
    historyStack.pop();
    return "back";
  }
  historyStack.push(key);
  if (historyStack.length > HISTORY_MAX) historyStack.shift();
  return "forward";
}

export function PageTransition({
  viewKey,
  children,
  className,
  direction = "auto",
}: PageTransitionProps) {
  const [animKey, setAnimKey] = useState<number>(0);
  const [currentDirection, setCurrentDirection] = useState<"forward" | "back">("forward");
  const prevViewRef = useRef<string>(viewKey);

  useEffect(() => {
    if (prevViewRef.current !== viewKey) {
      prevViewRef.current = viewKey;
      if (direction === "auto") {
        setCurrentDirection(pushHistory(viewKey));
      } else if (direction === "forward" || direction === "back") {
        setCurrentDirection(direction);
        historyStack.push(viewKey);
        if (historyStack.length > HISTORY_MAX) historyStack.shift();
      }
      // Bump the animKey so the animation class re-applies via React key
      setAnimKey((k) => k + 1);
    }
  }, [viewKey, direction]);

  const reduced = prefersReducedMotion();

  /* Pick the keyframe.
   * - Reduced motion → very short fade so the swap still communicates
   *   change without being motion-heavy.
   * - Forward        → fade-up with spring easing
   * - Back           → slide-in-left
   */
  const animationValue = reduced
    ? `fade-up 120ms ${EASE.out} both`
    : currentDirection === "back"
      ? `slide-in-left ${DURATION.slow}ms ${EASE.spring} both`
      : `fade-up ${DURATION.slow}ms ${EASE.spring} both`;

  return (
    <div
      // Using the bumped animKey as a React key forces React to unmount
      // the OUTER wrapper and remount it, which re-triggers the CSS
      // animation.
      key={animKey}
      data-page-transition={currentDirection}
      className={`pt-enter pt-enter-active ${className ?? ""}`.trim()}
      style={{
        animation: animationValue,
      }}
    >
      {children}
    </div>
  );
}
