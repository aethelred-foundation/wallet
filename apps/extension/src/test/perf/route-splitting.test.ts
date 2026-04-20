/**
 * ═══════════════════════════════════════════════════════════════════════
 * Route-splitting enforcement
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The popup used to be one monolithic bundle — every view parsed at
 * cold-start even if the user never navigated to it. That regressed
 * popup.js past the 500 kB raw warning and past our gzip budget.
 *
 * The fix in popup/App.tsx was to wrap every non-tab view in
 * `React.lazy(() => import("./views/..."))`. Rollup emits per-chunk
 * files under `dist/chunks/` thanks to `chunkFileNames: "chunks/[name].js"`
 * in vite.config.ts. This test enforces the invariant that:
 *
 *   1. `dist/popup.js` stays under its gzip budget.
 *   2. Each route chunk stays under its own (smaller) budget.
 *   3. The lazy-loaded view source does NOT appear inside popup.js —
 *      i.e. code-splitting actually happened, we didn't accidentally
 *      re-bundle a view via a static import somewhere.
 *
 * Runs AFTER the build. Skips cleanly if there's no `dist/` yet so
 * developers running `vitest` in a fresh checkout don't get a spurious
 * failure — CI always builds first.
 *
 * Owner: wallet-extension team.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..", "..");
const EXTENSION_ROOT = resolve(REPO_ROOT, "apps", "extension");
const DIST = resolve(EXTENSION_ROOT, "dist");
const POPUP_JS = resolve(DIST, "popup.js");
const CHUNKS_DIR = resolve(DIST, "chunks");

/* ─── Thresholds ─────────────────────────────────────────────────── *
 * Picked to match `size-limit.config.js`. If the size-limit budget
 * changes, this test should change with it.
 *
 *  - popup.js gzip: hard upper bound at 100 kB (matches size-limit).
 *  - per-route chunk: 20 kB gzip. The bound applies to *route* chunks
 *    (lazy-loaded views) — NOT to the handful of shared-runtime chunks
 *    that Rollup auto-emits for React internals / i18next / CSS
 *    bootstrap. Those are deliberately shared and their size is
 *    amortized across every route. We skip them via an allowlist so
 *    a shared-chunk regression shows up as a budget failure via
 *    size-limit (which caps the aggregate chunks/*.js size) instead
 *    of as a per-route noise signal here.
 *
 * size-limit enforces the same numbers at CI time; this test mirrors
 * them at unit-test time so the signal fires faster in local loops. */
const POPUP_JS_GZIP_LIMIT = 100 * 1024;
const CHUNK_GZIP_LIMIT = 20 * 1024;

/**
 * Chunks Rollup emits for shared runtime / library code — NOT one of
 * our route chunks. The list is deliberately a prefix match because
 * Rollup disambiguates duplicates by suffixing with a digit
 * (`styles.js`, `styles2.js`, `src.js`, `src2.js`, …).
 */
const SHARED_CHUNK_PREFIXES = ["styles", "i18n", "src", "createLucideIcon"];
function isSharedChunk(name: string): boolean {
  // Strip the trailing .js + any digit suffix, then compare against the
  // allowlist. e.g. `styles2.js` → `styles`.
  const stem = name.replace(/\.js$/, "").replace(/\d+$/, "");
  return SHARED_CHUNK_PREFIXES.includes(stem);
}

/* ─── Helpers ────────────────────────────────────────────────────── */
function gzipSize(path: string): number {
  const buf = readFileSync(path);
  return gzipSync(buf).length;
}

