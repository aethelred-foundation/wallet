# Aethelred Wallet — Benchmarking Guide

> **Last updated:** 2026-04-19
> **Owner:** Ramesh Tamilselvan — `perf@aethelred.org`
> **Applies to:** `packages/core/bench`, `packages/audit/bench`,
>   `packages/policy/bench`.

This guide covers **how to run, read, and extend the wallet's
benchmarks**, and how to distinguish real regressions from CI noise.
It complements `SLO.md` (what the targets are) and `BUDGETS.md` (how
the targets are enforced).

## 1. How benchmarks are organized

```
packages/
├─ core/
│  └─ bench/
│     └─ signer.bench.ts        # EIP-1559, secp256k1, keccak256, RLP
├─ audit/
│  └─ bench/
│     └─ audit.bench.ts         # AuditCapture + MerkleBatch
└─ policy/
   └─ bench/
      └─ engine.bench.ts        # evaluate() on the 20-rule personal bundle
```

The runner is `vitest.bench.config.mts` at the repo root:

- **Environment:** `node` (not jsdom — benchmarks shouldn't pay the
  cost of DOM setup).
- **Include glob:** `packages/*/bench/**/*.bench.ts`.
- **One call:** `npm run bench` runs every benchmark.

Per-file runs:

```
npx vitest bench --run --config vitest.bench.config.mts \
  packages/core/bench/signer.bench.ts
```

## 2. Writing a new benchmark

### 2.1 File location and name

- Put the file next to its feature: `packages/<pkg>/bench/<topic>.bench.ts`.
- Suffix MUST be `.bench.ts` — the runner config filters on that pattern.

### 2.2 Minimum contents

Every bench file has:

- A file-level doc comment stating **what's benchmarked, who owns it,
  and a link to `SLO.md`**.
- At least four `bench()` calls, each with:
  - A label that includes the target (`"rlpEncode (target ≥ 500k ops/s)"`).
  - A doc comment above the call that spells out the **target** and the
    **fail threshold**. Convention: fail threshold ≈ target / 3 (that
    absorbs the ~2x-3x slowdown shared CI runners experience vs. local
    laptops).
- No network, no disk, no timers — benchmarks must be pure CPU.
- No `console.log` in the hot path — it lies about timings on some
  runtimes.

### 2.3 Sample template

```ts
import { bench, describe } from "vitest";

describe("my-feature hot path", () => {
  /**
   * Target: ≥ 10k ops/sec.
   * Fail:   < 3k ops/sec.
   *
   * Motivation: called once per ...
   */
  bench("fast path (target ≥ 10k ops/s)", () => {
    myFeature.hotPath();
  }, { time: 1000 });
});
```

## 3. Reading the output

Vitest's bench reporter prints one row per `bench()`:

```
 ✓ EIP-1559 tx signing throughput (target ≥ 500 ops/s)  812.40 ops/sec ±1.40% (64 runs sampled)
```

- **ops/sec** — the primary number. Higher is better.
- **±%** — relative margin of error. Below ~3% is low-noise; above
  ~5% means the runner was loaded and the number should be re-taken.
- **runs sampled** — number of measurement windows. Vitest picks this
  automatically based on variance; low sample count + high RME
  together indicate an unreliable measurement.

### 3.1 What is "noise" vs. "regression"

| Signal | Interpretation |
|--------|----------------|
| Single bench regresses by 5% on one run, others green | Noise. Re-run. |
| Single bench regresses by 30% on one run | Noise OR real — re-run. If it stays, investigate. |
| Multiple benches in the same file regress 5-10% on one run | Likely CPU contention. Re-run. |
| Multiple benches regress by 20%+ across unrelated files | Infrastructure change — new Node version, new runner image. File an SRE ticket. |
| Single bench regresses consistently across 3+ runs | Real regression. Stop, investigate, revert if possible. |

## 4. Regression detection

### 4.1 Today (stub mode)

