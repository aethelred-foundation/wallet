# Bundle budgets and regression gate

**Owner:** wallet-extension team.
**Status:** Active. Enforced on every PR via `.github/workflows/bundle.yml`.
**Last reviewed:** 2026-04-20.

## 1. Why we enforce bundle budgets

The Aethelred Wallet is a Chrome MV3 extension. Every byte we ship lives
in the user's extension install package and loads on every popup open.
Three forces push bundle sizes up:

1. **Transitive dependency drift.** A `npm update` on `lucide-react`
   adds 40 KB of icon mappings. Left unchecked, an "innocent" patch
   bump is a 5 % regression.
2. **Feature sprawl.** New dApp integrations add simulation rules,
   approval UI, and chain-specific RPC clients.
3. **Accidental static imports.** A developer writes
   `import { SomeBigComponent } from "./views/approvals"` from the
   popup shell, collapsing the lazy-loaded chunk into `popup.js`.

All three are invisible on a green `npm run build` and silent on
`size-limit` alone. The bundle regression gate described here catches
them by comparing the **current** build against a **committed baseline**
at `reports/bundle-baseline.json`.

## 2. What the gate actually checks

On every PR the `bundle-regression` job does the following:

1. `npm run build --workspace @aethelred/wallet-extension` — produces
   `apps/extension/dist/`.
2. `npm run bundle:manifest` — walks `dist/`, measures raw / gzip /
   brotli for every `.js` and `.css` file, writes a deterministic
   `_bundle-manifest.json`.
3. `npm run bundle:compare` — compares the manifest to
   `reports/bundle-baseline.json` and fails if:
   - **Per-chunk threshold (10 %):** any single chunk's gzip size
     grew by more than 10 % vs the baseline.
   - **Aggregate threshold (5 %):** the sum of gzip bytes across all
     tracked chunks grew by more than 5 %.
4. `npm run bundle:comment` — on pull requests, posts (or updates)
   a sticky comment on the PR with the per-chunk delta table.

Exit codes from `bundle:compare`:

| Code | Meaning                                                             |
| ---- | ------------------------------------------------------------------- |
| 0    | No regressions.                                                     |
| 1    | At least one chunk exceeded the per-chunk threshold.                |
| 2    | Aggregate gzip total exceeded the aggregate threshold (but no       |
|      | individual chunk did — the slow-creep case).                        |

## 3. What to do when the gate fails

### 3.1 Was the growth intentional?

Most regressions are accidental. Before touching the baseline:

1. Read the PR comment (or the `bundle-manifest` workflow artifact).
   The table shows every chunk that moved, with delta bytes and Δ%.
2. For the chunk that ballooned, run `npm run size:why` and
   `npm run bundle:analyze` locally — the latter opens a treemap in
   your browser.
3. Identify the offending import. Common root causes:
   - Barrel imports pulling in the whole module (`import { thing }
     from "../views"`).
   - A static `import` where a `React.lazy(() => import(...))` would
     work.
   - A dependency bump that added transitive bloat — check
     `npm ls <package>` and swap for a lighter alternative.
4. Fix the import / split the code / swap the dependency. Push
   again; the gate re-runs against the same baseline.

### 3.2 The growth was intentional

If you've added a legitimately large feature (a new chain, a new
simulation engine, a mandatory dependency) and the budget should
move:

1. Land the feature PR with the bundle gate still passing (if
   possible) by absorbing the growth into headroom.
2. If the growth exceeds the threshold, open a **separate follow-up
   PR** that does only one thing:
   - `npm run bundle:baseline:update`
   - Commits the updated `reports/bundle-baseline.json`.
   - Updates the "Current baseline" section of this doc with the
     new totals and the commit SHA the baseline came from.
3. The baseline-update PR is reviewed like any code change. Two
   reviewers required, with explicit approval that the growth is
   acceptable.

This split is deliberate — it separates "am I OK with this feature
landing" from "am I OK with the wallet growing by N kB."

## 4. How to update the baseline (with review)

```bash
# Always rebuild first, to be sure you are baselining what CI would.
npm run build --workspace @aethelred/wallet-extension

# Generate a fresh manifest and copy it to the committed baseline.
npm run bundle:baseline:update

# Verify the diff looks reasonable.
git diff reports/bundle-baseline.json

# Open a PR. Title format: "chore(bundle): update baseline — <reason>"
```

The `bundle:baseline:update` script is a one-liner: it generates the
manifest and `cp`'s it to `reports/bundle-baseline.json`. There is no
magic — you can reproduce it by hand if something ever goes wrong with
the script.

## 5. Local diff helper

Before opening a PR with a risky change (dependency bump, new feature,
big refactor), run:

```bash
node scripts/bundle-diff.mjs main
```

The script:

1. Builds the current working tree and captures a manifest.
2. `git stash`-es any uncommitted changes.
3. Checks out `main` (detached) and builds it.
4. Captures a second manifest.
5. Restores your branch and unstashes.
6. Prints the markdown delta table — identical output to what CI
   will post on your PR.

Pass `--force` only if you know what you're doing; the default is
refuse-to-clobber if the working tree is dirty.

## 6. Current baseline

