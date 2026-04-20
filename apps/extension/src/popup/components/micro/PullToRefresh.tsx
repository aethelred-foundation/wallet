import { useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { useHaptics } from "../../hooks/use-haptics";
import { EASE, DURATION, prefersReducedMotion } from "../../design/motion";

/**
 * PullToRefresh — classic iOS-style elastic pull with Aethelred icon
 * unfurl at the threshold, then fires an async onRefresh handler.
 *
 * Touch handling:
 *
 *   - Listens to `touchstart` / `touchmove` / `touchend` on the wrapper.
 *   - Only engages when the scroll container is at scrollTop=0 (so
 *     natural scroll takes precedence).
 *   - Rubber-band resistance: `pull = sqrt(rawPull * MAX_PULL)` so the
 *     further the user drags, the less the band yields — matches iOS.
 *   - Threshold crossed → spinner locks at the threshold position,
 *     haptic impact fires, `onRefresh()` is invoked.
 *   - Commit: after `onRefresh()` resolves (or a 2s safety timeout),
 *     the indicator spring-eases back to 0.
 *
 * Also supports mouse-wheel scroll beyond the top for desktop users — a
 * subtle polish that users don't consciously notice but appreciate.
 *
 * @example
 *   <PullToRefresh onRefresh={async () => { await refetch(); }}>
 *     <PortfolioList />
 *   </PullToRefresh>
 */

export interface PullToRefreshProps {
  /** Async function that fetches fresh data. Fired once per pull. */
  onRefresh: () => Promise<void> | void;
  /** Threshold in pixels the user must pull past. Default: 72 */
  threshold?: number;
  /** Max pull distance (rubber-band clamp). Default: 120 */
  maxPull?: number;
  /** Children (the scrollable content) */
  children: ReactNode;
  /** Optional extra className on the wrapper */
  className?: string;
  /** Disable the component (static pass-through). Default: false */
  disabled?: boolean;
}

export function PullToRefresh({
  onRefresh,
  threshold = 72,
  maxPull = 120,
  children,
  className,
  disabled = false,
}: PullToRefreshProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const haptics = useHaptics();
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [armed, setArmed] = useState(false);

  // Refs for state the touch handlers need without triggering re-renders.
  const startYRef = useRef<number>(0);
  const activeRef = useRef<boolean>(false);
  const armedRef = useRef<boolean>(false);
  const refreshingRef = useRef<boolean>(false);

  useEffect(() => {
    if (disabled) return;
    const el = wrapperRef.current;
    if (!el) return;

    // Scroll container = nearest vertically-scrollable ancestor of our
    // wrapper. Defaults to the wrapper itself.
    const scroller = (() => {
      let cur: HTMLElement | null = el;
      while (cur) {
        const overflow = window.getComputedStyle(cur).overflowY;
        if (overflow === "auto" || overflow === "scroll") return cur;
        cur = cur.parentElement;
      }
      return document.documentElement;
    })();

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (scroller.scrollTop > 0) return;
      activeRef.current = true;
      startYRef.current = e.touches[0]?.clientY ?? 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!activeRef.current) return;
      const currentY = e.touches[0]?.clientY ?? 0;
      const rawDelta = currentY - startYRef.current;
      if (rawDelta <= 0) {
        setPullY(0);
        return;
      }
      // Rubber-band resistance
      const pull = Math.min(maxPull, Math.sqrt(rawDelta * maxPull));
      setPullY(pull);
      const shouldArm = pull >= threshold;
      if (shouldArm !== armedRef.current) {
        armedRef.current = shouldArm;
        setArmed(shouldArm);
        if (shouldArm) haptics.impact("medium");
      }
      if (scroller.scrollTop <= 0 && rawDelta > 0) {
        e.preventDefault();
      }
    };

    const onTouchEnd = async () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      const shouldCommit = armedRef.current;
      armedRef.current = false;
      setArmed(false);
      if (shouldCommit) {
        setRefreshing(true);
        refreshingRef.current = true;
        setPullY(threshold);
        haptics.success();

        let done = false;
        const safety = window.setTimeout(() => {
          if (!done) settle();
        }, 4000);

        const settle = () => {
          if (done) return;
          done = true;
          window.clearTimeout(safety);
          refreshingRef.current = false;
          setRefreshing(false);
          setPullY(0);
        };

        try {
          await onRefresh();
        } finally {
          settle();
        }
      } else {
        setPullY(0);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [disabled, threshold, maxPull, haptics, onRefresh]);

  const reduced = prefersReducedMotion();
  const progress = Math.min(1, pullY / threshold);

  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{
        position: "relative",
        overscrollBehaviorY: "contain",
      }}
    >
      {/* Indicator — the Aethelred circle "unfurls" as pullY increases */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: `translate(-50%, ${pullY - 40}px)`,
          transition: reduced
            ? "none"
            : activeRef.current
              ? "none"
              : `transform ${DURATION.slow}ms ${EASE.spring}`,
          pointerEvents: "none",
          zIndex: 3,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "var(--surface, rgba(255,255,255,0.9))",
            boxShadow: "0 6px 18px rgba(0,0,0,0.18), 0 1px 0 rgba(255,255,255,0.1) inset",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: progress,
            border: armed ? "1px solid rgba(52,199,89,0.7)" : "1px solid var(--line, rgba(255,255,255,0.12))",
            transition: reduced ? "none" : `border-color ${DURATION.fast}ms ${EASE.out}`,
          }}
        >
          <RefreshCw
            size={14}
            strokeWidth={2.4}
            style={{
              transform: `rotate(${progress * 360}deg)`,
              transition: reduced ? "none" : refreshing ? "none" : "transform 60ms linear",
              color: armed ? "#34c759" : "var(--text-2, #8e8e93)",
              animation: refreshing && !reduced ? "orbit-slow 0.9s linear infinite" : undefined,
            }}
          />
        </div>
      </div>

      <div
        style={{
          transform: `translate3d(0, ${pullY}px, 0)`,
          transition: reduced
            ? "none"
            : activeRef.current
              ? "none"
              : `transform ${DURATION.slow}ms ${EASE.spring}`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
