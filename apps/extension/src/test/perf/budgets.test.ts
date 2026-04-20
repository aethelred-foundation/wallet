/**
 * ═══════════════════════════════════════════════════════════════════════
 * Bundle-size budget drift detector
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Enforces the invariant: every shipping JS bundle in the extension
 * MUST have a corresponding entry in `size-limit.config.js`. Adding a
 * new bundle without a budget is a silent ship-size regression, because
 * `size-limit` only checks files it knows about — a file it has never
 * heard of is implicitly free.
 *
 * The test walks the Vite input list (popup / options / background /
 * content / inpage) and asserts that every one of them has a matching
 * path in the size-limit config. It also asserts that the brotli
 * variant of `popup.js` is declared — we measure brotli specifically
 * for `popup.js` because it's the largest shipping bundle and the one
 * most likely to regress on compression efficiency.
 *
 * Runs at test-time, NOT as part of `size-limit` itself. The reason:
 * `size-limit` measures against a built `dist/`, which CI does
 * produce but developers rarely do locally. This test reads source
 * config files only, so `npm run test:run` catches drift inside the
 * normal unit-test loop.
 *
 * Owner: wallet-extension team. See docs/perf/BUDGETS.md §2.3.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..", "..");
const EXTENSION_ROOT = resolve(REPO_ROOT, "apps", "extension");
const VITE_CONFIG = resolve(EXTENSION_ROOT, "vite.config.ts");
const SIZE_LIMIT_CONFIG = resolve(EXTENSION_ROOT, "size-limit.config.js");

/**
 * Parse the Vite config's `input` block to learn what entries we ship.
 * We read the source text because importing vite.config.ts from Node
 * would drag in all of Vite's runtime (and its plugins) and slow this
 * test down to minutes.
 *
 * The parsing strategy is intentionally simple — it expects the config
 * to use the standard `input: { name: resolve(...) }` block that the
 * current vite.config.ts uses. If that shape changes, update the
 * regex; a test failure is the desired signal (better than silent drift).
 */
function parseViteEntries(): string[] {
  const src = readFileSync(VITE_CONFIG, "utf8");
  const match = src.match(/input:\s*\{([\s\S]*?)\}/);
  if (!match) {
    throw new Error("could not locate `input: { ... }` block in vite.config.ts");
  }
  const entries: string[] = [];
  const entryMatches = match[1].matchAll(/(\w+):\s*resolve\([^)]+\)/g);
  for (const m of entryMatches) {
    entries.push(m[1]);
  }
  return entries;
}

/** Load size-limit.config.js via `require` — it's CJS by convention. */
function loadSizeLimitConfig(): Array<{ path: string; limit: string }> {
  const require = createRequire(import.meta.url);
  const cfg = require(SIZE_LIMIT_CONFIG) as Array<{
    path: string;
    limit: string;
  }>;
  if (!Array.isArray(cfg)) {
    throw new Error("size-limit.config.js did not export an array");
  }
  return cfg;
}

/* ─── Tests ──────────────────────────────────────────────────────── */

describe("bundle size budget drift detector", () => {
  it("size-limit.config.js exists and is readable", () => {
    expect(existsSync(SIZE_LIMIT_CONFIG)).toBe(true);
    const cfg = loadSizeLimitConfig();
    expect(cfg.length).toBeGreaterThan(0);
  });

  it("every Vite HTML/JS entry has a matching budget", () => {
    const entries = parseViteEntries();
    expect(entries.length).toBeGreaterThan(0);

    const cfg = loadSizeLimitConfig();
    const paths = cfg.map((c) => c.path);

    // HTML entries (popup, options) themselves don't need a JS budget
    // — their `.html` files aren't measured by size-limit. Every other
    // entry is a JS bundle shipped under `dist/<name>.js` and MUST have
    // a matching budget.
    const htmlEntries = new Set(["popup", "options"]);
    const jsEntries = entries.filter((e) => !htmlEntries.has(e));

    for (const entry of jsEntries) {
      const needle = `dist/${entry}.js`;
      const hasBudget = paths.some((p) => p === needle);
      expect(
        hasBudget,
        `entry "${entry}" (${needle}) has no size-limit budget — add one in ${SIZE_LIMIT_CONFIG}`,
      ).toBe(true);
    }

    // Popup is the HTML entry whose JS artifact IS still measured
    // separately (dist/popup.js is the compiled output) — verify
    // that's present under at least one compression variant.
    const popupCovered = paths.some((p) => p === "dist/popup.js");
    expect(popupCovered, "popup.js must have a size-limit budget").toBe(true);
  });

  it("popup.js has both gzip and brotli budgets", () => {
    const cfg = loadSizeLimitConfig();
    const popup = cfg.filter(
      (c) => c.path === "dist/popup.js",
    ) as Array<{ gzip?: boolean; brotli?: boolean; limit: string }>;
    const gzip = popup.find((p) => p.gzip === true);
    const brotli = popup.find((p) => p.brotli === true);

    expect(gzip, "popup.js needs a gzip budget").toBeTruthy();
    expect(brotli, "popup.js needs a brotli budget").toBeTruthy();
  });

  it("popup.css has a gzip budget", () => {
    const cfg = loadSizeLimitConfig();
    const match = cfg.some(
      (c) =>
        c.path === "dist/assets/popup.css" &&
        (c as Record<string, unknown>).gzip === true,
    );
    expect(match, "dist/assets/popup.css needs a gzip budget").toBe(true);
  });

  it("every budget declares a positive integer-kB limit", () => {
    const cfg = loadSizeLimitConfig();
    for (const entry of cfg) {
      const m = /^(\d+)\s*kB$/.exec(entry.limit);
      expect(
        m,
        `entry ${entry.path} has a non-numeric limit "${entry.limit}"`,
      ).toBeTruthy();
      expect(Number(m![1])).toBeGreaterThan(0);
    }
  });
});