function fmt(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} kB`;
}

/* ─── Tests ──────────────────────────────────────────────────────── */

describe("route-level code splitting", () => {
  const hasBuild = existsSync(POPUP_JS);

  // The build artifact is optional for local-dev loops. Skip with a
  // clear note if it's missing — this keeps `npm run test:run` green
  // in an un-built repo. CI always builds first so it always runs.
  const itIfBuilt = hasBuild ? it : it.skip;

  it("dist/popup.js exists (skipped if not yet built)", () => {
    if (!hasBuild) {
      // Emit a hint so the reviewer understands why the real assertions
      // didn't fire in this particular run.
      // eslint-disable-next-line no-console
      console.warn(
        "[route-splitting] dist/popup.js not found — run `npm run build:extension` to run the real budget checks.",
      );
      return;
    }
    expect(statSync(POPUP_JS).size).toBeGreaterThan(0);
  });

  itIfBuilt(`popup.js gzip < ${fmt(POPUP_JS_GZIP_LIMIT)}`, () => {
    const size = gzipSize(POPUP_JS);
    expect(
      size,
      `popup.js gzipped to ${fmt(size)} — budget is ${fmt(POPUP_JS_GZIP_LIMIT)}. Lazy-load more routes or inspect bundle-report.html.`,
    ).toBeLessThan(POPUP_JS_GZIP_LIMIT);
  });

  itIfBuilt("each chunk stays under the per-route budget", () => {
    // chunks/ is only present if the build actually emitted any lazy
    // chunks — it's possible to regress by re-importing a lazy view
    // statically. If the directory doesn't exist OR is empty, that's a
    // red flag for code-splitting failing silently.
    expect(
      existsSync(CHUNKS_DIR),
      "dist/chunks/ not found — lazy routes must emit per-route chunks via vite.config.ts chunkFileNames.",
    ).toBe(true);

    const entries = readdirSync(CHUNKS_DIR).filter((f) => f.endsWith(".js"));
    expect(
      entries.length,
      "dist/chunks/ is empty — no lazy routes were emitted. Check React.lazy() call-sites in popup/App.tsx.",
    ).toBeGreaterThan(0);

    const routeChunks = entries.filter((e) => !isSharedChunk(e));
    expect(
      routeChunks.length,
      "dist/chunks/ contained only shared-runtime chunks — no route chunks were emitted. Check React.lazy() call-sites in popup/App.tsx.",
    ).toBeGreaterThan(0);

    const oversized: Array<{ name: string; size: number }> = [];
    for (const entry of routeChunks) {
      const size = gzipSize(join(CHUNKS_DIR, entry));
      if (size > CHUNK_GZIP_LIMIT) {
        oversized.push({ name: entry, size });
      }
    }
    expect(
      oversized,
      `Route chunks over ${fmt(CHUNK_GZIP_LIMIT)} gzip:\n${oversized.map((o) => `  ${o.name}  ${fmt(o.size)}`).join("\n")}`,
    ).toEqual([]);
  });

  itIfBuilt("send.tsx + approvals.tsx content is NOT inlined into popup.js", () => {
    // Heuristic: look for component names we expect to live in separate
    // chunks. If they appear inside popup.js, someone re-added a static
    // import somewhere in the dependency tree and we lost the split.
    //
    // This isn't perfectly reliable — a minifier could theoretically
    // rename the export away — but the release build doesn't mangle
    // these names, and we grep on the namespaced string Rollup uses for
    // the lazy-import wrapper.
    const popup = readFileSync(POPUP_JS, "utf8");

    // Each "...Impl" + export combo — easy to detect but unlikely to
    // match by accident in any other shipping code.
    //
    // If the assertion flips, either the view was inlined (perf bug)
    // or the heuristic needs updating (no bug). In the latter case,
    // adjust the sentinel string.
    const sentinelStrings = [
      // SendView's form header lives inside the lazy chunk
      "snd-top-back",
      // ApprovalsView renders ApprovalDetailView which imports SuccessMorph
      "handleApprovalDecision",
    ];
    for (const sentinel of sentinelStrings) {
      expect(
        popup.includes(sentinel),
        `popup.js contains "${sentinel}" — content from a lazy-loaded view appears in the main bundle. Check for a static import path sneaking past React.lazy().`,
      ).toBe(false);
    }
  });
});
