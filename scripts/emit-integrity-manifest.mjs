#!/usr/bin/env node
/**
 * Aethelred Wallet — build-time integrity manifest emitter.
 *
 * Runs AFTER `vite build` as a post-build step. Walks the extension's
 * `dist/` directory, computes SHA-256 for every file, and writes a
 * deterministic `dist/_integrity.json` file with the mapping from
 * forward-slash-normalised relative path to hex hash.
 *
 * The file looks like:
 *
 *   {
 *     "version": 1,
 *     "algorithm": "sha256",
 *     "files": {
 *       "background.js": "…",
 *       "content.js":    "…",
 *       "inpage.js":     "…",
 *       ...
 *     }
 *   }
 *
 * Deterministic-build contract
 * ────────────────────────────
 *   - Every key is sorted lexicographically — no map-insertion-order
 *     leaks into the output.
 *   - No timestamps in the payload — re-running produces byte-identical
 *     JSON.
 *   - Trailing newline, LF-only line endings, 2-space indentation.
 *   - `_integrity.json` is intentionally NOT included in its own
 *     hash list (it describes every OTHER file in dist/).
 *   - We also intentionally skip `SHA256SUMS` (the packaging script
 *     writes that file later) so the ordering of the two steps does
 *     not affect the integrity file.
 *
 * Intentionally dependency-free. Uses only Node's `node:fs` and
 * `node:crypto`.
 */

import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const EXT_DIR = resolve(REPO_ROOT, "apps", "extension");
const DIST_DIR = resolve(EXT_DIR, "dist");

/** File name of the emitted manifest, relative to `dist/`. */
export const INTEGRITY_MANIFEST_NAME = "_integrity.json";

/** File name of the packaging-script checksum manifest (skipped). */
const PACKAGE_SHA_SUMS = "SHA256SUMS";

/**
 * Recursively walk a directory and return every file under it as an
 * array of absolute paths. Deterministic: `readdirSync` on most OSes
 * does not guarantee sorted order, so callers must sort the result if
 * they want reproducibility.
 */
export function walkDir(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkDir(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Compute SHA-256 of a file and return hex-encoded lowercase.
 */
export function sha256OfFile(path) {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

/**
 * Build the integrity manifest for the given dist directory.
 *
 * Returns the object (for tests) AND writes the JSON file as a side
 * effect when `writeToDisk` is true.
 */
export function buildIntegrityManifest(distDir, { writeToDisk = true } = {}) {
  if (!existsSync(distDir)) {
    throw new Error(`dist/ does not exist at ${distDir}`);
  }

  // Gather every file, skipping the two files that describe the rest.
  const absPaths = walkDir(distDir)
    .filter((p) => {
      const rel = relative(distDir, p).split(sep).join("/");
      return rel !== INTEGRITY_MANIFEST_NAME && rel !== PACKAGE_SHA_SUMS;
    })
    .sort();

  const files = {};
  for (const abs of absPaths) {
    const rel = relative(distDir, abs).split(sep).join("/");
    files[rel] = sha256OfFile(abs);
  }

  // Re-sort keys so the insertion order is purely alphabetical even if
  // the filesystem walk returned a different sort order. Spec requires
  // sorted keys and no timestamps — this is load-bearing for the
  // determinism gate.
  const sortedFiles = Object.fromEntries(
    Object.keys(files).sort().map((k) => [k, files[k]]),
  );

  const manifest = {
    version: 1,
    algorithm: "sha256",
    files: sortedFiles,
  };

  if (writeToDisk) {
    const out = JSON.stringify(manifest, null, 2) + "\n";
    writeFileSync(join(distDir, INTEGRITY_MANIFEST_NAME), out, "utf8");
  }

  return manifest;
}

function log(msg) {
  process.stdout.write(`[emit-integrity-manifest] ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`[emit-integrity-manifest] ERROR: ${msg}\n`);
  process.exit(1);
}

function main() {
  try {
    const manifest = buildIntegrityManifest(DIST_DIR);
    const count = Object.keys(manifest.files).length;
    log(`wrote ${count} file hashes to dist/${INTEGRITY_MANIFEST_NAME}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

// Only run main() when invoked as a CLI — keeps the exports safely
// importable from unit tests without firing the side-effect.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath === modulePath) {
  main();
}
