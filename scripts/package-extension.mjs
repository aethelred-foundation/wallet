#!/usr/bin/env node
/**
 * Aethelred Wallet — Chrome Web Store packaging script.
 *
 * What this does, in order:
 *   1. Runs `npm run build --workspace @aethelred/wallet-extension`.
 *   2. Validates the resulting `dist/` directory:
 *        - manifest.json exists and is valid JSON
 *        - every file the manifest references exists
 *        - no `.map` source maps leak into the submission
 *   3. Computes SHA-256 of every file under `dist/` and writes a
 *      deterministic `SHA256SUMS` file (sorted by path) inside `dist/`.
 *   4. Creates a ZIP at `releases/aethelred-wallet-v<version>.zip`
 *      containing the contents of `dist/` (NOT the `dist/` folder itself —
 *      CWS rejects zips with a top-level folder).
 *   5. Prints a summary with zip size, file count, and the ZIP's own
 *      SHA-256 for release-note attachment.
 *
 * Intentionally dependency-free: uses Node's built-in `node:fs`,
 * `node:crypto`, `node:zlib`, and spawns the `zip` binary via
 * `node:child_process`. `zip` is available on macOS / Linux by default;
 * a CI container that lacks it will fail loudly rather than silently
 * producing a broken artifact.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const EXT_DIR = resolve(REPO_ROOT, "apps", "extension");
const DIST_DIR = resolve(EXT_DIR, "dist");
const RELEASES_DIR = resolve(REPO_ROOT, "releases");

/**
 * Walk a directory recursively and return every file path (absolute).
 */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/**
 * SHA-256 of a file's bytes, hex-encoded.
 */
function sha256File(path) {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

function log(step, msg) {
  process.stdout.write(`[package-extension] ${step}: ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`[package-extension] ERROR: ${msg}\n`);
  process.exit(1);
}

/**
 * Step 1 — Build the extension.
 */
function runBuild() {
  log("build", "running `npm run build --workspace @aethelred/wallet-extension`");
  const result = spawnSync(
    "npm",
    ["run", "build", "--workspace", "@aethelred/wallet-extension"],
    { cwd: REPO_ROOT, stdio: "inherit", env: process.env },
  );
  if (result.status !== 0) {
    fail(`build failed with exit code ${result.status}`);
  }
}

/**
 * Step 2 — Validate dist/ against the manifest.
 */
function validateDist() {
  log("validate", `scanning ${DIST_DIR}`);
  if (!existsSync(DIST_DIR)) {
    fail(`dist/ does not exist at ${DIST_DIR} — did the build fail?`);
  }

  const manifestPath = join(DIST_DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    fail("dist/manifest.json is missing");
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    fail(`dist/manifest.json is not valid JSON: ${err.message}`);
  }

  if (manifest.manifest_version !== 3) {
    fail(`manifest_version must be 3, got ${manifest.manifest_version}`);
  }
  if (!manifest.version || !manifest.name) {
    fail("manifest.json is missing `version` or `name`");
  }

  // Collect referenced files from common manifest locations.
  const referenced = new Set();
  const add = (p) => {
    if (typeof p === "string") referenced.add(p);
  };

  add(manifest.action?.default_popup);
  add(manifest.options_page);
  add(manifest.background?.service_worker);

  for (const cs of manifest.content_scripts ?? []) {
    for (const js of cs.js ?? []) add(js);
    for (const css of cs.css ?? []) add(css);
  }

  for (const war of manifest.web_accessible_resources ?? []) {
    for (const res of war.resources ?? []) add(res);
  }

  for (const size of Object.keys(manifest.icons ?? {})) {
    add(manifest.icons[size]);
  }

  // Check every referenced file exists.
  for (const rel of referenced) {
    const full = join(DIST_DIR, rel);
    if (!existsSync(full)) {
      fail(`manifest references '${rel}' but dist/${rel} is missing`);
    }
  }

  // No source maps should ship.
  const allFiles = walk(DIST_DIR);
  const mapFiles = allFiles.filter((f) => f.endsWith(".map"));
  if (mapFiles.length > 0) {
    const rels = mapFiles.map((f) => relative(DIST_DIR, f)).join(", ");
    fail(`dist/ contains source maps (strip before shipping): ${rels}`);
  }

  log("validate", `manifest ok (${referenced.size} file references)`);
  return { manifest, allFiles };
}

/**
 * Step 3 — Emit SHA256SUMS manifest.
 */
function emitChecksums(allFiles) {
  log("checksums", "computing SHA-256 for every dist/ file");
  const entries = allFiles
    .filter((f) => !f.endsWith("SHA256SUMS"))
    .map((f) => {
      const rel = relative(DIST_DIR, f).split(sep).join("/");
      const hash = sha256File(f);
      return { rel, hash };
    })
    .sort((a, b) => (a.rel < b.rel ? -1 : 1));

  const body =
    entries.map((e) => `${e.hash}  ${e.rel}`).join("\n") + "\n";
  const out = join(DIST_DIR, "SHA256SUMS");
  writeFileSync(out, body, "utf8");
  log("checksums", `wrote ${entries.length} entries to dist/SHA256SUMS`);
  return entries;
}

/**
 * Step 4 — Zip the dist/ contents (not the folder itself) to
 * releases/aethelred-wallet-v<version>.zip.
 */
function zipDist(manifest) {
  if (!existsSync(RELEASES_DIR)) mkdirSync(RELEASES_DIR, { recursive: true });
  const zipName = `aethelred-wallet-v${manifest.version}.zip`;
  const zipPath = join(RELEASES_DIR, zipName);
  if (existsSync(zipPath)) rmSync(zipPath);

  log("zip", `creating ${relative(REPO_ROOT, zipPath)}`);
  // -r recursive, -X strip extra file attributes (reproducibility),
  // -q quiet; the final `.` is relative to cwd so no top-level folder.
  const result = spawnSync("zip", ["-r", "-X", "-q", zipPath, "."], {
    cwd: DIST_DIR,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(`zip exited with code ${result.status} — is the 'zip' binary installed?`);
  }

  const size = statSync(zipPath).size;
  const zipHash = sha256File(zipPath);
  return { zipPath, size, zipHash };
}

/**
 * Step 5 — Summary.
 */
function printSummary({ manifest, entries, zip }) {
  const mb = (zip.size / (1024 * 1024)).toFixed(2);
  process.stdout.write(
    [
      "",
      "========================================",
      " Aethelred Wallet — packaging summary",
      "========================================",
      ` name:       ${manifest.name}`,
      ` version:    ${manifest.version}`,
      ` zip:        ${relative(REPO_ROOT, zip.zipPath)}`,
      ` zip size:   ${mb} MB (${zip.size.toLocaleString()} bytes)`,
      ` file count: ${entries.length}`,
      ` zip sha256: ${zip.zipHash}`,
      "----------------------------------------",
      " first 5 file hashes (sorted):",
      ...entries.slice(0, 5).map((e) => `  ${e.hash}  ${e.rel}`),
      "========================================",
      "",
    ].join("\n"),
  );

  if (zip.size > 10 * 1024 * 1024) {
    process.stderr.write(
      "[package-extension] WARNING: zip is larger than 10 MB — CWS "
        + "may reject the initial submission. Audit dist/ contents.\n",
    );
  }
}

function main() {
  runBuild();
  const { manifest, allFiles } = validateDist();
  const entries = emitChecksums(allFiles);
  // Re-walk after writing SHA256SUMS so it is included in the zip.
  const zip = zipDist(manifest);
  printSummary({ manifest, entries, zip });
}

main();
