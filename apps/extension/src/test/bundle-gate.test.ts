/**
 * ═══════════════════════════════════════════════════════════════════════
 * bundle-gate.test.ts — unit tests for the bundle regression gate
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The bundle-regression CI gate is glue between three pure-ish functions
 * that we can test without ever touching the real `apps/extension/dist/`:
 *
 *   • `generateBundleManifest({ distDir })`  (scripts/generate-bundle-manifest.mjs)
 *   • `compareBundle({ baseline, current })` (scripts/compare-bundle.mjs)
 *   • `renderMarkdown(summary)`              (scripts/compare-bundle.mjs)
 *   • `buildCommentBody(markdown)`           (scripts/post-bundle-comment.mjs)
 *   • `postBundleComment({...})`             (scripts/post-bundle-comment.mjs)
 *
 * This test suite exercises them with fabricated input so it runs in
 * milliseconds and is stable even on a fresh clone with no `dist/`.
 *
 * Why so many small tests?
 * ------------------------
 * The regression gate IS the safety-net for the rest of the extension's
 * bundle-size work. If the gate itself has a bug — a false negative
 * that passes a 40 % regression through, or a false positive that
 * blocks a 2 % dep bump — the whole strategy collapses. Each boundary
 * condition gets its own test.
 *
 * Owner: wallet-extension team. See docs/engineering/BUNDLE_BUDGETS.md.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const SCRIPTS_DIR = resolve(REPO_ROOT, "scripts");

/** Minimal shape matching what the manifest/comparator produce. */
interface ManifestEntry {
  raw: number;
  gzip: number;
  brotli: number;
  sha256: string;
}
interface Manifest {
  generatedAt: string;
  commit: string;
  chunks: Record<string, ManifestEntry>;
  totals: { raw: number; gzip: number; brotli: number };
}

/** Build a synthetic manifest. Defaults keep byte math simple. */
function fakeManifest(overrides: Partial<Manifest> = {}): Manifest {
  const chunks = overrides.chunks ?? {
    "popup.js": { raw: 100_000, gzip: 30_000, brotli: 26_000, sha256: "a".repeat(64) },
    "background.js": { raw: 180_000, gzip: 60_000, brotli: 52_000, sha256: "b".repeat(64) },
    "chunks/send.js": { raw: 10_000, gzip: 4_000, brotli: 3_500, sha256: "c".repeat(64) },
  };
  const totals = overrides.totals ?? {
    raw: Object.values(chunks).reduce((s, v) => s + v.raw, 0),
    gzip: Object.values(chunks).reduce((s, v) => s + v.gzip, 0),
    brotli: Object.values(chunks).reduce((s, v) => s + v.brotli, 0),
  };
  return {
    generatedAt: overrides.generatedAt ?? "2026-04-20T00:00:00.000Z",
    commit: overrides.commit ?? "deadbeef",
    chunks,
    totals,
  };
}

/* ── generateBundleManifest ──────────────────────────────────────── */

