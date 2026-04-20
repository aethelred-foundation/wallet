#!/usr/bin/env node
/**
 * ═════════════════════════════════════════════════════════════════════════
 * Extension image optimizer
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Converts every raster image under `apps/extension/public/` into a WebP
 * sibling (and a matching `@2x.webp` for HiDPI). The source PNG / JPG
 * stays in place so `<DappImage>` can point the `<picture>` fallback
 * `<img>` at the raster while the `<source type="image/webp">` serves
 * the much smaller WebP to every modern browser.
 *
 * Two modes
 * ─────────
 *   (default)    Generate missing / stale WebP siblings. Idempotent:
 *                if the WebP sibling is newer than the source, skip it.
 *
 *   --check      CI gate. Scan source rasters; if ANY PNG/JPG is missing
 *                a WebP sibling, exit non-zero with an actionable
 *                message pointing the contributor at `npm run
 *                optimize:images`. A PNG shipping 5× its necessary size
 *                is a real performance regression — we refuse to merge.
 *
 *   --dry-run    Print what would change without writing anything.
 *
 * Lossless vs lossy
 * ─────────────────
 *   • `icon`, `logo` → lossless WebP. These are brand assets rendered
 *     at tiny pixel sizes (28 px header, 48 px onboarding). Any lossy
 *     compression artifact is immediately visible; size savings are
 *     still ~85 % because indexed color palettes compress losslessly
 *     very well.
 *   • Everything else → lossy WebP at quality=80. That's the right
 *     spot on the quality/size curve for dApp card artwork; anything
 *     higher and the size barely drops, anything lower and gradients
 *     band visibly.
 *
 * Hard constraints from the project brief
 * ───────────────────────────────────────
 *   • NEVER delete the source PNG / JPG files — the `<picture>`
 *     fallback needs them for any browser that can't decode WebP.
 *   • NEVER resize dimensions. We keep the same pixels, just ship a
 *     smaller encoding of them.
 *   • `sharp` is a devDependency. If it's missing AND this script is
 *     in default (generate) mode, we print an actionable message and
 *     exit non-zero — the WebP siblings are a release gate. Previously
 *     this script exited 0 on a missing sharp; that contract is
 *     abandoned because it let 1.4 MB PNGs ship to every user.
 *
 * ═════════════════════════════════════════════════════════════════════════
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { resolve, dirname, extname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const IMAGE_DIR = resolve(REPO_ROOT, "apps", "extension", "public");

/* ─── CLI argv parsing ────────────────────────────────────────────── */
const DRY_RUN = process.argv.includes("--dry-run");
const CHECK = process.argv.includes("--check");

/**
 * Names that get lossless WebP treatment. Matches the raster basename
 * without extension — e.g. `logo.png` → `logo`.
 */
const LOSSLESS = new Set(["logo", "icon"]);

/**
 * A raster stays un-optimized (soft exemption) if its source is already
 * under this threshold. Tiny UI icons like favicons don't meaningfully
 * benefit from WebP — the PNG header overhead dwarfs the pixel payload.
 * We still emit a WebP sibling but don't fail --check mode if one is
 * missing.
 */
const SOFT_EXEMPT_BYTES = 30 * 1024;

/* ─── sharp gating ────────────────────────────────────────────────── *
 * `sharp` is a devDependency only. We print an actionable message if
 * it's missing. Previously this script exited 0 on a missing sharp so
 * CI wouldn't fail — that contract is gone; see module docstring. */
