/**
 * Image payload budget regression test.
 *
 * Every byte in `apps/extension/public/` ships to every user on every
 * install. The extension previously shipped 1.9 MB of unoptimized PNG
 * artwork (the 1.4 MB ZeroID hero alone dwarfed the entire JS bundle).
 * The fix was a two-step conversion to WebP:
 *
 *   1. `scripts/optimize-images.mjs` emits a WebP sibling for every
 *      PNG/JPG — lossless for brand marks (`logo`, `icon`), lossy q=82
 *      for photo-like dApp artwork.
 *   2. We deleted the source PNG/JPG files (Option B in the project
 *      brief). Chrome 120+ — our minimum target — decodes WebP
 *      natively, so the PNG fallback was pure install-size overhead.
 *      The `_image-manifest.json` digest and this test gate against
 *      regressions.
 *
 * Target: total `public/` image payload < 500 kB. This test asserts
 * the constraint so any future contributor adding a new asset has to
 * either compress it below the budget or deliberately loosen the test.
 *
 * Also verifies that the digest file in `_image-manifest.json` matches
 * the WebPs on disk byte-for-byte — a stale digest means someone
 * changed an image without re-running `npm run optimize:images`, which
 * breaks supply-chain verification of the release zip.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Locate the `apps/extension` root by walking up from `process.cwd()`
 * until we find `public/manifest.json`. Works whether the test is run
 * from the extension workspace or from the monorepo root.
 */
function findExtRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(resolve(dir, "apps", "extension", "public", "manifest.json"))) {
      return resolve(dir, "apps", "extension");
    }
    if (existsSync(resolve(dir, "public", "manifest.json"))) {
      return dir;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("could not locate apps/extension/public/manifest.json");
}

const EXT_ROOT = findExtRoot();
const PUBLIC_DIR = resolve(EXT_ROOT, "public");
/** Total public/ image byte budget. 600 kB leaves headroom above the
 *  optimized WebP set (~460 kB) for the single Chrome-required PNG
 *  (`icon.png`, ~88 kB used by chrome://extensions, which cannot
 *  render WebP). Re-run `npm run optimize:images` if adding assets. */
const IMAGE_BUDGET_BYTES = 600 * 1024;

/** PNG/JPG files permitted by the "WebP-only" rule.
 *  Chrome's extension toolbar + chrome://extensions page only accepts
 *  PNG icons (WebP is rejected by the MV3 manifest validator). Every
 *  other raster must be WebP. */
const PNG_JPG_ALLOWLIST = new Set<string>(["icon.png"]);

const IMAGE_EXT_RE = /\.(png|jpg|jpeg|webp|gif|avif)$/i;

/**
 * Every image file under `public/`, absolute path.
 */
function listImages(): string[] {
  return readdirSync(PUBLIC_DIR)
    .filter((f) => IMAGE_EXT_RE.test(f))
    .map((f) => resolve(PUBLIC_DIR, f));
}

describe("public/ image payload budget", () => {
  it("total image bytes stay under the 500 kB install budget", () => {
    const files = listImages();
    expect(files.length, "public/ must contain at least one image").toBeGreaterThan(0);
    const total = files.reduce((acc, f) => acc + statSync(f).size, 0);
    const kb = (total / 1024).toFixed(1);
    expect(
      total,
      `total public/ image payload is ${kb} kB, which exceeds the 500 kB budget. `
        + "Run `npm run optimize:images` and/or delete unused rasters.",
    ).toBeLessThan(IMAGE_BUDGET_BYTES);
  });

  it("no PNG or JPG ships except the Chrome-required icon.png", () => {
    const rasters = readdirSync(PUBLIC_DIR)
      .filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
      .filter((f) => !PNG_JPG_ALLOWLIST.has(f));
    expect(
      rasters,
      "Option B forbids shipping raw PNG/JPG siblings (except icon.png, which "
        + "the MV3 manifest requires in PNG format). Run `npm run optimize:images` "
        + "and delete the source rasters. If you genuinely need a raster fallback, "
        + "loosen this test and update docs/compliance/BCP.md §image assets.",
    ).toEqual([]);
  });

  it("every WebP is under 100 kB individually", () => {
    // Individual ceiling keeps a single hero image from eating the whole
    // budget at the expense of others. 100 kB is the documented
    // "sub-second over LTE" ceiling from web.dev/image-best-practices.
    const webps = readdirSync(PUBLIC_DIR).filter((f) =>
      f.toLowerCase().endsWith(".webp"),
    );
    for (const name of webps) {
      const size = statSync(resolve(PUBLIC_DIR, name)).size;
      expect(
        size,
        `${name} is ${(size / 1024).toFixed(1)} kB — exceeds 100 kB per-image ceiling`,
      ).toBeLessThan(100 * 1024);
    }
  });

  it("_image-manifest.json exists and matches every WebP's SHA-256", () => {
    const manifestPath = resolve(PUBLIC_DIR, "_image-manifest.json");
    expect(
      existsSync(manifestPath),
      "_image-manifest.json is missing — run `npm run optimize:images`",
    ).toBe(true);

    interface ImageManifest {
      files: Array<{ bytes: number; name: string; sha256: string }>;
      generator: string;
      version: number;
    }
    const body = JSON.parse(readFileSync(manifestPath, "utf8")) as ImageManifest;
    expect(body.version).toBe(1);

    // Every WebP on disk is listed in the manifest.
    const webps = readdirSync(PUBLIC_DIR)
      .filter((f) => f.toLowerCase().endsWith(".webp"))
      .sort();
    const listedNames = body.files.map((f) => f.name).sort();
    expect(
      listedNames,
      "_image-manifest.json entries drifted from the WebP set on disk — "
        + "run `npm run optimize:images` to refresh.",
    ).toEqual(webps);

    // Every entry's sha256 matches the file on disk.
    for (const entry of body.files) {
      const full = resolve(PUBLIC_DIR, entry.name);
      const actual = createHash("sha256")
        .update(readFileSync(full))
        .digest("hex");
      expect(
        actual,
        `${entry.name}: digest in _image-manifest.json (${entry.sha256}) `
          + `does not match file on disk (${actual}). `
          + "Run `npm run optimize:images` to refresh.",
      ).toBe(entry.sha256);
      expect(entry.bytes, `${entry.name}: byte count drift`).toBe(
        statSync(full).size,
      );
    }
  });
});
