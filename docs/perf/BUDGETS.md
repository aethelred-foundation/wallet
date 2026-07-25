# Aethelred Wallet — Performance Budgets Playbook

> **Last updated:** 2026-07-25
> **Owner:** Ramesh Tamilselvan — `perf@aethelred.org`
> **Applies to:** Chrome extension bundles, extension popup perf,
>   audit / signer / policy primitives.

This document explains **how the wallet's performance budgets are set,
how to add new ones, and how to investigate failures.** It is the
companion to `SLO.md` (which enumerates the numbers) and
`BENCHMARKING.md` (which covers the throughput benches).

## 1. What counts as a budget

A performance budget is a **hard ceiling** enforced in CI. Unlike an
SLO — which is a statistical statement about production behavior
(p95 over 7 days) — a budget is a single deterministic number the
build must satisfy, or the build fails.

The wallet has three kinds of budgets:

1. **Bundle-size budgets** — per-file gzip / brotli size of every
   shipping JS/CSS artifact. Enforced by `size-limit`.
2. **Lighthouse budgets** — page-level metrics (FCP, TBT, CLS) and
   resource-summary totals. Enforced by `@lhci/cli`.
3. **Benchmark targets** — primitive-level throughput on critical
   crypto/audit/policy paths. Enforced by `vitest bench` (after
   enough baseline data; stub today).

## 2. Bundle-size budgets

### 2.1 Where they live

- Config: `apps/extension/.size-limit.cjs`
- CI gate: `.github/workflows/perf.yml` → `size` job
- Dev script: `npm run size` (pass/fail), `npm run size:why`
  (per-dep breakdown)

### 2.2 How the numbers are chosen

Each limit is set ~10% above the measured production build at the
moment the budget was introduced. The 10% headroom absorbs organic
growth (new dApp cards, new i18n strings, a new icon) without
paging. Runaway growth — a new React state lib, a 200 kB crypto
polyfill, a CSS-in-JS engine — fails CI immediately because those
deltas are >10%.

The numbers are NOT derived from user-facing performance budgets
(those live in Lighthouse CI). They are engineering hygiene checks:
"we haven't accidentally doubled the popup bundle." Users pay for
time-to-interactive, which depends on compiled JS size, network,
parse time, and main-thread work — byte count alone doesn't predict
TTI. That's what §3 (Lighthouse) is for.

### 2.3 Adding a new bundle

When a new entry point is added to `vite.config.ts`:

1. Run `npm run build:extension` and note the output size.
2. Add a new entry to `.size-limit.cjs` with `limit` set to
   `ceil(current * 1.1, 1kB)`.