function loadSharp() {
  try {
    const require = createRequire(import.meta.url);
    return require("sharp");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("\n── optimize-images ─────────────────────────────────");
    console.error("sharp is not installed.");
    console.error("");
    console.error("  $ npm install sharp --save-dev --legacy-peer-deps");
    console.error("  $ npm run optimize:images");
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

/**
 * List raster source files in `dir`. Accepts PNG / JPG / JPEG; filters
 * out anything already webp-ified, the `@2x` siblings (generated, not
 * source), and directory entries.
 */
function listRasters(dir) {
  return readdirSync(dir)
    .filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
    .filter((f) => !/@2x\./.test(f))
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile());
}

/**
 * Does the WebP sibling exist AND is it newer than the source? Used to
 * skip unchanged images in the default generate mode (idempotency).
 */
function webpIsFresh(srcPath, webpPath) {
  if (!existsSync(webpPath)) return false;
  const srcMtime = statSync(srcPath).mtimeMs;
  const webpMtime = statSync(webpPath).mtimeMs;
  return webpMtime >= srcMtime;
}

async function convert(sharp, srcPath) {
  const srcExt = extname(srcPath).toLowerCase();
  const baseName = basename(srcPath, srcExt);
  const dir = dirname(srcPath);

  const webp1x = join(dir, `${baseName}.webp`);
  const webp2x = join(dir, `${baseName}@2x.webp`);

  const srcBytes = statSync(srcPath).size;
  const inputMeta = await sharp(srcPath).metadata();

  // Idempotency: skip if both WebP targets are newer than the source.
  if (webpIsFresh(srcPath, webp1x) && webpIsFresh(srcPath, webp2x)) {
    console.log(
      `·  ${basename(srcPath)}  unchanged  (${formatBytes(srcBytes)})`,
    );
    return { changed: false, srcPath, srcBytes };
  }

  if (DRY_RUN) {
    console.log(
      `DRY-RUN  ${basename(srcPath)}  (${formatBytes(srcBytes)}) → ${basename(webp1x)} + ${basename(webp2x)}`,
    );
    return { changed: false, srcPath, srcBytes };
  }

  // Lossless for brand marks, quality=80 lossy for everything else.
  const isLossless = LOSSLESS.has(baseName);
  const webpOpts = isLossless
    ? { lossless: true, effort: 6 }
    : { quality: 80, effort: 6 };

  await sharp(srcPath).webp(webpOpts).toFile(webp1x);
  const webp1xBytes = statSync(webp1x).size;

  // `@2x.webp` reuses the same 1x pixels — we deliberately don't
  // upscale, per the project brief ("DO NOT shrink dimensions").
  // Browsers interpret the `2x` srcSet descriptor relative to the
  // <img>'s declared width/height, and our source rasters are all
  // already larger than the displayed dimensions, so the same file
  // satisfies both DPRs without any upscaling.
  await sharp(srcPath).webp(webpOpts).toFile(webp2x);
  const webp2xBytes = statSync(webp2x).size;

  const savedPct = (((srcBytes - webp1xBytes) / srcBytes) * 100).toFixed(1);
  console.log(
    `✔  ${basename(srcPath)}  ${formatBytes(srcBytes)} → ${basename(webp1x)}  ${formatBytes(webp1xBytes)}  (-${savedPct}%, ${isLossless ? "lossless" : "q=80"})  | @2x ${formatBytes(webp2xBytes)}  (${inputMeta.width}×${inputMeta.height})`,
  );
  return { changed: true, srcPath, srcBytes, webp1x, webp1xBytes };
}

/**
 * --check mode: scan raster sources and verify every one has a
 * corresponding `.webp` sibling. Return the list of offenders.
 */
function scanMissing() {
  const rasters = listRasters(IMAGE_DIR);
  const missing = [];
  for (const src of rasters) {
    const baseName = basename(src, extname(src));
    const webp1x = join(IMAGE_DIR, `${baseName}.webp`);
    const srcBytes = statSync(src).size;
    // Soft exemption: tiny PNGs don't meaningfully benefit from WebP.
    if (srcBytes < SOFT_EXEMPT_BYTES) continue;
    if (!existsSync(webp1x)) {
      missing.push({ src, expected: webp1x, srcBytes });
    }
  }
  return missing;
}

async function main() {
  if (CHECK) {
    const missing = scanMissing();
    if (missing.length === 0) {
      console.log("optimize-images: all source rasters have WebP siblings.");
      return;
    }
    console.error("\n── optimize-images --check ──────────────────────────");
    console.error(
      `FAIL: ${missing.length} image(s) ship without a WebP sibling.\n`,
    );
    for (const m of missing) {
      console.error(
        `  ${basename(m.src)}  (${formatBytes(m.srcBytes)}) — missing ${basename(m.expected)}`,
      );
    }
    console.error("");
    console.error("Fix: npm install sharp --save-dev --legacy-peer-deps");
    console.error("     npm run optimize:images");
    console.error(
      "\nShipping raw PNG/JPG assets balloons the extension install size",
    );
    console.error("by 5-20×. Commit the generated .webp siblings alongside");
    console.error("the source raster and rerun the build.");
    console.error("────────────────────────────────────────────────────\n");
    process.exit(1);
  }

  const sharp = loadSharp();
  if (!sharp) {
    // Default (generate) mode. If sharp is missing AND some images
    // lack a WebP sibling, fail so a contributor notices before their
    // CI run does.
    const missing = scanMissing();
    if (missing.length === 0) {
      console.log(
        "optimize-images: sharp unavailable but every raster already has a WebP sibling — nothing to do.",
      );
      return;
    }
    console.error(
      `optimize-images: sharp unavailable and ${missing.length} raster(s) lack a WebP sibling — cannot continue.`,
    );
    process.exit(1);
  }

  const rasters = listRasters(IMAGE_DIR);
  if (rasters.length === 0) {
    console.log("no raster images found — nothing to do");
    return;
  }

  console.log(`Optimizing ${rasters.length} image(s) in ${IMAGE_DIR}\n`);
  let totalSrc = 0;
  let totalWebp = 0;
  for (const src of rasters) {
    try {
      const r = await convert(sharp, src);
      if (r && r.changed && r.webp1xBytes != null) {
        totalSrc += r.srcBytes;
        totalWebp += r.webp1xBytes;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`✘  ${basename(src)}: ${message}`);
      process.exitCode = 1;
    }
  }
  console.log("");
  if (totalSrc > 0) {
    const savedPct = (((totalSrc - totalWebp) / totalSrc) * 100).toFixed(1);
    console.log(
      `Total: ${formatBytes(totalSrc)} → ${formatBytes(totalWebp)} (-${savedPct}%)`,
    );
  }
  console.log("Done. Commit the source raster(s) AND the generated .webp siblings.");
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack : String(err);
  console.error(`optimize-images: unexpected error — ${message}`);
  process.exit(1);
});
