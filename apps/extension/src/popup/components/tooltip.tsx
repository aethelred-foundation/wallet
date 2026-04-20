import {
  memo,
  useState,
  useRef,
  useEffect,
  cloneElement,
  isValidElement,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * Polymorphic event-handler aliases mirroring React's DOM callback shapes.
 * Using `unknown` as the element parameter keeps the clone-through helpers
 * usable on any host element type (buttons, anchors, <li>, etc.) without
 * imposing a specific element tag.
 */
type PointerHandler = (event: ReactMouseEvent<Element>) => void;
type FocusHandler = (event: ReactFocusEvent<Element>) => void;

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

function TooltipImpl({
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

  const userOnMouseEnter = childProps.onMouseEnter as PointerHandler | undefined;
  const userOnMouseLeave = childProps.onMouseLeave as PointerHandler | undefined;
  const userOnFocus = childProps.onFocus as FocusHandler | undefined;
  const userOnBlur = childProps.onBlur as FocusHandler | undefined;

  const clonedChild = cloneElement(child, {
    ref: triggerRef,
    onMouseEnter: (e: ReactMouseEvent<Element>) => {
      if (userOnMouseEnter) userOnMouseEnter(e);
      show();
    },
    onMouseLeave: (e: ReactMouseEvent<Element>) => {
      if (userOnMouseLeave) userOnMouseLeave(e);
      hide();
    },
    onFocus: (e: ReactFocusEvent<Element>) => {
      if (userOnFocus) userOnFocus(e);
      show();
    },
    onBlur: (e: ReactFocusEvent<Element>) => {
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

export const Tooltip = memo(TooltipImpl);
