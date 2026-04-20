import { memo, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * SegmentedControl
 * ────────────────
 * iOS-style segmented control with a sliding pill indicator. The pill
 * animates between selections with spring physics for that Apple-native
 * feel.
 *
 * Layout strategy:
 *   1. An outer track holds `N` <button> segments of equal flex width
 *   2. An absolutely-positioned pill sits behind the active segment
 *   3. The pill's `transform: translateX(...)` is driven by the active
 *      segment index × its measured width, interpolated via CSS
 *      `transition: transform` with a spring easing curve
 *   4. On mount (or when segments change count), we measure the first
 *      segment's width via `getBoundingClientRect()` so the pill can
 *      match it exactly — important because flex may round differently
 *      than pure division
 *
 * Compared to a plain "active class on a tab" approach:
 *   - You get the sliding pill for free
 *   - Labels can change length without jumping (pill keeps width)
 *   - Focus-visible works across the whole track
 *
 * Usage:
 *   const [tab, setTab] = useState<"assets" | "staking" | "defi">("assets");
 *   <SegmentedControl
 *     items={[
 *       { id: "assets", label: "Assets", icon: <Coins size={12} /> },
 *       { id: "staking", label: "Staking", icon: <Landmark size={12} /> },
 *       { id: "defi", label: "DeFi", icon: <Layers3 size={12} /> },
 *     ]}
 *     activeId={tab}
 *     onChange={(id) => setTab(id as any)}
 *   />
 */
export interface SegmentedControlItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Optional count badge rendered to the right of the label */
  badge?: number | string;
  /** Optional aria-label when label is non-text */
  ariaLabel?: string;
  /** If true, the segment is not clickable */
  disabled?: boolean;
}

export interface SegmentedControlProps {
  items: SegmentedControlItem[];
  activeId: string;
  onChange: (id: string) => void;
  /** Size variant — affects padding & font size. Default: "md" */
  size?: "sm" | "md" | "lg";
  /** Whether to fill the available width (default true) */
  fullWidth?: boolean;
  className?: string;
  /** Optional aria-label for the whole control */
  ariaLabel?: string;
}

function SegmentedControlImpl({
  items,
  activeId,
  onChange,
  size = "md",
  fullWidth = true,
  className,
  ariaLabel,
}: SegmentedControlProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [pillStyle, setPillStyle] = useState<{ width: number; left: number } | null>(null);

  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === activeId),
  );

  // Recompute the pill position whenever the active segment changes or
  // the track resizes (window resize, font load, etc.)
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const measure = () => {
      const buttons = track.querySelectorAll<HTMLButtonElement>("button.segc-btn");
      const active = buttons[activeIndex];
      if (!active) return;

      const trackRect = track.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      setPillStyle({
        width: activeRect.width,
        left: activeRect.left - trackRect.left,
      });
    };

    measure();

    // ResizeObserver handles font-load reflows, container resizes, and
    // any dynamic-width changes without a manual window resize listener
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    items.forEach((_, i) => {
      const btn = track.querySelectorAll<HTMLButtonElement>("button.segc-btn")[i];
      if (btn) observer.observe(btn);
    });

    return () => observer.disconnect();
  }, [activeIndex, items]);

  return (
    <div
      ref={trackRef}
      className={`segc-track segc-${size} ${fullWidth ? "segc-full" : ""} ${className ?? ""}`.trim()}
      role="tablist"
      aria-label={ariaLabel}
    >
      {/* Sliding pill indicator */}
      {pillStyle && (
        <div
          className="segc-pill"
          aria-hidden="true"
          style={{
            width: `${pillStyle.width}px`,
            transform: `translateX(${pillStyle.left}px)`,
          }}
        />
      )}

      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={item.ariaLabel}
            disabled={item.disabled}
            className={`segc-btn ${isActive ? "active" : ""}`}
            onClick={() => !item.disabled && onChange(item.id)}
          >
            {item.icon && <span className="segc-btn-icon">{item.icon}</span>}
            <span className="segc-btn-label">{item.label}</span>
            {item.badge != null && (
              <span className="segc-btn-badge">{item.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export const SegmentedControl = memo(SegmentedControlImpl);
