# Code-Health Gates

Machine-checked invariants that stop the monorepo from rotting under
its own weight. Enterprise codebases degenerate predictably — dead
code accumulates, dependency graphs grow cycles, bundle size creeps,
and direct dependencies drift years behind upstream. This document
covers the gates that prevent each of those from happening silently
in Aethelred Wallet.

## Gates at a glance

| Gate                             | Script                                 | CI job                | Blocks merge? |
|----------------------------------|----------------------------------------|-----------------------|---------------|
| Dead exports                     | `npm run lint:dead-code`               | `dead-exports`        | Yes           |
| File-level circular deps         | `npm run lint:circular`                | `circular-deps`       | Yes           |
| Workspace-level circular deps    | `npm run lint:circular:workspaces`     | `circular-deps`       | Yes           |
| Per-package bundle weight        | `npm run lint:bundle-weight`           | `bundle-weight`       | No (warning)  |
| Dependency freshness             | `npm run lint:dep-freshness`           | `dep-freshness` cron  | No (weekly)   |

All CI jobs live in `.github/workflows/code-health.yml`. The two
hard-gate jobs roll up into a `code-health-ok` aggregation that
branch protection should require.

## Baseline metrics (captured 2026-04-20)

| Metric                                          | Value                 |
|-------------------------------------------------|-----------------------|
| Dead-export baseline entries                    | 864                   |
| File-level circular deps (extension + packages) | 0 (after R7 fix)      |
| Workspace-level circular deps                   | 0                     |
| Workspace packages in dep graph                 | 17                    |
| Heaviest internal package in extension bundle   | `@aethelred/wallet-connect` (289 KB, 5.0%) |
| Heaviest third-party package                    | `lucide-react` (2.2 MB, 37.9%) |
| Direct deps at latest major                     | 18 / 49               |
| Direct deps > 1 major behind                    | 9 / 49                |

## 1. Dead-export gate

### What it catches

Any `export` that no source file imports. Surfaces:

- Accidental leftovers after a refactor (a function got extracted,
  renamed, and the old one kept exported).
- Deleted consumers: when the last call site is removed, the export
  becomes "dead" even though the module still ships bytes.
- Accidentally-public API: test helpers that were meant to stay
  internal but ended up in a barrel file.

### Implementation

`ts-unused-exports` reads the project's TypeScript graph and reports
every exported identifier with zero inbound import edges. We run it
against **`tsconfig.deadcode.json`** — a dedicated scan config that
deliberately includes test sources (so `*ForTests` helpers have visible
consumers) and aggregates every package under `packages/*/src`.

### Why a baseline, not strict zero?

Strict zero would force us to delete legitimate library-API surface —
`CardProps`, `UseLiveBalancesResult`, every barrel re-export from
`micro/index.ts`, every `*ForTests` helper consumed by integration
tests via dynamic mocking. Those aren't dead, just not imported from
the narrow call graph that a static analyzer can walk.

Instead, `reports/dead-exports.baseline.json` records the current set.
The gate fails if **new** unused exports appear that aren't in the
baseline, OR if a baseline entry is no longer unused (encouraging the
baseline to shrink monotonically as real consumers are added).

### Getting an exception approved

A new baseline entry requires:

1. A `rationale` category in `dead-exports.baseline.json` under which
   the entry falls (e.g. `component-prop-types`, `test-helpers`).
2. A second reviewer on the PR that touches the baseline file.
3. A comment on the PR linking to the planned consumer (future
   feature ticket, SDK consumer, tests migration).

The existing rationale categories are:

- `component-prop-types` — Library prop types / variants / options.
- `test-helpers` — Functions named `*ForTests` / `__*ForTests` used
  via `vi.mock()` indirection.
- `barrel-reexports` — Curated module barrels (`micro/index.ts`,
  `background/stages/index.ts`).
- `release-mode-flags` — `IS_DEVELOPMENT_BUILD` / `IS_NON_PRODUCTION_BUILD`
  referenced only via `vi.mock()` string keys.
- `telemetry-plumbing` — Cold-start + SLO types consumed by downstream
  observability collectors.
- `motion-design-tokens` — Whole motion design system in
  `popup/design/motion.ts`.
- `vite-config-default` — Vite's consumed default export.
- `package-public-api` — Exports in `packages/*/src/index.ts` intended
  for external SDK consumers even if not yet imported by the extension.

### Diagnosing a red CI run

```
Dead-export regression - new unused exports detected:

  + apps/extension/src/foo.ts: unusedFunction
```

Actions, in order of preference:

1. **Delete the export** if it's truly dead. Preferred.
2. **Connect a consumer**. If you added it ahead of the call site,
   land the call site in the same PR.
3. **Add it to the baseline** with a new rationale category. Requires
   review — see above.

To rewrite the baseline after a bulk cleanup:

```
npm run lint:dead-code:update
```

Review the diff and commit.

### Stale baseline

A "stale" finding means an entry in the baseline is no longer
reported as unused — typically because a consumer was added or the
export was removed. The gate fails so you're forced to keep the
baseline minimal. Fix: `npm run lint:dead-code:update` + commit.

## 2. Circular-dependency gate

Two sub-checks:

### File-level (madge)

`madge --circular --warning` walks the TypeScript module graph and
reports any cycle where `a.ts -> b.ts -> a.ts`. Cycles at this level
are rare but dangerous: ESM guarantees evaluation order, but a cycle
can leave a module observing a partially-initialized dependency
(imports read as `undefined`, class field defaults throw).