describe("generateBundleManifest", () => {
  it("produces deterministic output for the same inputs", async () => {
    const { generateBundleManifest, serializeManifest } = await import(
      resolve(SCRIPTS_DIR, "generate-bundle-manifest.mjs")
    );

    // Build a tiny synthetic dist/ on the fly. Using fixed content lets
    // us assert byte-exact output across two separate runs.
    const root = mkdtempSync(join(tmpdir(), "bundle-det-"));
    writeFileSync(join(root, "popup.js"), "console.log('hello popup')\n");
    writeFileSync(join(root, "background.js"), "console.log('hello background')\n");
    mkdirSync(join(root, "chunks"));
    writeFileSync(join(root, "chunks", "send.js"), "export const x=1\n");

    const clock = () => "2026-04-20T00:00:00.000Z";
    const commit = "test-sha";
    const first = await generateBundleManifest({ distDir: root, clock, commit });
    const second = await generateBundleManifest({ distDir: root, clock, commit });

    // Byte-identical serialization is the contract we depend on.
    expect(serializeManifest(first)).toBe(serializeManifest(second));

    // And the output is sorted alphabetically by chunk name.
    const keys = Object.keys(first.chunks);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });

  it("skips sourcemaps and the manifest file itself", async () => {
    const { generateBundleManifest } = await import(
      resolve(SCRIPTS_DIR, "generate-bundle-manifest.mjs") 
    );

    const root = mkdtempSync(join(tmpdir(), "bundle-skip-"));
    writeFileSync(join(root, "popup.js"), "console.log('x')\n");
    // These should NOT appear in the manifest.
    writeFileSync(join(root, "popup.js.map"), "{\"sources\":[]}");
    writeFileSync(join(root, "_bundle-manifest.json"), "{}");
    // Image files are out of scope for JS/CSS regression tracking.
    writeFileSync(join(root, "icon.png"), "PNG\n");

    const manifest = await generateBundleManifest({
      distDir: root,
      clock: () => "2026-04-20T00:00:00.000Z",
      commit: "test-sha",
    });
    expect(Object.keys(manifest.chunks)).toEqual(["popup.js"]);
  });

  it("throws if dist/ is missing", async () => {
    const { generateBundleManifest } = await import(
      resolve(SCRIPTS_DIR, "generate-bundle-manifest.mjs") 
    );
    await expect(
      generateBundleManifest({ distDir: "/does/not/exist/anywhere" }),
    ).rejects.toThrow(/not found/);
  });
});

/* ── compareBundle ─────────────────────────────────────────────── */

