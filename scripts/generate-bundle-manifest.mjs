#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * generate-bundle-manifest.mjs — deterministic bundle size manifest
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Walks `apps/extension/dist/` after a production build and emits
 * `apps/extension/dist/_bundle-manifest.json` — a sorted, stable map of
 * every shipping `.js`/`.css` asset with its raw, gzip, and brotli sizes.
 *
 * This manifest is the ground truth consumed by:
 *
 *   • `compare-bundle.mjs`         — per-chunk regression gate in CI
 *   • `post-bundle-comment.mjs`    — sticky PR comment on pull requests
 *   • `bundle-diff.mjs`            — local diff between git refs
 *   • `bundle:baseline:update`     — promotes current manifest to baseline
 *
 * Determinism contract
 * --------------------
 * The ONLY non-deterministic fields in the output are `generatedAt` and
 * `commit`. Chunk entries are sorted alphabetically; total sums are
 * computed once at the end. Two invocations against the same `dist/`
 * MUST produce byte-identical output apart from those two fields.
 *
 * We rely on that property in two ways:
 *
 *   1. `bundle:compare` diffs the baseline manifest (committed in
 *      `reports/bundle-baseline.json`) against the current manifest.
 *      Noise in the manifest would cause false-positive CI failures.
 *   2. The manifest is uploaded as a CI artifact and consumed by
 *      downstream tooling (release notes, dashboards). Stable sort
 *      order is required for stable diffs across branches.
 *
 * Why not just use `size-limit`?
 * ------------------------------
 * `size-limit` is a pass/fail gate against absolute budgets. It tells us
 * "popup.js is over 100 kB" but NOT "popup.js grew 12 % between this PR
 * and main." Modern wallets need both signals:
 *
 *   • Absolute budgets (size-limit) — never exceed install size caps.
 *   • Relative drift (this script)  — catch unintended regressions
 *                                     before they compound.
 *
 * Exit codes
 * ----------
 *   0 — manifest written successfully
 *   1 — `dist/` missing, empty, or unreadable (build probably never ran)
 *
 * Owner: wallet-extension team. See docs/engineering/BUNDLE_BUDGETS.md.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, brotliCompressSync, constants as zlibConstants } from "node:zlib";
import process from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_DIST = resolve(REPO_ROOT, "apps", "extension", "dist");
const DEFAULT_OUTPUT = resolve(DEFAULT_DIST, "_bundle-manifest.json");

/** File extensions the manifest tracks. Other assets (images, html,
 *  json) are measured by size-limit separately; this script is
 *  specifically for JS/CSS regression tracking.
 */
const TRACKED_EXTENSIONS = new Set([".js", ".css"]);

/** Files to ignore even if they match an extension. `_bundle-manifest.json`
 *  self-references would flap the manifest on every run. sourcemaps are
 *  not shipped.
 */
const IGNORE_NAMES = new Set(["_bundle-manifest.json"]);
const IGNORE_EXTENSIONS = new Set([".map"]);

/** Parse --key value CLI flags into a plain object. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

/** Resolve the git SHA of HEAD. Returns "unknown" if we are not in a
 *  git working tree (e.g., when running from an unpacked tarball in CI).
 *  Uses `execFileSync` — no shell, no user input, fixed argv.
 */
function resolveCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

/** Recursive directory walk. Returns absolute file paths matching
 *  TRACKED_EXTENSIONS, skipping anything in IGNORE_*. Deterministic
 *  traversal order: directories are sorted alphabetically before recursion.
 */
async function walkDir(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // Push directories first so we pop files next (maintains sorted iteration
    // via the stack). Since we sort-then-reverse-push-dirs, file paths emerge
    // in a stable order regardless of filesystem listing order.
    const subdirs = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        subdirs.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (IGNORE_NAMES.has(entry.name)) continue;
      const dot = entry.name.lastIndexOf(".");
      const ext = dot >= 0 ? entry.name.slice(dot) : "";
      if (IGNORE_EXTENSIONS.has(ext)) continue;
      if (!TRACKED_EXTENSIONS.has(ext)) continue;
      out.push(full);
    }
    // Push subdirs in reverse so alphabetical order is preserved on stack pop.
    for (let i = subdirs.length - 1; i >= 0; i--) {
      stack.push(subdirs[i]);
    }
  }
  out.sort();
  return out;
}

