/**
 * ═════════════════════════════════════════════════════════════════════════
 * Aethelred Wallet — Bundle size budgets (size-limit)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Why these numbers
 * -----------------
 * The limits below are set roughly 10% above the measured production build
 * on the branch that introduced this file (see BUDGETS.md §3 for the raw
 * baseline). That headroom is intentional:
 *
 *   • Small organic growth (a new icon, a new i18n string, a new dApp card)
 *     should NOT page the wallet-extension team. Sub-10% drift is noise in
 *     the context of a Chrome extension — install size dominates, and the
 *     user-facing metric (time-to-interactive on a cold popup) moves much
 *     less than byte count once the asset is cached.
 *
 *   • Runaway growth — a React state library wholesale added to the popup,
 *     a crypto primitive replaced by a 200 kB polyfill, a CSS-in-JS engine
 *     bundled into background.js — MUST fail the PR immediately. 10% is
 *     large enough to soak up quarter-over-quarter churn but small enough
 *     to catch accidents on a single PR.
 *
 *   • Budgets are gzip/brotli, not raw. Chrome serves the extension MV3
 *     assets compressed on disk for the most part, and "raw" is almost
 *     never the metric a user pays. Brotli is reported alongside gzip on
 *     `popup.js` because the store (and CDN-fronted updates) negotiate
 *     brotli when available.
 *
 *   • Route-level code splitting (see popup/App.tsx) ejects cold views out
 *     of `popup.js` and into per-route `chunks/*.js` files. Each chunk has
 *     its OWN gzip budget so a runaway lazy route can't hide behind the
 *     main-bundle budget passing.
 *
 * What to do when a budget fails
 * ------------------------------
 *   1. Run `npm run size:why` locally — it prints per-dependency cost.
 *   2. Run `npm run bundle:analyze` to render the treemap in a browser.
 *   3. If the growth is legitimate (intentional feature work), open a PR
 *      that bumps the budget here AND updates `docs/perf/BUDGETS.md` with
 *      the rationale. Budget changes are reviewed just like code changes.
 *   4. If the growth is accidental, fix the import / split the code / lazy
 *      load the feature. See `docs/perf/BUDGETS.md` §5 for playbooks.
 *
 * Ownership
 * ---------
 * The wallet-extension team owns the extension bundles (popup, background,
 * content, inpage, popup.css). Violations ping them first. See
 * `docs/perf/SLO.md` for escalation chains.
 * ═════════════════════════════════════════════════════════════════════════
 */

module.exports = [
  {
    name: "popup.js (gzip)",
    path: "dist/popup.js",
    limit: "100 kB",
    webpack: false,
    brotli: false,
    gzip: true,
  },
  {
    name: "popup.js (brotli)",
    path: "dist/popup.js",
    limit: "80 kB",
    webpack: false,
    brotli: true,
    gzip: false,
  },
  {
    name: "background.js (gzip)",
    path: "dist/background.js",
    limit: "70 kB",
    webpack: false,
    brotli: false,
    gzip: true,
  },
  {
    name: "content.js (gzip)",
    path: "dist/content.js",
    limit: "5 kB",
    webpack: false,
    brotli: false,
    gzip: true,
  },
  {
    name: "inpage.js (gzip)",
    path: "dist/inpage.js",
    limit: "5 kB",
    webpack: false,
    brotli: false,
    gzip: true,
  },
  {
    name: "popup.css (gzip)",
    path: "dist/assets/popup.css",
    limit: "110 kB",
    webpack: false,
    brotli: false,
    gzip: true,
  },
  /*
   * Per-route chunk budget
   * ────────────────────────────────────────────────────────────
   * Every lazy-loaded view emits its own `dist/chunks/<name>.js`
   * file. Individually they should stay small — a route that blows
   * past this threshold is usually a sign it's pulling a heavy
   * dependency it should share via a common chunk, or that it has
   * accidentally imported a barrel module.
   *
   * The budget is an AGGREGATE cap across every JS file under
   * `dist/chunks/*.js` — size-limit resolves the glob against the
   * built output and sums the matched sizes. We spend most of the
   * budget on two shared runtime chunks that Rollup emits
   * automatically (React internals, the Lucide icon createLucideIcon
   * helper, translations and the CSS side-effect bootstrap). The
   * per-route chunks themselves average under 5 kB gzip each.
   *
   * If a route-chunk regression happens, the `route-splitting.test.ts`
   * perf test catches it at the 20 kB per-file threshold — the
   * aggregate check below is the secondary, coarser signal.
   */
  {
    name: "chunks/*.js (gzip, all chunks combined)",
    path: "dist/chunks/*.js",
    limit: "200 kB",
    webpack: false,
    brotli: false,
    gzip: true,
  },
];
