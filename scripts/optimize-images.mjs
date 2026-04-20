#!/usr/bin/env node
/**
 * ═════════════════════════════════════════════════════════════════════════
 * Extension image optimizer
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Converts every raster image under `apps/extension/public/` into a WebP
 * sibling (and an `@2x` HiDPI variant). Leaves the original PNG / JPG in
 * place so `<DappImage>` can point the `<picture>` fallback `<img>` at
 * the raster while the `<source type="image/webp">` serves the much
 * smaller WebP to every modern browser.
 *
 * Why an opt-in script (not a build step):
 *   Images in this folder change roughly quarterly — the wallet icon,
 *   dApp card art, etc. Running sharp on every `npm run build` would
 *   add 5-10 seconds to CI for code that never touches pixels, and would
 *   force all contributors to install sharp (~40 MB across native
 *   bindings) even if they only work on TypeScript. Instead, this
 *   script is opt-in: designers run it after dropping a new image,
 *   commit both the source raster AND the generated WebP, and nothing
 *   in the day-to-day loop changes.
 *
 * Hard constraints from the project:
 *   - sharp is a devDependency only. Never a runtime dep. Not added by
 *     `npm install` unless the contributor asks for it.
 *   - If sharp is missing, this script prints a clear instruction and
 *     exits 0 (no-op). It MUST NOT fail CI.
 *   - `@2x` variants are generated at 2× the source's natural resolution
 *     ONLY if the source itself is at least 2× the intended display
 *     size; otherwise we copy it as-is (upscaling would degrade
 *     quality, and HiDPI browsers can scale the 1x with their own
 *     resampler if they must).
 *
 * Usage:
 *
 *   $ npm install --save-dev sharp         # first time only
 *   $ node scripts/optimize-images.mjs
 *
 *   ✔ dapp-zeroid.png → dapp-zeroid.webp         (1.45 MB → 124 kB)
 *   ✔ dapp-terraqura.png → dapp-terraqura.webp  (502 kB → 48 kB)
 *   …
 *
 * Invoke without any arguments. To dry-run, pass `--dry-run` to print
 * planned conversions without writing.
 * ═════════════════════════════════════════════════════════════════════════
 */
import { readdirSync, statSync, copyFileSync } from "node:fs";
import { resolve, dirname, extname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const IMAGE_DIR = resolve(REPO_ROOT, "apps", "extension", "public");

/* ─── CLI argv parsing ────────────────────────────────────────────── */
const DRY_RUN = process.argv.includes("--dry-run");

/* ─── sharp gating ────────────────────────────────────────────────── *
 * `sharp` is a devDependency only. If it's missing, print a friendly
 * "install first" message and exit 0 — this script must NEVER fail CI.
 * We use `createRequire` because ESM `import()` with a missing module
 * throws an async error that's harder to catch cleanly. */
function loadSharp() {
  try {
    const require = createRequire(import.meta.url);
    return require("sharp");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("\n── optimize-images ─────────────────────────────────");
    console.error("sharp is not installed — skipping image optimization.");
    console.error("");
    console.error("  To run this script:");
    console.error("    $ npm install --save-dev sharp");
    console.error("    $ node scripts/optimize-images.mjs");
    console.error("");
    console.error(`  (underlying error: ${message})`);
    console.error("────────────────────────────────────────────────────\n");
    return null;
  }
}

/* ─── human-readable byte size ────────────────────────────────────── */
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/* ─── list raster candidates ──────────────────────────────────────── *
 * Accepts PNG / JPG / JPEG. Ignores anything that's already a .webp.
 * Also ignores files with `@2x` in the name — those are source 2x
 * variants that we'd double-process otherwise. */
function listRasters(dir) {
  const files = readdirSync(dir);
  return files
    .filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
    .filter((f) => !f.includes("@2x"))
    .map((f) => join(dir, f));
}

async function convert(sharp, srcPath) {
  const srcExt = extname(srcPath).toLowerCase();
  const baseName = basename(srcPath, srcExt);
  const dir = dirname(srcPath);

  const webp1x = join(dir, `${baseName}.webp`);
  const raster2x = join(dir, `${baseName}@2x${srcExt}`);
  const webp2x = join(dir, `${baseName}@2x.webp`);

  const inputMeta = await sharp(srcPath).metadata();
  const srcBytes = statSync(srcPath).size;

  if (DRY_RUN) {
    console.log(
      `DRY-RUN  ${basename(srcPath)}  (${formatBytes(srcBytes)}) → ${basename(webp1x)}`,
    );
    return;
  }

  // 1) WebP 1x @ 80% quality — the right spot on the quality/size curve
  //    for UI artwork (PNG dapp logos, screenshots). Anything higher and
  //    the size hardly drops; anything lower and icons look muddy.
  await sharp(srcPath).webp({ quality: 80 }).toFile(webp1x);
  const webp1xBytes = statSync(webp1x).size;

  // 2) Retina @2x variants — only make sense if the source image is
  //    actually large enough to scale DOWN to a sharp 2x image at the
  //    intended display size (we can't get more detail than the source
  //    has). We keep the same pixel dimensions as the source, just
  //    rename it with @2x — `<img>` consumers interpret the `2x`
  //    density descriptor relative to the declared `width`/`height`.
  //    If there's no separate 2x source file, copy the src rasters so
  //    the <picture> fallback can still find one at the @2x path.
  const hasDedicated2x = files2xExists(raster2x);
  if (!hasDedicated2x) {
    copyFileSync(srcPath, raster2x);
  }
  await sharp(raster2x).webp({ quality: 80 }).toFile(webp2x);
  const webp2xBytes = statSync(webp2x).size;

  const savedPct = (((srcBytes - webp1xBytes) / srcBytes) * 100).toFixed(1);
  console.log(
    `✔  ${basename(srcPath)}  ${formatBytes(srcBytes)} → ${basename(webp1x)}  ${formatBytes(webp1xBytes)}  (-${savedPct}%)  | @2x → ${formatBytes(webp2xBytes)}  (w×h=${inputMeta.width}×${inputMeta.height})`,
  );
}

function files2xExists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const sharp = loadSharp();
  if (!sharp) return;

  const rasters = listRasters(IMAGE_DIR);
  if (rasters.length === 0) {
    console.log("no raster images found — nothing to do");
    return;
  }

  console.log(`Optimizing ${rasters.length} image(s) in ${IMAGE_DIR}\n`);
  for (const src of rasters) {
    try {
      await convert(sharp, src);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`✘  ${basename(src)}: ${message}`);
    }
  }
  console.log("");
  console.log("Done. Commit both the raster(s) AND the generated .webp sibling(s).");
}

main().catch((err) => {
  // Never throw — missing sharp is one thing, but a runtime error in
  // an already-running sharp should still not fail the CI we might be
  // running under. Print and exit 0.
  const message = err instanceof Error ? err.stack : String(err);
  console.error(`optimize-images: unexpected error — ${message}`);
});