| Metric           | Bytes   | Humanized     |
| ---------------- | ------: | ------------: |
| Total raw        | 1504568 | ~ 1469.3 KB   |
| Total gzip       |  404232 | ~  394.8 KB   |
| Total brotli     |  349755 | ~  341.6 KB   |

**Baseline commit:** `609456dd2841beeb5f30cbf8f6a095d759ebcb20`
**Baseline generated at:** `2026-04-20T13:11:02Z`

Top 5 chunks by gzip size (informational — these are the places
regressions are most likely to show up):

| Chunk                  | Raw      | Gzip     | Brotli   |
| ---------------------- | -------: | -------: | -------: |
| `background.js`        | 197.8 KB |  60.6 KB |  52.5 KB |
| `assets/popup.css`     | 328.2 KB |  47.0 KB |  37.7 KB |
| `chunks/styles.js`     | 130.8 KB |  41.9 KB |  36.9 KB |
| `popup.js`             | 134.7 KB |  34.9 KB |  30.1 KB |
| `chunks/i18n.js`       |  62.7 KB |  19.8 KB |  17.6 KB |

## 7. Per-chunk hard budgets (size-limit)

Complementary to the PR-time regression gate, `.size-limit.cjs`
declares **absolute** hard budgets. These are ceilings that any
given build must stay under, regardless of what the baseline says:

| Chunk                         | Limit  | Compression |
| ----------------------------- | -----: | ----------- |
| `popup.js`                    | 100 kB | gzip        |
| `popup.js`                    |  80 kB | brotli      |
| `background.js`               |  70 kB | gzip        |
| `content.js`                  |   5 kB | gzip        |
| `inpage.js`                   |   5 kB | gzip        |
| `assets/popup.css`            | 110 kB | gzip        |
| `chunks/*.js` (aggregate)     | 320 kB | gzip        |
| `chunks/approvals.js`         |  25 kB | gzip        |
| `chunks/send.js`              |  25 kB | gzip        |
| `chunks/app-catalog.js`       |  25 kB | gzip        |

These run on `npm run size` (locally) and inside `npm run build` on
CI. A budget failure blocks the PR at the `build` job, BEFORE the
regression gate even runs.

The distinction:

- **size-limit (absolute):** "popup.js must never exceed 100 kB
  gzip" — protects against catastrophic bloat. Fires only when the
  ceiling is hit.
- **bundle-gate (relative):** "popup.js grew more than 10 % since
  the last committed baseline" — protects against silent drift.
  Fires on every meaningful regression regardless of headroom.

Both signals are cheap. Keep both.

## 8. Reading the PR comment

The sticky PR comment looks like:

```
## Bundle Size Impact

| Chunk                   | Baseline gzip | Current gzip |    Δ |    Δ% |
|-------------------------|--------------:|-------------:|-----:|------:|
| popup.js                |       30.0 KB |      30.3 KB | +0.3 |  +1.0% |
| chunks/approvals.js     |       10.2 KB |      15.8 KB | +5.6 | +55.0% ❌ |
| chunks/send.js _(new)_  |             — |       1.8 KB | +1.8 |    new |

**TOTAL (gzip): 483.2 KB → 489.0 KB (+5.8 KB, +1.2%)**

_Thresholds: per-chunk > 10% fails, aggregate gzip total > 5% fails._

**REGRESSIONS**: 1 chunk(s) exceeded the 10% growth threshold.
- `chunks/approvals.js`: +5.6 KB (+55.0%)
```

Rows flagged with `❌` exceeded the per-chunk threshold. Rows marked
`_(new)_` / `_(deleted)_` are informational — they do not fail the
gate directly, but new chunks DO contribute to the aggregate total
check.

The comment is **sticky**: subsequent pushes overwrite it rather than
piling up new comments. The hidden HTML marker
`<!-- aethelred-bundle-gate:do-not-edit -->` is how we find and
update the existing comment. Do not edit the bot's comment by
hand — it will be overwritten on the next push.

## 9. Files

| Path                                                | Purpose                                             |
| --------------------------------------------------- | --------------------------------------------------- |
| `scripts/generate-bundle-manifest.mjs`              | Walks `dist/`, emits the manifest                   |
| `scripts/compare-bundle.mjs`                        | Compares manifest to baseline, prints markdown      |
| `scripts/post-bundle-comment.mjs`                   | Posts/updates the sticky PR comment                 |
| `scripts/bundle-diff.mjs`                           | Local diff helper (current vs a git ref)            |
| `reports/bundle-baseline.json`                      | The committed baseline manifest                     |
| `apps/extension/.size-limit.cjs`                    | Absolute per-file budgets                           |
| `apps/extension/size-limit.config.js`               | Re-export shim for `apps/extension/.size-limit.cjs` |
| `apps/extension/src/test/bundle-gate.test.ts`       | Unit tests for the gate logic                       |
| `.github/workflows/bundle.yml`                      | CI job that runs the gate                           |
| `.github/workflows/ci.yml`                          | `ci-ok` depends on `bundle-regression`              |

## 10. Related docs

- `docs/perf/BUDGETS.md` — narrative history of size-limit budgets
  and the rationale for each one.
- `docs/perf/SLO.md` — performance SLOs (cold popup open time,
  background-script idle time). Size is a leading indicator.