describe("compareBundle", () => {
  it("flags a chunk that grew 15%", async () => {
    const { compareBundle } = await import(
      resolve(SCRIPTS_DIR, "compare-bundle.mjs") 
    );

    const baseline = fakeManifest();
    const current = fakeManifest({
      chunks: {
        ...baseline.chunks,
        // +15 % on popup.js gzip (30000 → 34500)
        "popup.js": {
          raw: 115_000,
          gzip: 34_500,
          brotli: 30_000,
          sha256: "z".repeat(64),
        },
      },
    });
    // Recompute totals.
    current.totals.gzip = Object.values(current.chunks).reduce((s, v) => s + v.gzip, 0);
    current.totals.raw = Object.values(current.chunks).reduce((s, v) => s + v.raw, 0);
    current.totals.brotli = Object.values(current.chunks).reduce((s, v) => s + v.brotli, 0);

    const summary = compareBundle({ baseline, current });
    expect(summary.regressions.length).toBe(1);
    expect(summary.regressions[0].name).toBe("popup.js");
    // Per-chunk regression → exit code 1, unless total threshold triggers 2.
    expect([1, 2]).toContain(summary.exitCode);
  });

  it("passes a 9% increase (below threshold)", async () => {
    const { compareBundle } = await import(
      resolve(SCRIPTS_DIR, "compare-bundle.mjs") 
    );

    const baseline = fakeManifest();
    const current = fakeManifest({
      chunks: {
        ...baseline.chunks,
        "popup.js": {
          raw: 109_000,
          gzip: Math.round(30_000 * 1.09), // +9 %
          brotli: 28_000,
          sha256: "y".repeat(64),
        },
      },
    });
    current.totals.gzip = Object.values(current.chunks).reduce((s, v) => s + v.gzip, 0);

    const summary = compareBundle({ baseline, current });
    expect(summary.regressions.length).toBe(0);
    expect(summary.exitCode).toBe(0);
  });

  it("handles new chunks without flagging them as regressions", async () => {
    const { compareBundle } = await import(
      resolve(SCRIPTS_DIR, "compare-bundle.mjs") 
    );

    const baseline = fakeManifest();
    const current = fakeManifest({
      chunks: {
        ...baseline.chunks,
        "chunks/new-route.js": {
          raw: 5_000,
          gzip: 1_500,
          brotli: 1_200,
          sha256: "n".repeat(64),
        },
      },
    });
    current.totals.gzip = Object.values(current.chunks).reduce((s, v) => s + v.gzip, 0);

    const summary = compareBundle({ baseline, current });
    const newRow = summary.rows.find((r: { name: string }) => r.name === "chunks/new-route.js");
    expect(newRow?.status).toBe("new");
    expect(newRow?.regressed).toBe(false);
    expect(summary.exitCode).toBe(0);
  });

  it("handles deleted chunks cleanly", async () => {
    const { compareBundle } = await import(
      resolve(SCRIPTS_DIR, "compare-bundle.mjs") 
    );

    const baseline = fakeManifest();
    const current = fakeManifest({
      chunks: {
        "popup.js": baseline.chunks["popup.js"],
        "background.js": baseline.chunks["background.js"],
        // chunks/send.js removed
      },
    });
    current.totals.gzip = Object.values(current.chunks).reduce((s, v) => s + v.gzip, 0);

    const summary = compareBundle({ baseline, current });
    const deletedRow = summary.rows.find(
      (r: { name: string }) => r.name === "chunks/send.js",
    );
    expect(deletedRow?.status).toBe("deleted");
    expect(deletedRow?.regressed).toBe(false);
    expect(summary.exitCode).toBe(0);
  });

  it("returns exit code 2 when aggregate gzip total grows past 5%", async () => {
    const { compareBundle } = await import(
      resolve(SCRIPTS_DIR, "compare-bundle.mjs") 
    );

    // Every chunk grows 6 % — individually below the per-chunk 10 %
    // threshold, but aggregate should trip the 5 % total gate.
    const baseline = fakeManifest();
    const grown: Record<string, ManifestEntry> = {};
    for (const [name, entry] of Object.entries(baseline.chunks)) {
      grown[name] = {
        raw: Math.round(entry.raw * 1.06),
        gzip: Math.round(entry.gzip * 1.06),
        brotli: Math.round(entry.brotli * 1.06),
        sha256: entry.sha256,
      };
    }
    const current = fakeManifest({
      chunks: grown,
      totals: {
        raw: Object.values(grown).reduce((s, v) => s + v.raw, 0),
        gzip: Object.values(grown).reduce((s, v) => s + v.gzip, 0),
        brotli: Object.values(grown).reduce((s, v) => s + v.brotli, 0),
      },
    });

    const summary = compareBundle({ baseline, current });
    expect(summary.regressions.length).toBe(0); // none individually
    expect(summary.totals.regressed).toBe(true);
    expect(summary.exitCode).toBe(2);
  });

  it("rejects manifests with missing chunks field", async () => {
    const { compareBundle } = await import(
      resolve(SCRIPTS_DIR, "compare-bundle.mjs") 
    );
    expect(() =>
      compareBundle({ baseline: {}, current: fakeManifest() }),
    ).toThrow(/baseline manifest is missing/);
    expect(() =>
      compareBundle({ baseline: fakeManifest(), current: {} }),
    ).toThrow(/current manifest is missing/);
  });

  it("allows a custom perChunkThreshold", async () => {
    const { compareBundle } = await import(
      resolve(SCRIPTS_DIR, "compare-bundle.mjs") 
    );

    const baseline = fakeManifest();
    const current = fakeManifest({
      chunks: {
        ...baseline.chunks,
        "popup.js": {
          ...baseline.chunks["popup.js"],
          gzip: Math.round(30_000 * 1.12), // +12 %
        },
      },
    });
    current.totals.gzip = Object.values(current.chunks).reduce((s, v) => s + v.gzip, 0);

    const strict = compareBundle({ baseline, current, perChunkThreshold: 0.05 });
    expect(strict.regressions.length).toBe(1);

    const lax = compareBundle({ baseline, current, perChunkThreshold: 0.20 });
    expect(lax.regressions.length).toBe(0);
  });
});

/* ── renderMarkdown ────────────────────────────────────────────── */

