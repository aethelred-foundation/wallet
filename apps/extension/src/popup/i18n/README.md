# i18n scaffolding

Lightweight translation layer for the popup UI, built on
[`react-i18next`](https://react.i18next.com/latest/using-with-hooks).

## Where translations live

- `locales/en.json` — source of truth, English strings
- `locales/es.json` — Spanish proof-of-concept
- `i18n.ts` — initializes `i18next`, reads `localStorage.getItem("aethelred-language")`
- `i18n-provider.tsx` — `<TranslationProvider>` wrapping the app

Each locale file is split into namespaces (`common`, `nav`, `home`).
`common` holds strings reused across many views; `nav` holds the five
bottom-nav labels; `home` holds strings specific to the home view.

## Adding a new language

1. Create `locales/<code>.json` matching the shape of `en.json`.
2. Import it in `i18n.ts` and add it to the `resources` object.
3. Users can switch to it by setting `localStorage.setItem("aethelred-language", "<code>")` and reloading.

Any key missing from a non-English locale automatically falls back to `en`.

## Using translations in a view

```tsx
import { useTranslation } from "react-i18next";

function Example() {
  const { t } = useTranslation("nav");
  return <span>{t("home")}</span>;
}
```

Pass the namespace name to `useTranslation`, then call `t("keyName")`.
For nested namespaces, use `useTranslation(["common", "home"])` and
prefix keys: `t("common:send")`.

## Currency & number formatting (`format.tsx`)

Single source of truth for every `$1,234.56` in the popup. Uses native
`Intl.NumberFormat` — no `@formatjs/intl` polyfill needed because this is a
Chrome extension and Chromium ships ECMA-402 (0 bytes to the bundle).

### Using `useFormat()` in a view

```tsx
import { useFormat } from "../i18n/format";

function BalanceCard({ value, delta }: { value: number; delta: number }) {
  const { formatCurrency, formatPercent, formatCompact } = useFormat();
  return (
    <div>
      <strong>{formatCurrency(value)}</strong>
      <span>{formatPercent(delta)}</span>
      <small>{formatCompact(value)}</small>
    </div>
  );
}
```

`formatPercent` uses `signDisplay: "exceptZero"` so +/- is shown.
`formatCurrency(value, { maximumFractionDigits: 4 })` overrides precision.

### Adding a new supported currency

Append to `CURRENCIES` in `src/popup/views/settings.tsx`. The `code` is passed
verbatim to `Intl.NumberFormat({ style: "currency", currency })`, so any valid
ISO-4217 code works — no wiring in the provider required.
