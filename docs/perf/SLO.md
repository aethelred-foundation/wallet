# Aethelred Wallet — Performance SLO Catalog

> **Last updated:** 2026-04-19
> **Owner:** Ramesh Tamilselvan — `perf@aethelred.org`
> **Classification:** Internal / Auditor-shared
> **Applies to:** `apps/extension`, `packages/core`, `packages/audit`,
>   `packages/policy`, `packages/observability`
> **Supersedes:** *nothing — first version.*

This catalog enumerates every performance-critical code path in the
Aethelred Wallet, the target we hold it to, how we measure it, and who
is on the hook when a budget is breached. It is the source of truth for
perf policy. Any disagreement between a comment in code, a CI job, or a
dashboard MUST be resolved by updating this document first.

## 1. How to read this document

Each SLO has five attributes:

| Attribute | What it means |
|-----------|---------------|
| **Metric** | Unambiguous name of what we measure. |
| **Target (p95)** | The ceiling we commit to hold. A single blown p95 isn't an incident; a sustained 10-minute window is. |
| **Measurement** | The tool, span, or signal that produces the number. Every metric MUST have a machine-readable source — no "vibes" SLOs. |
| **Owner** | Team that takes the page and drives remediation. One team, never a list. |
| **Regression classifier** | How we tell "normal noise" from "real breakage." Usually a percentage delta vs. a rolling baseline. |

An SLO is "green" when the p95 is at or under target over the last 7
days of measurements. Between green and red is "amber" — over target
but recovering, or over target by a single-digit percentage. Amber is
not pageable but is a tracking item.

## 2. Summary table

| Metric | Target (p95) | Measurement | Owner |
|--------|--------------|-------------|-------|
| Popup cold start | < 800 ms | `performance.now()` via `cold-start.ts` | wallet-extension |
| First meaningful paint | < 1.5 s | Lighthouse FCP | wallet-extension |
| Time to interactive | < 2.5 s | Lighthouse TTI | wallet-extension |
| RPC request (end-to-end) | < 2 s | tracer span `rpc.request` | wallet-extension |
| Signer sign (software) | < 50 ms | tracer span `signer.sign` | wallet-core |
| Audit event record | < 2 ms | tracer span `audit.record` | wallet-trust |
| Merkle finalize batch | < 50 ms | tracer span `audit.merkle.finalize` | wallet-trust |
| Policy evaluate | < 10 ms | tracer span `policy.evaluate` | wallet-policy |
| popup.js (gzip) | < 135 kB | `size-limit` | wallet-extension |
| popup.js (brotli) | < 100 kB | `size-limit` | wallet-extension |
| background.js (gzip) | < 70 kB | `size-limit` | wallet-extension |
| content.js (gzip) | < 5 kB | `size-limit` | wallet-extension |
| inpage.js (gzip) | < 5 kB | `size-limit` | wallet-extension |
| popup.css (gzip) | < 110 kB | `size-limit` | wallet-extension |
| Lighthouse Performance | ≥ 90 | `lhci autorun` | wallet-extension |
| Lighthouse Accessibility | ≥ 95 | `lhci autorun` | wallet-extension |
| Lighthouse Best Practices | ≥ 95 | `lhci autorun` | wallet-extension |
| Total JS served | < 600 kB | Lighthouse resource summary | wallet-extension |
| Total CSS served | < 400 kB | Lighthouse resource summary | wallet-extension |

## 3. Detailed SLOs

### 3.1 Popup cold start