Example we caught and fixed on day 1:

```
packages/observability/src/logger.ts -> packages/observability/src/never.ts
```

`logger.ts` imported `assertNever` from `never.ts` (runtime). `never.ts`
imported the `Logger` class type from `logger.ts` (type-only). TypeScript
handled the type edge via erasure, but the runtime cycle remained in
the module graph. Fix: declare a minimal structural `WarnableLogger`
interface in `never.ts` and remove the import.

### Workspace-level (`check-workspace-deps.mjs`)

Package-level cycles are even worse — they mean `@aethelred/wallet-chain`
declares a runtime dependency on `@aethelred/wallet-compliance` which
declares a dependency back on `@aethelred/wallet-chain`. At build time
both packages typecheck independently and module resolution succeeds;
at runtime the load order is unpredictable.

The script reads every `packages/*/package.json` and `apps/*/package.json`,
builds the directed graph of internal `@aethelred/*` edges, and runs
DFS. Any back edge fails CI. Output is a Mermaid diagram for humans
plus a stable JSON artifact for downstream tooling.

### Diagnosing

```
Cycle 1:
  @aethelred/wallet-chain -> @aethelred/wallet-compliance -> @aethelred/wallet-chain
```

Fix: remove one of the edges. Long-term guidance — "kernel" packages
(`core`, `connect`, `observability`) should be **leaves** of the graph.
Feature packages (`compliance`, `approval`, `simulation`) are always
**parents**. A package that sits in the middle depending on other
feature packages is fine; depending on `extension` is never fine.

## 3. Per-package bundle weight (warning-only)

The absolute gate on bundle size already lives in size-limit +
`bundle-regression` CI. This gate answers a different question:
"**why** did the bundle grow?"

`scripts/report-bundle-weight.mjs` uses esbuild with `metafile: true`
to walk every extension entry point and attribute each source byte
to its originating package (`packages/*`, `node_modules/*`, or
`apps/extension/src/*`). Output: sorted table + JSON, diffed against
`reports/bundle-weight.baseline.json`.

Thresholds:

- `--warn`: prints warnings but exits 0 (CI default).
- `--update-baseline`: writes the current report over the baseline
  (after intentional change).
- Default: fails if any package grew > 10% vs. baseline.

The warning is intentionally non-blocking because:

- Third-party deps bumping normally grow by small percentages.
- A 10 % growth on a small package (5 KB -> 6 KB) is meaningless
  noise; size-limit already catches the absolute size consequence.
- Blocking would create churn every time someone pulled a minor
  `react-dom` bump.

Use this report to **investigate** a size-limit failure — look at
the JSON to find which package contributed the most bytes.

## 4. Dependency freshness (weekly cron)

`scripts/report-dep-freshness.mjs` queries the npm registry for the
latest `dist-tag` of every direct dependency across all workspace
package.jsons. Computes major-version drift. Emits
`reports/dep-freshness.json`.

Complements Dependabot: Dependabot is precise (one PR per stale dep)
but noisy at scale. This report is a single weekly summary — useful
for the security / platform team to prioritize which bumps actually
matter.

The scheduled CI job (`code-health.yml` → `dep-freshness`) runs
weekly on Monday 09:00 UTC. It uploads the JSON as an artifact and
can be extended to open a GitHub issue when drift exceeds 1 major
version on any dep.

## Local pre-commit

`.husky/pre-commit` runs only the cheap checks:

- `lint:circular:workspaces` (~100 ms; just reads manifests)
- `madge --circular` scoped to directories of staged files

Everything else — full dead-export scan, unit tests, build, bundle
weight — runs in CI. The rule: any pre-commit check that exceeds
~3 seconds is cut. Developers will disable hooks they perceive as
slow, and disabled hooks are worse than no hooks.

To skip hooks intentionally (rebase, mechanical edit):

```
git commit --no-verify
```

Use sparingly.

## Why no ESLint?

We considered adding `eslint-plugin-import` with `no-cycle`,
`no-internal-modules`, and `no-extraneous-dependencies`. The
evaluation:

- `no-cycle` duplicates what madge + workspace-deps already catch,
  but is slower (parses JS/TS instead of reading tsconfig).
- `no-internal-modules` is useful but requires tagging every allowed
  barrel path and would need constant maintenance.
- `no-extraneous-dependencies` is already enforced by TypeScript's
  module resolution; the build fails on missing deps.

ESLint itself adds ~400 packages, a plugin config surface, and a
per-file parse cost. In a monorepo where every gate runs in CI we
already have better-scoped tools for each check. If a future bug
surfaces that only ESLint could catch, we'll revisit. Today we don't
have that failure mode.

## Runbook: "all the gates red"

Sequence to unblock:

1. `npm ci --ignore-scripts` — ensure deps match the lockfile.
2. `npm run type-check` — typecheck must pass; a broken type graph
   makes every other signal meaningless.
3. `npm run lint:circular` — madge is the fastest gate and surfaces
   the simplest class of problem.
4. `npm run lint:circular:workspaces` — workspace graph.
5. `npm run lint:dead-code` — slowest of the hard gates; leave until
   the fast ones are green.
6. `npm run lint:bundle-weight` — investigation tool; only after a
   size-limit failure.

After everything is green locally, `git push` — CI should match.