/** Compute raw, gzip, and brotli byte sizes for a single file. Brotli uses
 *  quality 11 (maximum) to match what Chrome Web Store's CDN negotiates.
 */
async function measureFile(absPath) {
  const buf = await readFile(absPath);
  const raw = buf.length;
  const gzip = gzipSync(buf, { level: 9 }).length;
  const brotli = brotliCompressSync(buf, {
    params: {
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  }).length;
  const sha256 = createHash("sha256").update(buf).digest("hex");
  return { raw, gzip, brotli, sha256 };
}

/** Produce the manifest object from a `dist/` directory. Pure function
 *  up to the provided `clock` + `commit` injection — the tests rely on
 *  deterministic output when these are held constant.
 */
export async function generateBundleManifest({
  distDir = DEFAULT_DIST,
  clock = () => new Date().toISOString(),
  commit = resolveCommit(),
} = {}) {
  if (!existsSync(distDir)) {
    throw new Error(
      `dist directory not found: ${distDir} — did you run 'npm run build --workspace @aethelred/wallet-extension'?`,
    );
  }
  const distStat = await stat(distDir);
  if (!distStat.isDirectory()) {
    throw new Error(`not a directory: ${distDir}`);
  }

  const files = await walkDir(distDir);
  if (files.length === 0) {
    throw new Error(`no .js/.css files found under ${distDir}`);
  }

  const chunks = {};
  let totalRaw = 0;
  let totalGzip = 0;
  let totalBrotli = 0;

  for (const abs of files) {
    const rel = relative(distDir, abs).split(sep).join("/");
    const sizes = await measureFile(abs);
    chunks[rel] = {
      raw: sizes.raw,
      gzip: sizes.gzip,
      brotli: sizes.brotli,
      sha256: sizes.sha256,
    };
    totalRaw += sizes.raw;
    totalGzip += sizes.gzip;
    totalBrotli += sizes.brotli;
  }

  // Re-sort chunk keys alphabetically to lock down the output order
  // regardless of how the walker pushed them.
  const sortedChunks = Object.fromEntries(
    Object.keys(chunks)
      .sort()
      .map((k) => [k, chunks[k]]),
  );

  return {
    generatedAt: clock(),
    commit,
    chunks: sortedChunks,
    totals: {
      raw: totalRaw,
      gzip: totalGzip,
      brotli: totalBrotli,
    },
  };
}

/** JSON serializer that guarantees stable key ordering for the manifest
 *  (both at the top level and inside `chunks`). `JSON.stringify` with a
 *  literal replacer can reorder via insertion order; this helper fixes
 *  the schema explicitly so two identical manifests are byte-identical.
 */
export function serializeManifest(manifest) {
  const orderedChunks = {};
  for (const name of Object.keys(manifest.chunks).sort()) {
    const entry = manifest.chunks[name];
    orderedChunks[name] = {
      raw: entry.raw,
      gzip: entry.gzip,
      brotli: entry.brotli,
      sha256: entry.sha256,
    };
  }
  const ordered = {
    generatedAt: manifest.generatedAt,
    commit: manifest.commit,
    chunks: orderedChunks,
    totals: {
      raw: manifest.totals.raw,
      gzip: manifest.totals.gzip,
      brotli: manifest.totals.brotli,
    },
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** CLI entrypoint. Only runs when invoked as `node generate-bundle-manifest.mjs`. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const distDir = args.dist ? resolve(args.dist) : DEFAULT_DIST;
  const outputPath = args.output ? resolve(args.output) : DEFAULT_OUTPUT;

  try {
    const manifest = await generateBundleManifest({ distDir });
    const json = serializeManifest(manifest);
    await writeFile(outputPath, json, "utf8");
    const kb = (n) => (n / 1024).toFixed(1);
    console.log(`bundle-manifest: wrote ${outputPath}`);
    console.log(
      `bundle-manifest: ${Object.keys(manifest.chunks).length} files, ` +
        `raw ${kb(manifest.totals.raw)} KB, ` +
        `gzip ${kb(manifest.totals.gzip)} KB, ` +
        `brotli ${kb(manifest.totals.brotli)} KB`,
    );
  } catch (err) {
    console.error(`bundle-manifest: ${err.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
