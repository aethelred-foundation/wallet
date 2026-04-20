#!/usr/bin/env node
/**
 * ═════════════════════════════════════════════════════════════════════════
 * Chrome Web Store + manifest icon generator
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Produces the PNG icon set needed for:
 *   (1) `store/chrome-web-store/assets/icons/128.png` — the 128×128
 *       store icon required on the CWS listing. Source `icon.png` is
 *       88 kB at 512×501, which is both oversized for the slot and
 *       over the CWS 50 kB soft recommendation for store icons. This
 *       script re-encodes it at exactly 128×128 with the right
 *       compression to land under 50 kB.
 *   (2) `store/chrome-web-store/assets/icons/{16,32,48,128}.png` —
 *       the manifest V3 "action / toolbar" icon sizes. A single
 *       128.png can be scaled at runtime by Chrome, but shipping the
 *       pre-rasterized ladder gives sharper small-size rendering
 *       (especially at 16 px where subpixel aliasing from a
 *       browser-scaled down 128 px source looks noticeably fuzzy).
 *
 * We generate these to the store directory (not the extension's
 * `public/`) because:
 *   - The extension already has its own `icon.png` referenced by
 *     `manifest.json`; re-writing it from a script would be both
 *     out of scope and confusingly non-deterministic.
 *   - CWS store listings need their own copy — reviewers pull from
 *     the `store/chrome-web-store/assets/` directory where the
 *     listing copy, permissions justifications, and privacy policy
 *     also live.
 *   - If later we want the extension manifest to reference the
 *     pre-rasterized ladder (smaller install size, sharper icons),
 *     it's one import line change — the artifacts are ready.
 *
 * ═════════════════════════════════════════════════════════════════════════
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SOURCE = resolve(REPO_ROOT, "apps", "extension", "public", "icon.png");
const OUT_DIR = resolve(
  REPO_ROOT,
  "store",
  "chrome-web-store",
  "assets",
  "icons",
);

const SIZES = [16, 32, 48, 128];

/** CWS recommends the store icon stay under 50 kB. */
const STORE_ICON_MAX_BYTES = 50 * 1024;

function loadSharp() {
  try {
    const require = createRequire(import.meta.url);
    return require("sharp");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("\n── generate-store-icons ─────────────────────────────");
    console.error("sharp is not installed — cannot generate store icons.");
    console.error("");
    console.error("  $ npm install sharp --save-dev --legacy-peer-deps");
    console.error("  $ npm run generate:store-icons");
    console.error("");
    console.error(`  (underlying error: ${message})`);
    console.error("────────────────────────────────────────────────────\n");
    return null;
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function main() {
  if (!existsSync(SOURCE)) {
    console.error(`generate-store-icons: source missing — ${SOURCE}`);
    process.exit(1);
  }

  const sharp = loadSharp();
  if (!sharp) {
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Source: ${SOURCE}`);
  const srcMeta = await sharp(SOURCE).metadata();
  console.log(`  ${srcMeta.width}×${srcMeta.height}, ${srcMeta.format}`);
  console.log(`  → ${OUT_DIR}\n`);

  let over = false;
  for (const size of SIZES) {
    const out = resolve(OUT_DIR, `${size}.png`);
    await sharp(SOURCE)
      .resize(size, size, {
        // The source icon is 512×501 — not perfectly square. Fitting
        // `cover` would crop 1 px off one edge; `contain` would add
        // a transparent band; `fill` stretches. For brand marks at
        // 16-128 px, a 1 px asymmetry is invisible but a stretched
        // mark is ugly — so we use `inside` with a centred padding
        // that keeps the full mark visible, same as Chrome itself
        // renders when you supply a non-square icon to the manifest.
        fit: "inside",
        withoutEnlargement: false,
      })
      .extend({
        // Center the resized icon on a square canvas. Transparent
        // background so the CWS can use it on any store background.
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      // A 1-bit PNG-8 palette gives the smallest file for a brand
      // mark without any visible banding. compressionLevel=9 is
      // worth the extra encoding time (sub-second) for an asset
      // that ships millions of times.
      .png({
        compressionLevel: 9,
        palette: size <= 48, // palette OK at small sizes
      })
      .toFile(out);

    const bytes = statSync(out).size;
    const mark =
      size === 128 && bytes > STORE_ICON_MAX_BYTES ? " ⚠ over 50 kB" : "";
    if (size === 128 && bytes > STORE_ICON_MAX_BYTES) over = true;
    console.log(`  ✔ ${size}.png  ${formatBytes(bytes)}${mark}`);
  }

  if (over) {
    console.error(
      "\n128.png is over the CWS 50 kB recommendation. Review the source icon.",
    );
    process.exit(1);
  }
  console.log(
    "\nDone. Commit the icons under store/chrome-web-store/assets/icons/.",
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack : String(err);
  console.error(`generate-store-icons: unexpected error — ${message}`);
  process.exit(1);
});