describe("renderMarkdown", () => {
  it("renders a well-formed markdown table", async () => {
    const { compareBundle, renderMarkdown } = await import(
      resolve(SCRIPTS_DIR, "compare-bundle.mjs") 
    );

    const baseline = fakeManifest();
    const current = fakeManifest({
      chunks: {
        ...baseline.chunks,
        "popup.js": {
          ...baseline.chunks["popup.js"],
          gzip: Math.round(30_000 * 1.20), // +20 % → regression
        },
      },
    });
    current.totals.gzip = Object.values(current.chunks).reduce((s, v) => s + v.gzip, 0);

    const md = renderMarkdown(compareBundle({ baseline, current }));
    expect(md).toContain("## Bundle Size Impact");
    expect(md).toMatch(/\| popup\.js \|/);
    expect(md).toMatch(/\*\*TOTAL \(gzip\):/);
    expect(md).toMatch(/REGRESSIONS/);
  });

  it("shows a green checkmark when no regression", async () => {
    const { compareBundle, renderMarkdown } = await import(
      resolve(SCRIPTS_DIR, "compare-bundle.mjs") 
    );

    const baseline = fakeManifest();
    const md = renderMarkdown(compareBundle({ baseline, current: baseline }));
    expect(md).toContain(":white_check_mark:");
    // Table should still be well-formed even with no changes.
    expect(md).toContain("## Bundle Size Impact");
  });
});

/* ── post-bundle-comment helpers ───────────────────────────────── */

describe("post-bundle-comment helpers", () => {
  it("buildCommentBody prepends a sticky marker", async () => {
    const { buildCommentBody } = await import(
      resolve(SCRIPTS_DIR, "post-bundle-comment.mjs") 
    );
    const body = buildCommentBody("hello world");
    expect(body.startsWith("<!-- aethelred-bundle-gate:do-not-edit -->")).toBe(true);
    expect(body).toContain("hello world");
  });

  it("resolvePrNumber extracts PR number from pull_request event", async () => {
    const { resolvePrNumber } = await import(
      resolve(SCRIPTS_DIR, "post-bundle-comment.mjs") 
    );
    expect(resolvePrNumber({ pull_request: { number: 42 } })).toBe(42);
    expect(resolvePrNumber({ number: 7 })).toBe(7);
    expect(resolvePrNumber({})).toBeNull();
    expect(resolvePrNumber(null)).toBeNull();
  });

  it("postBundleComment creates a new comment when none exists", async () => {
    const { postBundleComment } = await import(
      resolve(SCRIPTS_DIR, "post-bundle-comment.mjs") 
    );

    const calls: Array<{ url: string; method: string }> = [];
    const fakeFetch = async (url: string, opts: { method?: string } = {}) => {
      calls.push({ url, method: opts.method ?? "GET" });
      if (opts.method === undefined || opts.method === "GET") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => [], // no existing comments
        };
      }
      if (opts.method === "POST") {
        return {
          ok: true,
          status: 201,
          statusText: "Created",
          json: async () => ({ id: 999 }),
        };
      }
      throw new Error(`unexpected method ${opts.method}`);
    };

    const result = await postBundleComment({
      markdown: "test-report",
      repo: "acme/wallet",
      prNumber: 42,
      token: "fake-token",
      fetchFn: fakeFetch,
    });
    expect(result.action).toBe("created");
    expect(result.id).toBe(999);
    expect(calls.some((c) => c.method === "POST")).toBe(true);
  });

  it("postBundleComment updates an existing comment when the marker is present", async () => {
    const { postBundleComment } = await import(
      resolve(SCRIPTS_DIR, "post-bundle-comment.mjs") 
    );

    const calls: Array<{ url: string; method: string }> = [];
    const fakeFetch = async (url: string, opts: { method?: string } = {}) => {
      calls.push({ url, method: opts.method ?? "GET" });
      if (opts.method === undefined || opts.method === "GET") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => [
            {
              id: 12345,
              body:
                "<!-- aethelred-bundle-gate:do-not-edit -->\n(old report)",
            },
          ],
        };
      }
      if (opts.method === "PATCH") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ id: 12345 }),
        };
      }
      throw new Error(`unexpected method ${opts.method}`);
    };

    const result = await postBundleComment({
      markdown: "updated-report",
      repo: "acme/wallet",
      prNumber: 42,
      token: "fake-token",
      fetchFn: fakeFetch,
    });
    expect(result.action).toBe("updated");
    expect(result.id).toBe(12345);
    expect(calls.some((c) => c.method === "PATCH")).toBe(true);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});
