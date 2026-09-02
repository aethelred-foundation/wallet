import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";

/**
 * Format Context (i18n)
 * ─────────────────────
 * Single source of truth for number, currency, and percent formatting in the
 * popup. Every "$1,234.56" the user sees should eventually flow through this
 * context so we can swap locale and display-currency in one place.
 *
 * We deliberately do NOT depend on @formatjs/intl — the native
 * `Intl.NumberFormat` built into Chromium is ECMA-402 compliant and ships as
 * 0 bytes to the extension bundle. Since this is a Chrome extension, there is
 * no older-browser surface to polyfill.
 *
 * How to use:
 *   const { formatCurrency, formatPercent, formatCompact } = useFormat();
 *   <div>{formatCurrency(1234.56)}</div>
 *   <div>{formatPercent(0.0342)}</div>
 *   <div>{formatCompact(1_234_567)}</div>
 *
 * Changing locale/currency is persisted to localStorage via setLocale /
 * setCurrency, so subsequent popup opens pick up the same preference.
 */

const LOCALE_KEY = "aethelred-locale";
const CURRENCY_KEY = "aethelred-currency";

const DEFAULT_LOCALE = "en-US";
const DEFAULT_CURRENCY = "USD";

export interface FormatCurrencyOptions {
  /** Override the default minimumFractionDigits (default 2). */
  minimumFractionDigits?: number;
  /** Override the default maximumFractionDigits (default 2). */
  maximumFractionDigits?: number;
  /** Override the active currency for this single call. */
  currency?: string;
}

export interface FormatContextValue {
  locale: string;
  currency: string;
  setLocale: (next: string) => void;
  setCurrency: (next: string) => void;
  formatCurrency: (value: number, opts?: FormatCurrencyOptions) => string;
  formatNumber: (value: number, opts?: Intl.NumberFormatOptions) => string;
  formatPercent: (value: number, opts?: Intl.NumberFormatOptions) => string;
  formatCompact: (value: number) => string;
}

const FormatContext = createContext<FormatContextValue | null>(null);

/* ─── localStorage helpers ──────────────────────────────────────── */
/** localStorage can throw in private/incognito — every read/write is guarded. */
function readStored(key: string, fallback: string): string {
  try {
    const v = localStorage.getItem(key);
    return v && v.length > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — silently ignore */
  }
}

/* ─── Provider ──────────────────────────────────────────────────── */
export function FormatProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<string>(
    () => readStored(LOCALE_KEY, DEFAULT_LOCALE),
  );
  const [currency, setCurrencyState] = useState<string>(
    () => IS_PRODUCTION_BUILD ? DEFAULT_CURRENCY : readStored(CURRENCY_KEY, DEFAULT_CURRENCY),
  );

  /* Persist-on-set helpers. We keep these inside useCallback so the
     context value is referentially stable across re-renders that don't
     actually change locale/currency. */
  const setLocale = useCallback((next: string) => {
    setLocaleState(next);
    writeStored(LOCALE_KEY, next);
  }, []);

  const setCurrency = useCallback((next: string) => {
    const effectiveCurrency = IS_PRODUCTION_BUILD ? DEFAULT_CURRENCY : next;
    setCurrencyState(effectiveCurrency);
    writeStored(CURRENCY_KEY, effectiveCurrency);
  }, []);

  /* Memoize Intl.NumberFormat instances — creating them is not free and
     the same view can call formatCurrency hundreds of times on a single
     render pass (e.g. a token list). Rebuild only when locale/currency
     changes. */
  const currencyFmt = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [locale, currency],
  );

  const numberFmt = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }),
    [locale],
  );

  const percentFmt = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "percent",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        signDisplay: "exceptZero",
      }),
    [locale],
  );

  const compactCurrencyFmt = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        notation: "compact",
        compactDisplay: "short",
        maximumFractionDigits: 1,
      }),
    [locale, currency],
  );

  /* Bound formatting callbacks. These close over the memoized formatters
     above but accept per-call overrides so callers can tweak precision
     without rebuilding a formatter at the call site. */
  const formatCurrency = useCallback(
    (value: number, opts?: FormatCurrencyOptions): string => {
      if (!Number.isFinite(value)) return "—";
      if (
        opts?.minimumFractionDigits !== undefined ||
        opts?.maximumFractionDigits !== undefined ||
        (opts?.currency && opts.currency !== currency)
      ) {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency: opts?.currency ?? currency,
          minimumFractionDigits: opts?.minimumFractionDigits ?? 2,
          maximumFractionDigits: opts?.maximumFractionDigits ?? 2,
        }).format(value);
      }
      return currencyFmt.format(value);
    },
    [locale, currency, currencyFmt],
  );

  const formatNumber = useCallback(
    (value: number, opts?: Intl.NumberFormatOptions): string => {
      if (!Number.isFinite(value)) return "—";
      if (opts) {
        return new Intl.NumberFormat(locale, opts).format(value);
      }
      return numberFmt.format(value);
    },
    [locale, numberFmt],
  );

  const formatPercent = useCallback(
    (value: number, opts?: Intl.NumberFormatOptions): string => {
      if (!Number.isFinite(value)) return "—";
      if (opts) {
        return new Intl.NumberFormat(locale, {
          style: "percent",
          signDisplay: "exceptZero",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
          ...opts,
        }).format(value);
      }
      return percentFmt.format(value);
    },
    [locale, percentFmt],
  );

  const formatCompact = useCallback(
    (value: number): string => {
      if (!Number.isFinite(value)) return "—";
      return compactCurrencyFmt.format(value);
    },
    [compactCurrencyFmt],
  );

  const value = useMemo<FormatContextValue>(
    () => ({
      locale,
      currency,
      setLocale,
      setCurrency,
      formatCurrency,
      formatNumber,
      formatPercent,
      formatCompact,
    }),
    [
      locale,
      currency,
      setLocale,
      setCurrency,
      formatCurrency,
      formatNumber,
      formatPercent,
      formatCompact,
    ],
  );

  return (
    <FormatContext.Provider value={value}>{children}</FormatContext.Provider>
  );
}

/* ─── Hook ──────────────────────────────────────────────────────── */
export function useFormat(): FormatContextValue {
  const ctx = useContext(FormatContext);
  if (!ctx) {
    throw new Error(
      "useFormat() must be used inside a <FormatProvider>. " +
        "Wrap the popup tree in <FormatProvider> (see App.tsx).",
    );
  }
  return ctx;
}
