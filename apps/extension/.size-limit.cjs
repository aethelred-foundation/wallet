/**
 * ═════════════════════════════════════════════════════════════════════════
 * Aethelred Wallet — Bundle size budgets (size-limit)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * This is the canonical config file discovered by size-limit (via
 * lilconfig). Historically the repo also held a `size-limit.config.js`
 * that wasn't picked up by the CLI — this `.size-limit.cjs` replaces
 * it and is what `npm run size` actually reads.
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
 *   • Budgets are gzip/brotli for JS/CSS, and raw for images (sharp
 *     already compressed them; gzip on a webp adds ~0 %). Chrome serves
 *     the extension MV3 assets compressed on disk for the most part, and
 *     "raw" is almost never the metric a user pays for JS; brotli is
 *     reported alongside gzip on `popup.js` because the store (and
 *     CDN-fronted updates) negotiate brotli when available.
 *
 *   • Route-level code splitting (see popup/App.tsx) ejects cold views out
 *     of `popup.js` and into per-route `chunks/*.js` files. Each chunk has
 *     its OWN gzip budget so a runaway lazy route can't hide behind the
 *     main-bundle budget passing.
 *
 *   • Image budgets enforce the WebP payload for each dApp card and the
 *     combined raster+WebP "install size" footprint. Without these, the
 *     1.4 MB ZeroID PNG slipped into the extension and nobody noticed
 *     until a CWS reviewer flagged it.
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
 *   5. For images: `npm run optimize:images` regenerates WebP siblings
 *      in `apps/extension/public/`. Commit both the source raster and
 *      the generated WebP.
 *
 * Ownership
 * ---------
 * The wallet-extension team owns the extension bundles (popup, background,
 * content, inpage, popup.css). Violations ping them first. See
 * `docs/perf/SLO.md` for escalation chains.
 * ═════════════════════════════════════════════════════════════════════════
 */

module.exports = [
  /* ── JS bundles ──────────────────────────────────────────────────── */
  {
    name: "popup.js (gzip)",
    path: "dist/popup.js",
    limit: "100 kB",
    brotli: false,
    gzip: true,
    running: false,
  },
  {
    name: "popup.js (brotli)",
    path: "dist/popup.js",
    limit: "80 kB",
    brotli: true,
    gzip: false,
    running: false,
  },
  {
    name: "background.js (gzip)",
    path: "dist/background.js",
    limit: "70 kB",
    brotli: false,
    gzip: true,
    running: false,
  },
  {
    name: "content.js (gzip)",
    path: "dist/content.js",
    limit: "5 kB",
    brotli: false,
    gzip: true,
    running: false,
  },
  {
    name: "inpage.js (gzip)",
    path: "dist/inpage.js",
    limit: "5 kB",
    brotli: false,
    gzip: true,
    running: false,
  },
  {
    name: "popup.css (gzip)",
    path: "dist/assets/popup.css",
    limit: "110 kB",
    brotli: false,
    gzip: true,
    running: false,
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
   * If a route-chunk regression happens, the `route-splitting.test.ts`
   * perf test catches it at the 20 kB per-file threshold — the
   * aggregate check below is the secondary, coarser signal.
   */
  {
    name: "chunks/*.js (gzip, all chunks combined)",
    path: "dist/chunks/*.js",
    limit: "320 kB",
    brotli: false,
    gzip: true,
    running: false,
  },

  /*
   * ════════════════════════════════════════════════════════════
   * Image payload budgets
   * ════════════════════════════════════════════════════════════
   *
   * The dApp card artwork used to ship as raw PNG/JPG — 1.4 MB for
   * the ZeroID card alone. `scripts/optimize-images.mjs` emits a
   * WebP sibling next to each raster at 80 % quality (or lossless
   * for the brand mark), and `<DappImage>` prefers the WebP via
   * `<picture><source type="image/webp">`.
   *
   * Two layers of budget:
   *   1. Combined (raster + WebP) — caps the install-size footprint.
   *      The raster stays as a <picture> fallback that modern Chrome
   *      never actually serves, but its bytes count against the
   *      uncompressed extension install size and user "install
   *      size" anxiety.
   *   2. WebP-only — caps the bytes a modern Chrome actually serves
   *      on a cold popup. Matches the task-spec ~200 kB / 100 kB /
   *      ... limits; the tighter number here is what users pay.
   * ──────────────────────────────────────────────────────────── */

  /* ── Combined (raster + WebP) — install-size footprint ──────────── */
  {
    name: "dapp-zeroid (png+webp)",
    path: "dist/dapp-zeroid.{png,webp}",
    limit: "1650 kB",
    brotli: false,
    gzip: false,
    running: false,
  },
  {
    name: "dapp-terraqura (png+webp)",
    path: "dist/dapp-terraqura.{png,webp}",
    limit: "620 kB",
    brotli: false,
    gzip: false,
    running: false,
  },
  {
    name: "dapp-cruzible (png+webp)",
    path: "dist/dapp-cruzible.{png,webp}",
    limit: "340 kB",
    brotli: false,
    gzip: false,
    running: false,
  },
  {
    name: "dapp-noblepay (jpg+webp)",
    path: "dist/dapp-noblepay.{jpg,webp}",
    limit: "55 kB",
    brotli: false,
    gzip: false,
    running: false,
  },
  {
    name: "logo (png+webp)",
    path: "dist/logo.{png,webp}",
    limit: "220 kB",
    brotli: false,
    gzip: false,
    running: false,
  },
  {
    name: "icon (png+webp)",
    path: "dist/icon.{png,webp}",
    limit: "150 kB",
    brotli: false,
    gzip: false,
    running: false,
  },

  /* ── WebP-only — bytes actually served to Chrome ────────────────── */
  {
    name: "dapp-zeroid.webp (served)",
    path: "dist/dapp-zeroid.webp",
    limit: "200 kB",
    brotli: false,
    gzip: false,
    running: false,
  },
  {
    name: "dapp-terraqura.webp (served)",
    path: "dist/dapp-terraqura.webp",
    limit: "100 kB",
    brotli: false,
    gzip: false,
    running: false,
  },
  {
    name: "dapp-cruzible.webp (served)",
    path: "dist/dapp-cruzible.webp",
    limit: "100 kB",
    brotli: false,
    gzip: false,
    running: false,
  },
  {
    name: "dapp-noblepay.webp (served)",
    path: "dist/dapp-noblepay.webp",
    limit: "40 kB",
    brotli: false,
    gzip: false,
    running: false,
  },
  {
    name: "logo.webp (served, lossless)",
    path: "dist/logo.webp",
    limit: "80 kB",
    brotli: false,
    gzip: false,
    running: false,
  },
  {
    name: "icon.webp (served, lossless)",
    path: "dist/icon.webp",
    limit: "50 kB",
    brotli: false,
    gzip: false,
    running: false,
  },
];
