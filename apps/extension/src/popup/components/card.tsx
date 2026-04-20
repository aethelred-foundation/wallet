import { memo, type ReactNode, type CSSProperties, type MouseEventHandler } from "react";

/**
 * Card
 * ────
 * The shared surface primitive used everywhere except the hero Balance
 * card (which is custom). Encapsulates the glass-morphism + design-token
 * treatment so every view can stop hand-rolling their own panel styles.
 *
 * Variants:
 *   - "solid"     — opaque surface, default for dense lists
 *   - "glass"     — translucent with backdrop-blur, for hero sections
 *   - "accent"    — accent-tinted border with soft glow, for CTAs
 *   - "warning"   — orange-tinted, for risk warnings
 *   - "success"   — green-tinted, for confirmations
 *
 * Padding scale follows the 4-pt grid: sm (var(--space-2)), md (var(--space-3)),
 * lg (var(--space-4)), xl (var(--space-5)). Defaults to md.
 *
 * Elevation (0-5) maps to --shadow-0 through --shadow-5.
 *
 * Example:
 *   <Card variant="glass" padding="lg" elevation={3}>
 *     <h2>Your balance</h2>
 *     <p>$12,345.67</p>
 *   </Card>
 */
export type CardVariant = "solid" | "glass" | "accent" | "warning" | "success";
export type CardPadding = "none" | "sm" | "md" | "lg" | "xl";
export type CardElevation = 0 | 1 | 2 | 3 | 4 | 5;

export interface CardProps {
  variant?: CardVariant;
  padding?: CardPadding;
  elevation?: CardElevation;
  /** If true, applies a spring-eased press-down on click */
  interactive?: boolean;
  /** When set, Card renders as a <button> instead of a <div> */
  onClick?: MouseEventHandler<HTMLElement>;
  /** Extra className appended after the base classes */
  className?: string;
  /** Inline style override (rarely needed — prefer tokens) */
  style?: CSSProperties;
  children: ReactNode;
  /** Optional aria-label when used as a button */
  ariaLabel?: string;
}

const PADDING_VAR: Record<CardPadding, string> = {
  none: "0",
  sm: "var(--space-2)",
  md: "var(--space-3)",
  lg: "var(--space-4)",
  xl: "var(--space-5)",
};

function CardImpl({
  variant = "solid",
  padding = "md",
  elevation = 1,
  interactive = false,
  onClick,
  className,
  style,
  children,
  ariaLabel,
}: CardProps) {
  const isButton = !!onClick;
  const classNames = [
    "ui-card",
    `ui-card-${variant}`,
    interactive || isButton ? "ui-card-interactive motion-press" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const computedStyle: CSSProperties = {
    padding: PADDING_VAR[padding],
    boxShadow: `var(--shadow-${elevation})`,
    ...style,
  };

  if (isButton) {
    return (
      <button
        type="button"
        className={classNames}
        style={computedStyle}
        onClick={onClick}
        aria-label={ariaLabel}
      >
        {children}
      </button>
    );
  }

  return (
    <div className={classNames} style={computedStyle}>
      {children}
    </div>
  );
}

export const Card = memo(CardImpl);

/**
 * CardHeader — standardized header for cards. Renders a title + optional
 * subtitle/action row. Use inside Card as the first child when you want
 * the classic "header above content" layout.
 */
export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Optional action slot (button, icon, etc.) rendered on the right */
  action?: ReactNode;
  /** Optional icon rendered to the left of the title */
  icon?: ReactNode;
  className?: string;
}

function CardHeaderImpl({ title, subtitle, action, icon, className }: CardHeaderProps) {
  return (
    <header className={`ui-card-header ${className ?? ""}`.trim()}>
      {icon && <div className="ui-card-header-icon">{icon}</div>}
      <div className="ui-card-header-body">
        <div className="ui-card-header-title">{title}</div>
        {subtitle && <div className="ui-card-header-subtitle">{subtitle}</div>}
      </div>
      {action && <div className="ui-card-header-action">{action}</div>}
    </header>
  );
}

export const CardHeader = memo(CardHeaderImpl);

/**
 * CardDivider — a thin 1px line with token-driven color, for separating
 * sections inside a card without breaking into two cards.
 */
function CardDividerImpl({ className }: { className?: string }) {
  return <hr className={`ui-card-divider ${className ?? ""}`.trim()} />;
}

export const CardDivider = memo(CardDividerImpl);
