import { memo, type ReactNode } from "react";

/**
 * EmptyState
 * ──────────
 * The reusable "nothing here yet" fallback. Replaces the ad-hoc empty
 * divs scattered across views with a consistent visual treatment:
 *
 *   - Large icon with soft accent glow
 *   - Title (type-title)
 *   - Description (type-body, muted)
 *   - Optional primary + secondary actions
 *
 * Backward-compat: the old signature was `{ icon, title, description }`.
 * All three are still accepted. New props (action, secondaryAction, tone,
 * padding) are purely additive.
 *
 * Example:
 *   <EmptyState
 *     icon={<Inbox size={28} />}
 *     title="No notifications yet"
 *     description="Approvals and alerts will appear here."
 *     action={{ label: "Refresh", onClick: refetch }}
 *   />
 *
 * Variants (via `tone` prop) tint the icon glow:
 *   - "neutral" (default) — muted gray
 *   - "success" — green (positive empty state, e.g. "all caught up")
 *   - "warning" — orange
 *   - "info"    — blue
 */
export type EmptyStateTone = "neutral" | "success" | "warning" | "info";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  /** If true, renders as a primary filled button (else secondary outline) */
  primary?: boolean;
  /** Optional leading icon */
  icon?: ReactNode;
}

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  /** Primary action (rendered first, filled button) */
  action?: EmptyStateAction;
  /** Optional secondary action (rendered after, outlined button) */
  secondaryAction?: EmptyStateAction;
  tone?: EmptyStateTone;
  /** Vertical padding scale — "sm" for inline, "lg" for full views. Default: md */
  padding?: "sm" | "md" | "lg";
  className?: string;
}

function EmptyStateImpl({
  icon,
  title,
  description,
  action,
  secondaryAction,
  tone = "neutral",
  padding = "md",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={`empty-state empty-state-${tone} empty-state-${padding} motion-fade-up ${className ?? ""}`.trim()}
      role="status"
      aria-live="polite"
    >
      <div className="empty-state-icon-wrap">
        <div className="empty-state-icon-glow" aria-hidden="true" />
        <div className="empty-state-icon">{icon}</div>
      </div>
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-description">{description}</p>}
      {(action || secondaryAction) && (
        <div className="empty-state-actions">
          {action && (
            <button
              className={`empty-state-btn ${action.primary !== false ? "primary" : "secondary"} motion-press`}
              type="button"
              onClick={action.onClick}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          )}
          {secondaryAction && (
            <button
              className="empty-state-btn secondary motion-press"
              type="button"
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.icon}
              <span>{secondaryAction.label}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export const EmptyState = memo(EmptyStateImpl);