`docs/perf/bench-history.jsonl` accumulates one record per push to
`main`, written by `scripts/append-bench-history.mjs`. The
`check-bench-regression.mjs` companion is a stub that logs "not
active" and exits 0. No regression gate is enforced until the
history has at least one week of data.

### 4.2 When history reaches 7 days

Flip `ENABLED=true` at the top of `check-bench-regression.mjs` and
add a CI step that invokes it between `Run vitest bench` and
`Append to rolling history`. The algorithm:

1. Parse `docs/perf/bench-history.jsonl`.
2. Filter records in the trailing 7 × 24 × 3600 × 1000 ms window.
3. For each `{file, name}` key, compute the p50 of `hz`.
4. Compare the newest record's `hz` per key to the p50.
5. Fail if any `latest.hz < p50 * 0.8` — a 20% throughput drop.

The 20% threshold is large enough to absorb residual runner noise
(we expect ~5% RME plus occasional 10% runner jitter) while catching
real regressions from dep upgrades or accidental n² algorithms.

### 4.3 Intentional perf improvements

If a PR legitimately speeds a primitive up (e.g. swapping
`@noble/hashes` for a WASM implementation), the first post-merge
`bench-history.jsonl` entry will be faster than the rolling p50.
That's fine — the next week of entries pulls the p50 up and the gate
resets itself at the new level. No manual baseline reset needed.

### 4.4 Intentional perf regressions

If a PR legitimately slows a primitive down (e.g. adding a mandatory
safety check), the trailing p50 will reject it. In that case:

1. Land the PR on a branch with `[perf:baseline-reset]` in the
   commit message.
2. After merge, open a follow-up PR deleting the trailing 7 days
   of `bench-history.jsonl` entries for the affected benchmarks
   (`jq` filter in a script is cleanest).
3. The next push re-seeds the baseline.

Alternatively, raise the target in the bench file itself — that
keeps the budget explicit in-code rather than by implicit baseline.

## 5. Playbook: real regression detected

1. **Reproduce locally.** `npm run bench -- --run <path-to-bench>`
   on the same commit as CI. If you can't reproduce, the issue is
   likely runner-specific; file an SRE ticket.
2. **Bisect.** `git bisect` between the last green push and the
   current HEAD, running `npm run bench` at each step.
3. **Profile.** Use `node --prof` + `node --prof-process` on the
   isolated bench. Most real regressions show up as either:
   - A single new dominant stack frame (new code path).
   - A global slowdown (V8 inline cache miss, usually from shape
     changes in a hot object).
4. **Fix.** Revert the offending commit or submit a targeted fix.
5. **Document.** In the fix PR description, link the bench
   regression (the CI run + the local reproduction) and state the
   root cause in one sentence.

## 6. Ownership

| Bench file | Owner |
|-----------|-------|
| `packages/core/bench/signer.bench.ts` | wallet-core team |
| `packages/audit/bench/audit.bench.ts` | wallet-trust team |
| `packages/policy/bench/engine.bench.ts` | wallet-policy team |

Ownership means: when the bench breaks, that team is on the hook.
Benches that span multiple domains (e.g. a future
`signing-pipeline.bench.ts` exercising core + policy + audit) get
the owner of the primary path they stress.

## 7. FAQ

**Q: Should I add benches for React components?**
No. React performance is covered by Lighthouse (user-facing) and by
React's own DevTools profiler (developer-facing). Adding `vitest bench`
tests for React renders makes the runner jsdom-dependent, which
breaks the fast `environment: node` promise we make here.

**Q: What if a primitive is inherently variable (e.g. async I/O)?**
Benchmarks measure CPU-bound, deterministic code. Anything involving
real I/O gets a tracer span (see `@aethelred/wallet-observability`)
and an SLO in `SLO.md`, not a bench.

**Q: Can I benchmark in a browser?**
Not in this repo's CI. If you need browser-specific numbers, put
them in `apps/extension/e2e/` as a Playwright perf test and gate on
a separate workflow.
