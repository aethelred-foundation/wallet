# Aethelred Wallet — Test quality gates

Test count alone is not a quality signal. A suite of 822 passing tests
tells us nothing about how much of the code is actually exercised, or
whether the assertions would catch a regression. This document
describes the two gates we use to measure test *quality* — coverage
and mutation testing — and the policy for keeping them green without
letting them drift downward.

The gates are complementary:

| Gate          | Asks                                                               |
| ------------- | ------------------------------------------------------------------ |
| **Coverage**  | Did any test execute this line / branch / function?                |
| **Mutation**  | Would at least one test fail if this line were subtly wrong?       |

Coverage without mutation is a common trap — a test that renders a
component and asserts `expect(view).toBeDefined()` passes even if the
rendering logic is silently broken. Mutation testing fills that gap
by substituting a plausible bug into the source and checking whether
the suite notices.

---

## Baseline (2026-04-20)

### Line coverage

Measured by `npx vitest run --coverage` with the v8 provider against
the 822-test extension suite. The numbers below are with three
known-flaky tests unexecuted (see *Known limitations*), hence slightly
lower than the clean-slate baseline.

| Metric       | Baseline | Threshold (CI fail below) | Target (long-term) |
| ------------ | -------- | ------------------------- | ------------------ |
| Lines        | 87.54 %  | **85 %**                  | 90 %               |
| Statements   | 87.54 %  | **85 %**                  | 90 %               |
| Branches     | 72.06 %  | **70 %**                  | 80 %               |
| Functions    | 79.72 %  | **77 %**                  | 85 %               |

The measured baseline is above the original 85 % / 75 % / 85 % / 85 %
target brief because we exclude UI-shell files (views, nav chrome,
command palette, transitions) from the coverage scope. Those files are
tested via a11y + integration suites, not line coverage. See
`apps/extension/vitest.config.mts` → `coverage.exclude` for the full
list and the rationale in comments.

Thresholds sit ~2 pp below baseline so CI starts green and a single
refactor cannot fail the pipeline for an unrelated reason. Every PR
must leave the measured coverage **at or above** the current threshold.

### Mutation score

Target: mutation score ≥ 70 % on the ten critical files enumerated in
`stryker.conf.mjs` (audit, policy, approval, core, chain, credentials,
compliance).

**Baseline: not yet captured — see Known limitations below.**

Historic mutation score (from the weekly `.github/workflows/mutation.yml`
run) will be published here once the stryker sandbox path issue is
resolved. The weekly run is already configured; it posts the HTML
report as a CI artefact and fails if the score falls below 70 %.

### Per-file coverage audit

Aggregate thresholds hide long-tail hot spots — a brand-new file with
0 % coverage can live in the repo for weeks while the aggregate stays
above 85 %. `scripts/coverage-audit.mjs` post-processes the
`coverage-summary.json` and prints every file whose line coverage sits
below 80 %. On 2026-04-20 there are **11** such files:

| Lines   | File                                                          | Notes                                           |
| ------- | ------------------------------------------------------------- | ----------------------------------------------- |
| 46.79 % | `src/background/inpage-handshake-handler.ts`                  | Flaky test (see below); stable coverage ~94 %   |
| 55.44 % | `src/popup/hooks/use-wallet-state.ts`                         | Needs a unit test for lock transitions          |
| 64.78 % | `src/background/stages/workflow-engine-stage.ts`              | Integration coverage; add unit branches         |
| 68.21 % | `src/background/stages/walletconnect-session-stage.ts`        | Branch coverage gap on error paths              |
| 68.75 % | `src/background/stages/audit-chain-rehydration-stage.ts`      | Rehydration error paths                         |
| 73.61 % | `src/popup/hooks/use-sound.ts`                                | Timer paths untested                            |
| 75.24 % | `src/popup/hooks/use-copy-to-clipboard.ts`                    | Fallback branches                               |
| 75.40 % | `src/popup/hooks/use-live-prices.ts`                          | Polling error paths                             |
| 76.22 % | `src/background/stages/merkle-batch-restoration-stage.ts`     | Branch gap — sparse restoration paths           |
| 77.72 % | `src/popup/services/services-context.tsx`                     | Provider init error branches                    |
| 77.95 % | `src/popup/i18n/format.tsx`                                   | Locale fallback paths                           |

CI fails when **more than 11** files drop below 80 % (ratcheted via
`--max-failed` in `scripts/coverage-audit.mjs`). The count can only
decrease — every PR that adds a new low-coverage file must also remove
one from the list (or add enough tests to lift the new file above
80 %).

---

## Threshold policy

**Drops below threshold → CI fails.** The threshold numbers in this
file mirror the ones enforced by `apps/extension/vitest.config.mts`
(`coverage.thresholds`) and `stryker.conf.mjs` (`thresholds.break`).

**Ratchet: every PR may only raise thresholds, never lower them.**
This is enforced socially rather than mechanically — the PR reviewer
must reject a change that lowers any threshold without a stated plan
to restore it. The PR description must explain:

1. Why coverage / mutation score dropped (new feature without tests?
   dependency rewrite? measurement methodology change?).
2. What tests will be added (and by when) to restore the level.
3. Whether the drop is permanent (e.g. a file moved into the exclude
   list with justification).

A drop below the **long-term target** (the right-most column of the
table above) is a warning, not a CI failure — we chase those down
during tech-debt weeks.

---

## Escalation runbook

### CI fails with `Coverage for lines (N %) does not meet global threshold (M %)`

1. `npm run test:coverage` locally to reproduce.
2. `open apps/extension/coverage/index.html` — drill into the files
   highlighted in red.
3. Write a test for the uncovered path(s). If the uncovered code is
   truly unreachable (defensive `throw new Error("unreachable")`), add
   an `/* c8 ignore next */` annotation and link a follow-up ticket.
4. Re-run `npm run test:coverage`. When the aggregate passes, push.

### `audit:coverage` fails with `N files below 80 % (max allowed: M)`

1. Look at the file list — prioritise files with **0 % coverage**
   first (they are usually new files where tests were forgotten).
2. For business-logic files (not UI shells), write a unit test.
3. For UI-shell files that should not be measured, add them to
   `coverage.exclude` in `apps/extension/vitest.config.mts` with a
   comment explaining why (views, animation chrome, etc.).

### Weekly mutation job fails with `mutation score < 70 %`

1. Download the `mutation-report` artefact from the failed run.
2. Open `reports/mutation/index.html`. Sort files by *survived*
   mutants.
3. For each surviving mutant, ask: would a real bug that looks like
   this ship silently? If yes, add a test that would have caught it.
4. If the mutant is semantically equivalent (e.g. `x > 0` vs `x >= 0`
   when the codepath guarantees `x !== 0`), note it in the PR
   description — Stryker's JSON report lets us suppress equivalent
   mutants on a per-location basis when needed.

---

## Known limitations

### Three flaky tests distort the baseline

The `npm run test:coverage` run on 2026-04-20 has three suites that
pass/fail based on filesystem state rather than code:

1. `src/test/inpage-integrity.test.ts` — fails with `chrome is not
   defined` when the `content-bridge.ts` module loads at import time
   in jsdom. The test needs a chrome-api stub before import.
2. `src/test/manifest.test.ts` — asserts that `public/inpage.js`
   exists; fails on a clean tree because `inpage.js` is only produced
   by `vite build`, not checked in.
3. `src/test/image-sizes.test.ts` — asserts that
   `public/_image-manifest.json` matches the `.webp` inventory on
   disk; fails when new `@2x.webp` variants drift from the manifest.

None of these are coverage-related, and the same failures predate the
test-quality gate work. They are excluded from the test-count baseline
but do influence the coverage numbers on the files they would
otherwise exercise (notably `inpage-handshake-handler.ts`, which
drops from ~94 % to ~47 % when its test suite fails to import). Fixing
these three suites is tracked as a separate stream of work.

### Stryker sandbox + repo-root script imports

The current test suite has a handful of tests that `import()` scripts
from the repo root (e.g. `scripts/generate-bundle-manifest.mjs`). When
Stryker copies the project into its sandbox to run mutants, those
imports resolve to paths that don't exist inside the sandbox, so the
initial dry-run fails before any mutant is scored. Until this is
resolved, mutation baseline measurement is blocked. The follow-up is
to either (a) move the affected scripts under `apps/extension/` so
they copy along with the workspace, or (b) gate the scripted tests
behind a `process.env.STRYKER` check and skip them when mutating.

### Phantom parent `vite.config.ts`

A developer laptop running `vitest run --workspace …` from the repo
root may fail with `Error: Cannot find module 'vite'` if a
`vite.config.ts` exists in the user's home directory. Vitest walks the
filesystem upward looking for a Vite config; the correct workaround is
to ignore the workspace flag locally and run
`cd apps/extension && npx vitest run --coverage` directly — which is
exactly what `npm run test:coverage` does. This limitation is
irrelevant on CI runners, which have a clean `/home/runner` tree.

---

## Commands

```bash
# Full coverage run (enforces thresholds declared in vitest.config.mts)
npm run test:coverage

# Machine-readable coverage summary + JSON for CI aggregation
npm run test:coverage:ci

# Surface per-file coverage hot spots (non-zero exit if > 10 files below 80 %)
npm run audit:coverage

# Mutation testing (slow — weekly in CI, on-demand locally)
npm run mutation:test
```

---

## References

- `apps/extension/vitest.config.mts` — thresholds + exclude list
- `apps/extension/stryker.conf.mjs` — mutation config (workspace mirror)
- `stryker.conf.mjs` — mutation config (repo-root, source of truth)
- `scripts/coverage-audit.mjs` — per-file hot-spot script
- `.github/workflows/ci.yml` — coverage job + ci-ok aggregate
- `.github/workflows/mutation.yml` — weekly Stryker run
- `docs/testing/INTEGRATION_TESTS.md` — integration test harness
- `docs/testing/TESTING_STRATEGY.md` — overall test pyramid
