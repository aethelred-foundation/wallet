import { useRef, useEffect, useMemo, useCallback, useState } from "react";
import { EASE, DURATION, prefersReducedMotion } from "../design/motion";

/**
 * Hero (shared element) transitions — SwiftUI `matchedGeometryEffect`
 * equivalent for the web.
 *
 * SwiftUI lets a view declare an `id` and `namespace`, and the runtime
 * animates between two views that share the same id — token logo sliding
 * from a row into the detail header, balance number lifting into the
 * send screen, etc. The web platform recently shipped the
 * `document.startViewTransition()` API that does the same thing with a
 * single call, but browser support is still patchy (Chromium 111+,
 * Safari 18, nothing in Firefox). This module:
 *
 *   1. Detects `startViewTransition` and prefers the native path.
 *   2. Falls back to a FLIP (First-Last-Invert-Play) implementation that
 *      measures element positions before and after a DOM change, then
 *      replays the delta as a CSS transform.
 *
 * The FLIP fallback uses `position` and `dimensions` from
 * `getBoundingClientRect`, not the element's layout-box — which is both
 * faster and avoids thrashing when multiple hero transitions run in
 * parallel.
 *
 * @example
 *   function TokenCard({ symbol }: { symbol: string }) {
 *     const { ref, transitionName } = useSharedElement(`token-${symbol}`);
 *     return (
 *       <div ref={ref} style={{ viewTransitionName: transitionName }}>
 *         ...
 *       </div>
 *     );
 *   }
 */

export interface SharedElementApi {
  /** Ref to spread onto the DOM node you want to animate. */
  ref: React.RefObject<HTMLElement>;
  /** CSS `view-transition-name` value — unique per id across the DOM. */
  transitionName: string;
}

/**
 * Sanitize an id for use as a `view-transition-name` value. The spec
 * requires a valid custom identifier (letters, digits, `-`, `_`), so we
 * strip or replace anything else.
 */
function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "shared";
}

/**
 * Map live element refs per id so FLIP can measure before/after positions
 * of the SAME logical element across remounts. Keyed by the sanitized id.
 */
const liveElements = new Map<string, { rect: DOMRect; node: HTMLElement } | null>();

export function useSharedElement(id: string): SharedElementApi {
  const ref = useRef<HTMLElement>(null);
  const transitionName = useMemo(() => `sh-${sanitize(id)}`, [id]);

  // Before unmount: snapshot our rect so a sibling on the next screen
  // can read it and run FLIP.
  useEffect(() => {
    return () => {
      const node = ref.current;
      if (!node) return;
      try {
        liveElements.set(transitionName, { rect: node.getBoundingClientRect(), node });
      } catch {
        // ignore
      }
    };
  }, [transitionName]);

  // On mount: check if a previous element with the same id registered a
  // rect — if so, FLIP from there to here.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion()) return;

    const prev = liveElements.get(transitionName);
    if (!prev) return;

    // Don't FLIP from ourselves.
    if (prev.node === node) return;

    const nextRect = node.getBoundingClientRect();
    const dx = prev.rect.left - nextRect.left;
    const dy = prev.rect.top - nextRect.top;
    const dw = prev.rect.width / (nextRect.width || 1);
    const dh = prev.rect.height / (nextRect.height || 1);

    if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && Math.abs(dw - 1) < 0.01 && Math.abs(dh - 1) < 0.01) {
      // No meaningful delta — skip animation
      liveElements.delete(transitionName);
      return;
    }

    // Apply inverse transform immediately so visually the element is
    // still "where it was". Then clear on the next frame and let the
    // browser's CSS transition animate the delta to zero — that's the
    // "Play" in FLIP.
    const prevTransition = node.style.transition;
    node.style.transition = "none";
    node.style.transformOrigin = "top left";
    node.style.transform = `translate(${dx}px, ${dy}px) scale(${dw}, ${dh})`;

    // Force a reflow so the browser commits the starting transform.
    void node.offsetHeight;

    node.style.transition = `transform ${DURATION.slow}ms ${EASE.spring}`;
    node.style.transform = "";

    const cleanup = () => {
      node.style.transition = prevTransition;
      node.style.transform = "";
      node.style.transformOrigin = "";
      node.removeEventListener("transitionend", cleanup);
    };
    node.addEventListener("transitionend", cleanup);

    liveElements.delete(transitionName);

    return () => {
      node.removeEventListener("transitionend", cleanup);
    };
  }, [transitionName]);

  return { ref, transitionName };
}