3. Add a row to `docs/perf/SLO.md` §3.9.
4. In your PR description, state the current size and the chosen
   limit with a one-line rationale ("new background messenger chunk,
   currently 22 kB, budget 25 kB to leave room for session-ID
   additions").

The drift-detector test (`apps/extension/src/test/perf/budgets.test.ts`)
will fail any new `dist/*.js` file that doesn't have a matching
budget, so forgetting step 2 is a hard CI error.

## 3. Lighthouse budgets

### 3.1 Where they live

- Config: `.lighthouserc.json`
- CI gate: `.github/workflows/perf.yml` → `lighthouse` job
- Dev script: `npm run lighthouse`

### 3.2 How the numbers are chosen

Page-level metrics target the Google "Good" thresholds:

| Metric | Threshold | Why |
|--------|-----------|-----|
| First Contentful Paint | 1.5 s | Google "Good" threshold. |
| Speed Index | 2.0 s | Google "Good" threshold. |
| Total Blocking Time | 300 ms | Google "Good" threshold; any longer and users perceive lag. |
| Cumulative Layout Shift | 0.1 | Google "Good" threshold; prevents "thumb-pain" from shifting tap targets. |
| Performance score | 90 | Leaves 10% margin for noise on shared runners. |
| Accessibility score | 95 | Near-perfect; accessibility regressions are almost always fixable. |

Resource-summary totals are set from the current-build measurement
plus ~30% headroom — big enough to avoid flakiness, small enough to
catch a 400 kB dep-drop accident.

### 3.3 Adding a new Lighthouse budget

Add the rule to `.lighthouserc.json` under `assert.assertions`. Use
the Lighthouse audit ID (e.g. `largest-contentful-paint`, not a
human name). The `["error" | "warn", { ... }]` two-tuple controls
whether it blocks merge (`error`) or is advisory (`warn`).

## 4. Benchmark budgets

### 4.1 Where they live

- Benches: `packages/*/bench/*.bench.ts`
- Runner config: `vitest.bench.config.mts`
- CI: `.github/workflows/perf.yml` → `bench` job (main-only)
- Dev script: `npm run bench`

### 4.2 How the numbers are chosen

Each `bench()` call in a bench file has a target in its label
(`target ≥ 500 ops/s`) and a fail threshold in its doc comment
(usually target / 3, to absorb CI runner noise). See
`BENCHMARKING.md` §2 for the full rule.

The fail threshold is not yet wired into CI — the first week of
data populates `bench-history.jsonl`, and
`check-bench-regression.mjs` will start comparing to a trailing
7-day p50 once that history exists.

## 5. Playbook: what to do when a budget fails

### 5.1 `size-limit` failure

```
  popup.js (gzip)
  Size limit: 135 kB
  Size:       148 kB (+9.6%)
  FAIL
```

1. Run `npm run size:why` — this prints per-dep cost. Look for new
   entries at the top.
2. Run `npm run bundle:analyze` — this builds with the rollup
   visualizer plugin and emits a treemap at
   `apps/extension/dist/bundle-report.html`. Open it in a browser.
3. Identify the cause:
   - **New dep pulled transitively:** move it to a lazy import
     or a separate entry chunk.
   - **Intentional feature work:** bump the budget in
     `size-limit.config.js`, update `docs/perf/SLO.md`, and call out
     the new number in the PR description. Budget loosenings are
     review gates, not rubber stamps.
   - **Accidental barrel export:** check for a `import * as ...` at
     the top of a package; replace with named imports.
4. Re-run `npm run size` until green.

### 5.2 Lighthouse regression

Follow `docs/perf/SLO.md` §4.4.

### 5.3 Benchmark regression

Follow `docs/perf/BENCHMARKING.md` §4.

## 6. Ownership and escalation

| Budget | Owner | Escalation |
|--------|-------|------------|
| Bundle sizes (popup / background / content / inpage / CSS) | wallet-extension | Tech lead, then CTO. |
| Lighthouse categories + web-vitals | wallet-extension | Tech lead. |
| Crypto benches | wallet-core | Security lead (crypto primitives are under threat-model scope). |
| Audit benches | wallet-trust | Compliance lead (audit is under SOC2 scope). |
| Policy benches | wallet-policy | Product security lead. |

No solo-approval on budget loosenings. The second reviewer must
explicitly sign off on the new limit AND the rationale.

## 7. Change log

- **2026-07-25:** Rebaselined the production MV3 background after the
  production-readiness work made persisted lifecycle recovery, WebAuthn
  registration verification, durable recipients, EIP-1559 approval
  validation, and first-party transaction decoding mandatory background
  responsibilities. The reviewed build is 265.3 kB raw / 76.4 kB gzip
  (75.39 kB under `size-limit` measurement); the absolute ceiling is now
  84 kB gzip, preserving approximately 10% headroom. Bundle analysis found
  no accidental UI framework or duplicate runtime in the service worker.
- **2026-04-19:** Initial budgets published alongside the
  perf-instrumentation rollout. Baselines captured at commit
  `9f545322fe` were `popup.js` 489 kB raw / 124 kB gzip,
  `background.js` 179 kB / 61 kB gzip. Budgets set ~10% above
  baseline. Lighthouse CI configured for the desktop preset with
  Performance ≥ 90 / Accessibility ≥ 95 / Best Practices ≥ 95.
