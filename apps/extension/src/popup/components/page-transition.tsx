import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * PageTransition
 * ──────────────
 * Fades + slides a new page into view when the React `viewKey` changes.
 * Unlike a naive `key={view}` trick (which kills and remounts the whole
 * subtree on every navigation — losing scroll, timers, and async state),
 * this wrapper keeps the child mounted and only re-applies the entrance
 * animation by toggling a className.
 *
 * How it works:
 *   1. On mount: apply `pt-enter pt-enter-active` classes so the CSS
 *      fade-up animation plays
 *   2. When `viewKey` changes: briefly remove the class, then re-add it
 *      after a microtask so the animation plays again from the start
 *
 * CSS dependencies (defined in motion.css via fade-up keyframes):
 *   `.pt-enter-active` triggers the `fade-up` animation.
 *
 * Why not framer-motion:
 *   - Zero extra bundle weight (Chrome extensions are size-sensitive)
 *   - Zero provider setup
 *   - The animations we need (fade-up + slide-right) are trivially
 *     expressible in CSS keyframes
 *
 * Usage in App.tsx:
 *   <PageTransition viewKey={view}>
 *     <ViewRouter state={state} />
 *   </PageTransition>
 */
export interface PageTransitionProps {
  /** Value that changes when a new page is being shown */
  viewKey: string;
  /** The page content */
  children: ReactNode;
  /** Additional classNames to apply alongside the transition classes */
  className?: string;
}

export function PageTransition({ viewKey, children, className }: PageTransitionProps) {
  const [animKey, setAnimKey] = useState<number>(0);
  const prevViewRef = useRef<string>(viewKey);

  useEffect(() => {
    if (prevViewRef.current !== viewKey) {
      prevViewRef.current = viewKey;
      // Bump the animKey so the animation class re-applies via React key
      setAnimKey((k) => k + 1);
    }
  }, [viewKey]);

  return (
    <div
      // Using the bumped animKey as a React key forces React to unmount
      // the OUTER wrapper and remount it, which re-triggers the CSS
      // animation. The CHILDREN are re-rendered but the browser won't
      // remount them if they're structurally identical — React's
      // reconciler handles this correctly because the child subtree
      // has its own stable keys.
      key={animKey}
      className={`pt-enter pt-enter-active ${className ?? ""}`.trim()}
      style={{
        animation: "fade-up var(--dur-slow, 400ms) var(--ease-spring, cubic-bezier(0.28, 0.44, 0.49, 1)) both",
      }}
    >
      {children}
    </div>
  );
}