- **Metric.** Time from JavaScript module load (`performance.timeOrigin`)
  to the first interactive render (`requestAnimationFrame` callback
  after React's root mounts).
- **Target.** p95 < 800 ms on a stock 2022+ MacBook Air / Pixel 7 /
  mid-range Windows laptop (reference hardware).
- **Measurement.** The `cold-start.ts` module in
  `apps/extension/src/popup/perf/` records `mountMs`, `firstPaintMs`,
  and `interactiveMs`. When an observability `Logger` is wired, a
  `popup.cold_start` info event is emitted with all three values; this
  is what the SLO dashboard reads.
- **Why 800 ms.** Below 1 s is the "instant" threshold for interactive
  UIs. Browser extensions are held to a higher bar than web pages
  because the popup opens with no loading spinner and the user paid a
  visible click to get there — anything slower than ~800 ms feels
  broken. 800 ms also fits inside one typical 60 Hz frame budget after
  rendering settles (~650 ms of work + ~150 ms of paint + compositor).
- **Regression classifier.** > 10% slower than the trailing 7-day p95
  for two consecutive releases, OR any single release > 1200 ms p95.
- **Owner.** wallet-extension team.
- **Playbook on breach.** See §4.1.

### 3.2 First meaningful paint

- **Metric.** Lighthouse First Contentful Paint (FCP).
- **Target.** < 1.5 s in the Lighthouse desktop preset.
- **Measurement.** `lhci autorun` in CI — 3 runs per PR, median used
  for assertion.
- **Why 1.5 s.** This is the Lighthouse "Good" threshold. The desktop
  preset is appropriate because the popup is never reached from a
  mobile form factor in the current product surface.
- **Owner.** wallet-extension team.

### 3.3 Time to interactive

- **Metric.** Lighthouse Time to Interactive (TTI).
- **Target.** < 2.5 s.
- **Measurement.** Lighthouse CI.
- **Owner.** wallet-extension team.

### 3.4 RPC request end-to-end

- **Metric.** Wall-clock duration of a JSON-RPC round trip, from the
  popup or background handler dispatching the request to the
  background service worker returning the result.
- **Target.** p95 < 2 s.
- **Measurement.** Tracer span `rpc.request` in
  `packages/connect` / `packages/chain`. Attributes include `chainId`,
  `method`, and `upstream`.
- **Owner.** wallet-extension team (owns the client path) / the
  upstream provider SRE for the server side.
- **Caveat.** This is an end-to-end SLO — upstream provider outages
  can breach it independently of our code. The dashboard panels break
  the number out by `upstream` so we can distinguish the two.

### 3.5 Signer sign (software)

- **Metric.** Wall-clock duration of `Signer.sign{Message,Transaction}`
  on the `LocalCustodyBackend` path (NOT hardware — hardware signs have
  user-in-the-loop latency we don't control).
- **Target.** p95 < 50 ms.
- **Measurement.** Tracer span `signer.sign`. The crypto primitives
  are also covered by `packages/core/bench/signer.bench.ts` for
  primitive-level throughput.
- **Owner.** wallet-core team.
- **Regression classifier.** > 20% slower than trailing 7-day p95, OR
  any single release's bench throughput < 150 signs/sec.

### 3.6 Audit event record

- **Metric.** Wall-clock duration of a single `AuditCapture.record`
  call.
- **Target.** p95 < 2 ms.
- **Measurement.** Tracer span `audit.record`, plus the
  `AuditCapture.record` benchmark in `packages/audit/bench/`.
- **Owner.** wallet-trust team.

### 3.7 Merkle batch finalize

- **Metric.** Wall-clock duration of `MerkleBatch.finalize()` for a
  full 256-event batch.
- **Target.** p95 < 50 ms.
- **Measurement.** Tracer span `audit.merkle.finalize`, plus the
  "MerkleBatch build for 256 events" bench.
- **Owner.** wallet-trust team.

### 3.8 Policy evaluate

- **Metric.** Wall-clock duration of `evaluate(context, bundle)` on
  the 20-rule personal policy bundle.
- **Target.** p95 < 10 ms.
- **Measurement.** Tracer span `policy.evaluate`, plus
  `packages/policy/bench/engine.bench.ts`.
- **Owner.** wallet-policy team.

### 3.9 Bundle size budgets

All limits are enforced by `size-limit`. The config is in
`apps/extension/size-limit.config.js`; numbers are chosen to be
~10% above the current build so small organic growth doesn't page on
call, but runaway growth fails CI.

| File | Limit | Compression | Owner |
|------|-------|-------------|-------|
| `popup.js` | 135 kB | gzip | wallet-extension |
| `popup.js` | 100 kB | brotli | wallet-extension |
| `background.js` | 70 kB | gzip | wallet-extension |
| `content.js` | 5 kB | gzip | wallet-extension |
| `inpage.js` | 5 kB | gzip | wallet-extension |
| `assets/popup.css` | 110 kB | gzip | wallet-extension |

See `docs/perf/BUDGETS.md` for budget-management process.

### 3.10 Lighthouse categories

| Category | Minimum score |
|----------|---------------|
| Performance | 90 |
| Accessibility | 95 |
| Best Practices | 95 |
| SEO | warn only |
| PWA | disabled |

PWA is disabled because the wallet is a Chrome extension, not a PWA.
SEO is kept at warn-only because the popup is served from a
`chrome-extension://` URL in production; robot crawlability is not
meaningful. We still track the score as an early-warning for
dev-experience issues (missing `<title>`, missing meta tags, etc.).

### 3.11 Resource budgets

| Resource | Limit |
|----------|-------|
| Total JS served | 600 kB |
| Total CSS served | 400 kB |

These are Lighthouse resource-summary budgets — they apply to the sum
of JS and CSS loaded during the popup's initial render, including
lazy chunks that happen to fire immediately. An infra-level regression
(e.g. accidentally importing a heavy graphing library into the
dashboard) will surface here even if no single bundle file exceeds
its individual limit.

## 4. Playbooks

### 4.1 Popup cold start regression

**Symptom:** `popup.cold_start` p95 drifts above target, or
Lighthouse CI fails on FCP / TBT.

1. Reproduce locally: `npm run build:extension && npm run lighthouse`.
2. Run the bundle analyzer: `npm run bundle:analyze`. Identify any
   new large imports in `popup.js` — React state libs, icon packs,
   date utilities, localization bundles are common culprits.
3. Check the `cold-start.ts` output on a real popup open (side-load
   the built extension). Read the `mountMs` / `firstPaintMs` /
   `interactiveMs` triple — the gap between `mountMs` and
   `interactiveMs` indicates hydration cost; a gap between
   `initColdStartTimer` and `mountMs` indicates import-time cost.
4. Fix candidates, in order of preference:
   - Convert a top-level import to a lazy import
     (`React.lazy` + `Suspense`).
   - Move a synchronous storage read behind a first-render no-op.
   - Defer a non-critical effect (analytics, telemetry) past the
     first paint.
5. Rebuild, re-run `npm run lighthouse`, re-measure cold start.
   Confirm the fix sticks BEFORE merging.

### 4.2 Bundle size budget breach

See `docs/perf/BUDGETS.md` §5.

### 4.3 Crypto / audit / policy bench regression

See `docs/perf/BENCHMARKING.md` §4.

### 4.4 Lighthouse Performance regression

**Symptom:** Lighthouse Performance drops below 90 on CI.

1. Download the Lighthouse report artifact from the failed CI run.
2. Identify the failing audit (usually one of: render-blocking
   resources, unused JavaScript, overly-large network payloads,
   main-thread work).
3. Apply the relevant fix:
   - Render-blocking CSS: inline critical CSS or defer non-critical
     stylesheets.
   - Unused JS: treeshake the offending import, split the chunk.
   - Main-thread work: profile with Chrome DevTools, identify the
     longest task, break it up with `requestIdleCallback`.
4. Re-run `npm run lighthouse` locally until green.

## 5. Change process

- **Adding an SLO.** Open a PR that modifies this file, the relevant
  measurement harness, and the dashboard. PR description must state
  the target, why that number, and who the owner is.
- **Loosening an SLO.** Same process as adding one; additionally
  include a short post-mortem paragraph on why the old number is no
  longer right.
- **Tightening an SLO.** No post-mortem required, but the PR should
  include 30 days of measurement data showing the new target is
  achievable.

All SLO changes merge via standard review. No solo-approval. No
after-hours merges for SLO loosening without security approval.
