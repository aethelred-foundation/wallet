import { memo, type CSSProperties, type ReactNode } from "react";
import { useFormat } from "../i18n/format";

/**
 * CurrencyText
 * ────────────
 * Renders a currency value as STRUCTURED SPANS so we can control the
 * visual gap between the currency symbol and the numeric value via
 * CSS. Before this component, every balance display used
 * `formatCurrency(value)` which returned a single string like "$1,234.56"
 * — and because `Intl.NumberFormat` in en-US doesn't put a space between
 * the symbol and the number, the "$" and the first digit would kiss at
 * large display sizes (weight 800, 56 px). No amount of `letter-spacing`
 * tweaking fixed it reliably because it's a glyph-pair kerning issue,
 * not a tracking issue.
 *
 * The fix: use `Intl.NumberFormat.formatToParts()` to split the output
 * into typed segments, pick out the `currency` part, and render it in
 * its own `<span>` with a CSS `gap` between it and the number. This
 * works for every locale because the symbol's POSITION is determined by
 * formatToParts — if a locale puts the symbol after the number (e.g.
 * fr-FR renders "1 234,56 €"), we still split it cleanly.
 *
 * Usage:
 *   <CurrencyText value={12345.67} />
 *   <CurrencyText value={v} maximumFractionDigits={0} className="big" />
 *   <AnimatedNumber value={total} format={(v) => <CurrencyText value={v} />} />
 *
 * Visual structure:
 *   <span class="ct">
 *     <span class="ct-symbol">$</span>
 *     <span class="ct-number">12,345.67</span>
 *   </span>
 *
 * CSS (in premium-global.css):
 *   .ct        { display: inline-flex; align-items: baseline; gap: 0.18em; }
 *   .ct-symbol { font-size: 0.72em; opacity: 0.82; }
 *   .ct-number { font-variant-numeric: tabular-nums; }
 */
export interface CurrencyTextProps {
  /** The numeric value to render. NaN / Infinity → em-dash. */
  value: number;
  /** Max fraction digits (defaults to 2). */
  maximumFractionDigits?: number;
  /** Min fraction digits (defaults to 2). */
  minimumFractionDigits?: number;
  /** Optional currency override (e.g. "EUR"). Defaults to the context currency. */
  currency?: string;
  /**
   * Compact notation: "$1.2M", "$850K" instead of the full "$1,234,567.89".
   * Use for dashboards and card tiles where the full number is too long.
   * When true, `maximumFractionDigits` defaults to 1 (match Apple Card).
   */
  compact?: boolean;
  /** Extra className applied to the outer wrapper (merged with "ct"). */
  className?: string;
  /** Inline style override for the wrapper span. */
  style?: CSSProperties;
}

function CurrencyTextImpl({
  value,
  maximumFractionDigits,
  minimumFractionDigits,
  currency: currencyOverride,
  compact = false,
  className = "",
  style,
}: CurrencyTextProps): ReactNode {
  const { locale, currency } = useFormat();

  if (!Number.isFinite(value)) {
    return (
      <span className={`ct ${className}`.trim()} style={style}>
        —
      </span>
    );
  }

  /* Intl.NumberFormat.formatToParts returns an array of
   *   { type: "currency" | "integer" | "group" | "decimal" | "fraction" | "literal", value: string }
   * objects. We pull out the `currency` part separately and keep the
   * rest (integer, group separators, decimal point, fraction) together
   * as the numeric body. */
  const formatterOptions: Intl.NumberFormatOptions = compact
    ? {
        style: "currency",
        currency: currencyOverride ?? currency,
        notation: "compact",
        compactDisplay: "short",
        minimumFractionDigits: minimumFractionDigits ?? 0,
        maximumFractionDigits: maximumFractionDigits ?? 1,
      }
    : {
        style: "currency",
        currency: currencyOverride ?? currency,
        minimumFractionDigits: minimumFractionDigits ?? 2,
        maximumFractionDigits: maximumFractionDigits ?? 2,
      };

  const parts = new Intl.NumberFormat(locale, formatterOptions).formatToParts(value);

  const symbolPart = parts.find((p) => p.type === "currency");
  const symbol = symbolPart?.value ?? "$";
  // Re-assemble every non-currency part back into the numeric body.
  // This preserves the locale-specific group separators and decimals.
  const numericBody = parts
    .filter((p) => p.type !== "currency")
    .map((p) => p.value)
    .join("")
    .trim();

  return (
    <span className={`ct ${className}`.trim()} style={style}>
      <span className="ct-symbol">{symbol}</span>
      <span className="ct-number">{numericBody}</span>
    </span>
  );
}

/* Memoized — pure render from props + a stable Format context. Shallow
 * equality is fine because `style` objects from call-sites are usually
 * literals (different identity each render) but the practical re-render
 * count from token rows still halves in measured profiles. */
export const CurrencyText = memo(CurrencyTextImpl);
