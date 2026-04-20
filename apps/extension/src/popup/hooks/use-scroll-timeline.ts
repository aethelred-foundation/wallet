import { useEffect, useRef, useState, type RefObject } from "react";
import { clamp01, prefersReducedMotion } from "../design/motion";

/**
 * Scroll-linked animation hooks.
 *
 * Modern Chromium supports CSS scroll-timeline / view-timeline natively,
 * but we still need a polyfill path for users on older builds (and
 * testing environments). These hooks expose a simple `number` (0..1)
 * that tracks the element's position relative to the scroll viewport —
 * callers plug that into any CSS property or JS transform they want.
 *
 * Three scenarios covered:
 *
 *   - useScrollOpacity(ref, opts)  — fades an element out as it scrolls
 *     past a threshold. Used on the home hero.
 *   - useScrollProgress(ref)       — 0..1 progress of an element through
 *     the viewport (0 = just entered, 1 = about to leave).
 *   - useParallax(ref, speed)      — maps scroll delta to a translateY in
 *     pixels, for parallax-style heroes.
 *
 * All three short-circuit to a final-state value when
 * `prefers-reduced-motion: reduce` is set, so motion-sensitive users
 * aren't pelted with scroll-driven effects.
 *
 * @example
 *   const heroRef = useRef<HTMLDivElement>(null);
 *   const opacity = useScrollOpacity(heroRef, { start: "top", end: "bottom" });
 *   <div ref={heroRef} style={{ opacity }}>...</div>
 */

type ScrollStart = "top" | "center";
type ScrollEnd = "bottom" | "center";

interface ScrollRangeOptions {
  /** Where the effect starts relative to viewport. Default: "center". */
  start?: ScrollStart;
  /** Where the effect ends relative to viewport. Default: "bottom". */
  end?: ScrollEnd;
  /** If true, 0 means "in view" and 1 means "out of view". Default: true. */
  invert?: boolean;
}

function findScrollParent(el: HTMLElement | null): HTMLElement | Window {
  if (!el) return window;
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const style = window.getComputedStyle(cur);
    const overflowY = style.overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return cur;
    cur = cur.parentElement;
  }
  return window;
}

/**
 * Subscribe to scroll + resize events on the nearest scrollable ancestor
 * and re-run `compute` on each tick. Returns the current computed value.
 *
 * Internal helper — uses RAF throttling so a fast scroll doesn't burn
 * the main thread.
 */
function useScrollValue<T>(
  ref: RefObject<HTMLElement>,
  compute: (rect: DOMRect, viewport: { height: number; width: number }) => T,
  fallback: T,
): T {
  const [value, setValue] = useState<T>(fallback);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(fallback);
      return;
    }
    const el = ref.current;
    if (!el) return;

    const scroller = findScrollParent(el);
    let active = true;

    const tick = () => {
      rafRef.current = null;
      if (!active) return;
      const node = ref.current;
      if (!node) return;
      try {
        const rect = node.getBoundingClientRect();
        const viewport = {
          height: scroller === window
            ? window.innerHeight
            : (scroller as HTMLElement).clientHeight,
          width: scroller === window
            ? window.innerWidth
            : (scroller as HTMLElement).clientWidth,
        };
        setValue(compute(rect, viewport));
      } catch {
        // getBoundingClientRect may throw if the node was detached —
        // stay on the last computed value.
      }
    };

    const schedule = () => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(tick);
    };

    // Initial compute so callers get a real value on first paint.
    schedule();

    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      active = false;
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, fallback]);

  return value;
}

/**
 * Returns an opacity value [0, 1] that decreases as the element scrolls
 * past the viewport threshold.
 *
 * - `start: "top"` begins fading when the element hits the viewport top.
 * - `end: "bottom"` completes the fade when the element leaves the bottom.
 *
 * Default behaviour: element is fully opaque when centered in viewport,
 * fades to 0 as it leaves the bottom.
 */
export function useScrollOpacity(
  ref: RefObject<HTMLElement>,
  options: ScrollRangeOptions = {},
): number {
  const { start = "center", end = "bottom" } = options;
  return useScrollValue(
    ref,
    (rect, viewport) => {
      // startY / endY define the band (in viewport pixels) over which
      // the fade plays. Element centre position is rect.top + rect.height/2.
      const centreY = rect.top + rect.height / 2;
      const startY = start === "top" ? 0 : viewport.height / 2;
      const endY = end === "bottom" ? viewport.height : viewport.height / 2;

      if (startY === endY) return 1;
      const progress = (centreY - startY) / (endY - startY);
      return clamp01(1 - progress);
    },
    1,
  );
}

/**
 * Returns a progress value [0, 1] describing where the element is in the
 * viewport.
 *
 *   - 0 when the element just entered the viewport from the bottom
 *   - 0.5 when the element is centred vertically
 *   - 1 when the element has just left from the top
 */
export function useScrollProgress(ref: RefObject<HTMLElement>): number {
  return useScrollValue(
    ref,
    (rect, viewport) => {
      const centreY = rect.top + rect.height / 2;
      const travel = viewport.height + rect.height;
      const raw = (viewport.height - centreY + rect.height / 2) / travel;
      return clamp01(raw);
    },
    0,
  );
}

/**
 * Returns a translateY value (in pixels) that tracks the scroll position
 * for a parallax effect. Positive `speed` means element moves faster than
 * scroll (deeper depth), negative means slower (shallower depth).
 *
 * @example
 *   const translateY = useParallax(heroRef, -0.2);
 *   <div ref={heroRef} style={{ transform: `translateY(${translateY}px)` }}>
 */
export function useParallax(ref: RefObject<HTMLElement>, speed: number = -0.25): number {
  return useScrollValue(
    ref,
    (rect) => {
      // Negative speed = classic parallax (element sinks).
      return -rect.top * speed;
    },
    0,
  );
}

/**
 * useInViewStagger — returns a boolean that flips to `true` once the
 * element has entered the viewport, and stays true forever after. Used
 * to trigger one-shot entrance animations on scroll.
 *
 * @example
 *   const inView = useInViewStagger(ref);
 *   <div ref={ref} style={{ opacity: inView ? 1 : 0 }}>
 */
export function useInViewStagger(
  ref: RefObject<HTMLElement>,
  threshold: number = 0.2,
): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // No IO → assume in view (better than permanently hidden).
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
            return;
          }
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, threshold]);

  return inView;
}
