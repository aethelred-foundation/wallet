# Extension testing dependencies — notes

`apps/extension/package.json` lists these newly-added dev dependencies
for the testing infrastructure:

- `@playwright/test`, `playwright` — end-to-end browser automation
- `axe-core`, `fast-check` — a11y and property-based testing
- `@storybook/*`, `storybook`, `@storybook/test-runner`,
  `jest-image-snapshot`, `http-server` — visual regression + gallery
- `@stryker-mutator/core`, `@stryker-mutator/vitest-runner` — mutation
  testing

## CI installation policy

These deps are NOT needed for a local `npm run dev` / `npm run build`
loop. To keep developer install times low, CI installs the full set
lazily — the e2e / visual / mutation workflows each `npm ci` in
their own job, and the main `ci.yml` still runs from the usual
`npm ci --ignore-scripts` path.

When the consolidated `package-lock.json` is regenerated at
integration time these entries will flow through; until then
`npm ci` in a workflow that uses these tools will fall back on
registry resolution.