/**
 * Imperatively wrap a DOM mutation in a view transition. Call this from
 * a click handler that navigates between routes so the browser can
 * cross-fade shared elements.
 *
 * If `document.startViewTransition` isn't available, the callback still
 * runs — just synchronously, without the cross-fade. That matches what
 * you'd want as a degradation: the mutation happens regardless.
 *
 * @example
 *   <button onClick={() => withViewTransition(() => navigate("detail"))}>
 *     Token
 *   </button>
 */
export function withViewTransition(
  update: () => void | Promise<void>,
): Promise<void> | void {
  if (prefersReducedMotion()) {
    return void update();
  }
  type Vt = { startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void> } };
  const doc = typeof document !== "undefined" ? (document as unknown as Vt) : null;
  if (!doc || typeof doc.startViewTransition !== "function") {
    return void update();
  }
  try {
    const t = doc.startViewTransition(() => update());
    return t.finished.catch(() => undefined);
  } catch {
    return void update();
  }
}

/**
 * useScheduledViewTransition — hook variant that returns a function you
 * can call from onClick. Equivalent to calling `withViewTransition`
 * directly, but stable across renders and quietly no-ops when unmounted.
 */
export function useScheduledViewTransition(): (update: () => void | Promise<void>) => void {
  const mountedRef = useRef(true);
  const [, setRerender] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return useCallback((update: () => void | Promise<void>) => {
    if (!mountedRef.current) return;
    const result = withViewTransition(update);
    // No need to await; we already handled promise rejection. Triggering
    // a harmless rerender lets consumers watching state trigger flushes.
    if (result instanceof Promise) {
      void result.finally(() => {
        if (mountedRef.current) setRerender((n) => (n + 1) % 1_000_000);
      });
    }
  }, []);
}

/**
 * useFlipOnChange — FLIP animates an element across layout changes that
 * happen within the same mount (e.g. list reorders, expand/collapse).
 * Pass a key that changes whenever the element's position could shift.
 *
 * Under the hood: captures rect on the previous render, applies inverse
 * transform on the next render, and lets CSS play it back to zero.
 */
export function useFlipOnChange<T extends HTMLElement>(key: unknown): React.RefObject<T> {
  const ref = useRef<T>(null);
  const prevRectRef = useRef<DOMRect | null>(null);

  // Capture rect BEFORE React applies the next layout. `useLayoutEffect`
  // would be more correct, but eslint complains about it without a DOM —
  // useEffect runs after paint which is still fine for FLIP.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const nextRect = node.getBoundingClientRect();
    const prevRect = prevRectRef.current;
    prevRectRef.current = nextRect;

    if (!prevRect || prefersReducedMotion()) return;

    const dx = prevRect.left - nextRect.left;
    const dy = prevRect.top - nextRect.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    node.style.transition = "none";
    node.style.transform = `translate(${dx}px, ${dy}px)`;
    void node.offsetHeight;
    node.style.transition = `transform ${DURATION.slow}ms ${EASE.spring}`;
    node.style.transform = "";
    const cleanup = () => {
      node.style.transition = "";
      node.style.transform = "";
      node.removeEventListener("transitionend", cleanup);
    };
    node.addEventListener("transitionend", cleanup);
  }, [key]);

  return ref;
}
