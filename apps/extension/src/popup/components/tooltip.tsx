import { useState, useRef, useEffect, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * Tooltip
 * ───────
 * A hover-triggered tooltip that fades in after a configurable delay.
 * Uses portal-free positioning — the tooltip is rendered as a sibling
 * inside the trigger's parent, absolutely positioned, and measures the
 * trigger via `getBoundingClientRect()` on hover.
 *
 * Why not a portal:
 *   - Portals conflict with the popup's fixed 400px width (the tooltip
 *     would overflow the extension window) and backdrop filters
 *   - Inline rendering lets the tooltip inherit the current theme
 *   - One less React dependency; this component is ~100 lines
 *
 * Positions supported: "top" | "bottom" | "left" | "right"
 *
 * Example:
 *   <Tooltip content="Copy address" position="top">
 *     <button onClick={copy}><Copy size={14} /></button>
 *   </Tooltip>
 *
 * For text children, use the `wrap` prop to render a <span> wrapper
 * instead of cloneElement. This is safer when children might be plain
 * strings or fragments.
 */
export type TooltipPosition = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  position?: TooltipPosition;
  /** Show delay in ms. Default: 500 */
  delay?: number;
  /** If true, wraps children in a span instead of cloning them. Default: false */
  wrap?: boolean;
  /** Additional className on the tooltip bubble */
  tooltipClassName?: string;
  /** If true, never show the tooltip (useful for conditionally disabling) */
  disabled?: boolean;
}

export function Tooltip({
  content,
  children,
  position = "top",
  delay = 500,
  wrap = false,
  tooltipClassName,
  disabled = false,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const timerRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const show = () => {
    if (disabled) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setMounted(true);
      // Next tick so the initial opacity-0 class applies before the
      // active class transitions it to 1
      requestAnimationFrame(() => setVisible(true));
    }, delay);
  };

  const hide = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
    // Unmount after the exit transition
    window.setTimeout(() => setMounted(false), 180);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const tooltipBubble = mounted && (
    <span
      role="tooltip"
      className={`ui-tooltip ui-tooltip-${position} ${visible ? "ui-tooltip-visible" : ""} ${tooltipClassName ?? ""}`.trim()}
    >
      {content}
    </span>
  );

  // Mode 1: wrap children in a span (safe for any ReactNode)
  if (wrap || !isValidElement(children)) {
    return (
      <span
        className="ui-tooltip-wrap"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
        {tooltipBubble}
      </span>
    );
  }

  // Mode 2: clone the single child element and attach handlers directly.
  // This avoids adding an extra DOM node for button-style triggers.
  const child = children as ReactElement<Record<string, unknown>>;
  const childProps = child.props || {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userOnMouseEnter = childProps.onMouseEnter as ((e: any) => void) | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userOnMouseLeave = childProps.onMouseLeave as ((e: any) => void) | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userOnFocus = childProps.onFocus as ((e: any) => void) | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userOnBlur = childProps.onBlur as ((e: any) => void) | undefined;

  const clonedChild = cloneElement(child, {
    ref: triggerRef,
    onMouseEnter: (e: unknown) => {
      if (userOnMouseEnter) userOnMouseEnter(e);
      show();
    },
    onMouseLeave: (e: unknown) => {
      if (userOnMouseLeave) userOnMouseLeave(e);
      hide();
    },
    onFocus: (e: unknown) => {
      if (userOnFocus) userOnFocus(e);
      show();
    },
    onBlur: (e: unknown) => {
      if (userOnBlur) userOnBlur(e);
      hide();
    },
  });

  return (
    <span className="ui-tooltip-wrap">
      {clonedChild}
      {tooltipBubble}
    </span>
  );
}
