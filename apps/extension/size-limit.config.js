/**
 * Aethelred Wallet — size-limit budget re-export.
 *
 * size-limit discovers config via lilconfig in this search order:
 *   package.json, .size-limit.json, .size-limit, .size-limit.js,
 *   .size-limit.mjs, .size-limit.cjs, .size-limit.ts, ...
 *
 * `size-limit.config.js` (this file) is NOT in that search path, so
 * historically this file was read by nobody — a silent no-op. The real
 * config lives in `.size-limit.cjs` next to this file.
 *
 * We keep this file around because `src/test/perf/budgets.test.ts`
 * historically parsed it as the source of truth for the drift detector.
 * Re-exporting `.size-limit.cjs` keeps that test pointing at a single
 * source while letting the CLI see the same list.
 */

module.exports = require("./.size-limit.cjs");
