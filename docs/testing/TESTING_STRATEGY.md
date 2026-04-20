# Aethelred Wallet — Testing Strategy

This document explains the test pyramid, which tool covers which
layer, and how to add a new test when you build a new feature.

## Layers

```
            ┌──────────────────────────┐
            │  Manual + exploratory     │  (ad-hoc, by humans)
            ├──────────────────────────┤
            │  Visual regression        │  .storybook/ + test-runner
            │  E2E (Playwright)         │  apps/extension/e2e/
            │  Contract (cross-plat)    │  src/test/contract/
            ├──────────────────────────┤
            │  Integration              │  src/test/*.integration.test.ts
            │  Property (fast-check)    │  src/test/property/
            │  Fuzz   (fast-check)      │  src/test/fuzz/
            │  Mutation (Stryker)       │  stryker.conf.mjs (weekly)
            ├──────────────────────────┤
            │  Unit                     │  src/test/*.test.ts(x)
            │  A11y (axe-core)          │  src/test/a11y/
            └──────────────────────────┘
```

Roughly from bottom to top: cheap and fast at the bottom, expensive
and slow at the top. Lower tiers run on every PR. The slow tiers
(mutation, full-iteration property runs) are scheduled.

## When to add which kind of test

| Situation                                                      | Test type                          |
| --------------------------------------------------------------- | ---------------------------------- |
| Pure function, arithmetic, parsing                              | Unit + property                    |
| Pure function with security properties (hash, signature, RLP)   | Property + contract + fuzz         |
| Cross-package workflow (policy → approval → audit)              | Integration                        |
| Component with visible output                                   | Unit (RTL) + Storybook story       |
| Component that can drift visually across themes                 | Visual regression                  |
| User-visible flow ending in a state transition                  | E2E (Playwright)                   |
| Cross-platform crypto primitive (keccak, SHA-256, Merkle root)  | Contract (TS + Swift + Kotlin)     |
| Critical file that mutation score should guard                  | Listed in `stryker.conf.mjs`       |

## Adding a new test category

1. Create the directory under `apps/extension/src/test/<category>/`.
2. Add a pattern to `apps/extension/vitest.config.mts::test.include`
   if file names don't match the default `*.test.ts(x)` glob.
3. Add a root `test:<category>` npm script in `wallet/package.json`
   that forwards `npx vitest run <category>` to the extension
   workspace.
4. Document the new category here and in the relevant PR.

## Running tests

```
npm test                             # vitest in watch mode
npm run test:e2e                     # Playwright
npm run test:property                # property tests only
npm run test:fuzz                    # fuzz tests only
npm run test:a11y                    # axe-core unit suite
npm run test:contract                # cross-platform contract vectors
npm run storybook                    # interactive gallery
npm run storybook:test               # visual regression
npm run mutation:test                # Stryker (slow)
```

## Flakiness policy

If an E2E test flakes more than once in ten runs on CI, quarantine
it by renaming the file extension to `.e2e.ts.skip` and open a
follow-up issue. Do not add sleep-based waits — use
`expect(locator).toBeVisible({ timeout })` or similar retrying
assertions.

## Adding a Storybook story

1. Create / extend `component-gallery.stories.tsx` next to the
   primitive, or add `<name>.stories.tsx` co-located with the
   component.
2. Make sure the story renders in BOTH themes (use the global theme
   toolbar to verify).
3. Run `npm run storybook:test` locally. If the snapshot is new,
   commit it under `__image_snapshots__/`.
