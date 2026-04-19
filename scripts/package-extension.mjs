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
 *      deterministic `SHA256SUMS` file (sorted by path, LF-only line
 *      endings) inside `dist/`.
 *   4. Creates a fully-deterministic ZIP at
 *      `releases/aethelred-wallet-v<version>.zip` containing the contents
 *      of `dist/` (NOT the `dist/` folder itself — CWS rejects zips with
 *      a top-level folder).
 *   5. Prints a summary with zip size, file count, and the ZIP's own
 *      SHA-256 for release-note attachment.
 *
 * Deterministic-build contract:
 *   - Every ZIP entry uses a fixed epoch (`FIXED_EPOCH`) for its modified
 *     time, so re-running on the same inputs produces a byte-identical
 *     archive. Supply-chain auditors rely on this to verify we publish
 *     the bytes we claim.
 *   - Entries are sorted lexicographically by relative path so the order
 *     of traversal on different filesystems can never leak into the
 *     output.
 *   - No extra file attributes (unix permission masks, uid/gid) are
 *     written: Chrome does not care and they would add another source of
 *     nondeterminism on different build hosts.
 *   - `zlib.deflateRawSync` is called with a fixed compression level;
 *     Node's zlib is deterministic for a given level, input, and
 *     strategy.
 *
 * Intentionally dependency-free: uses Node's built-in `node:fs`,
 * `node:crypto`, `node:zlib`. No external ZIP binary, no `adm-zip`, no
 * `archiver` — so the determinism contract lives entirely in this file
 * and doesn't move when the transitive dep graph shifts.
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
import { deflateRawSync, constants as zlibConstants } from "node:zlib";
import { Buffer } from "node:buffer";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const EXT_DIR = resolve(REPO_ROOT, "apps", "extension");
const DIST_DIR = resolve(EXT_DIR, "dist");
const RELEASES_DIR = resolve(REPO_ROOT, "releases");

/**
 * Fixed modification time stamped into every ZIP entry.
 *
 * ZIP's internal clock is DOS time: 2-second resolution, years
 * 1980 – 2107. Picking a stable epoch well inside that range means the
 * "last modified" field in every entry is identical on every machine,
 * regardless of when the source files were checked out. Keep this value
 * pinned — changing it invalidates every previously-published release
 * hash.
 */
const FIXED_EPOCH = new Date("2026-01-01T00:00:00Z");

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

/**
 * SHA-256 of an in-memory buffer, hex-encoded.
 */
function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
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
 *
 * Output format: one `<hex-hash>  <relative-path>\n` line per file,
 * sorted lexicographically by path, LF-only line endings (never CRLF),
 * and a single trailing newline. Any consumer that treats the file as a
 * canonical manifest must be able to tokenise it deterministically, so
 * we keep the format tight.
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

// ---------------------------------------------------------------------------
// Deterministic ZIP writer
// ---------------------------------------------------------------------------

/**
 * Encode a JS Date as a DOS date/time pair as specified by the ZIP
 * format (APPNOTE 4.4.6).
 *
 *   - DOS date: bits 0-4 day, 5-8 month, 9-15 year (relative to 1980)
 *   - DOS time: bits 0-4 seconds / 2, 5-10 minutes, 11-15 hours
 */
function toDosDateTime(date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  return { dosDate, dosTime };
}

/**
 * CRC-32 of a buffer, using the same polynomial as the ZIP format.
 * Implemented by hand so we depend on zero external modules.
 */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build a deterministic ZIP archive in memory.
 *
 * `files` is an array of `{ path, data }` where `path` is the archive-
 * relative path (forward-slash separated) and `data` is a Buffer. The
 * caller is responsible for ordering — this function trusts the order
 * it's given so the test can assert sorted emission.
 */
function buildDeterministicZip(files) {
  const { dosDate, dosTime } = toDosDateTime(FIXED_EPOCH);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { path, data } of files) {
    const nameBuf = Buffer.from(path, "utf8");
    const compressed = deflateRawSync(data, {
      level: zlibConstants.Z_BEST_COMPRESSION,
    });
    // Fall back to "store" if compression didn't help — same behaviour
    // as every production ZIP writer. Determinism is preserved because
    // the branch is purely a function of `data`.
    const useDeflate = compressed.length < data.length;
    const storedData = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0; // 8 = DEFLATE, 0 = STORE
    const crc = crc32(data);

    // Local file header (APPNOTE 4.3.7)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // local file header signature
    lfh.writeUInt16LE(20, 4); // version needed to extract (2.0)
    lfh.writeUInt16LE(0, 6); // general purpose bit flag
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(dosTime, 10);
    lfh.writeUInt16LE(dosDate, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(storedData.length, 18); // compressed size
    lfh.writeUInt32LE(data.length, 22); // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extra field length — intentionally zero
    localParts.push(lfh, nameBuf, storedData);

    // Central directory record (APPNOTE 4.3.12)
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); // central dir header signature
    cdh.writeUInt16LE(20, 4); // version made by (2.0, MS-DOS)
    cdh.writeUInt16LE(20, 6); // version needed to extract
    cdh.writeUInt16LE(0, 8); // general purpose bit flag
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(dosTime, 12);
    cdh.writeUInt16LE(dosDate, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(storedData.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); // extra field length
    cdh.writeUInt16LE(0, 32); // file comment length
    cdh.writeUInt16LE(0, 34); // disk number start
    cdh.writeUInt16LE(0, 36); // internal file attributes
    cdh.writeUInt32LE(0, 38); // external file attributes — intentionally zero
    cdh.writeUInt32LE(offset, 42); // relative offset of local header
    centralParts.push(cdh, nameBuf);

    offset += lfh.length + nameBuf.length + storedData.length;
  }

  const localChunk = Buffer.concat(localParts);
  const centralChunk = Buffer.concat(centralParts);
  const centralOffset = localChunk.length;
  const centralSize = centralChunk.length;

  // End of central directory record (APPNOTE 4.3.16)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central dir disk
  eocd.writeUInt16LE(files.length, 8); // entries on this disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length — intentionally zero

  return Buffer.concat([localChunk, centralChunk, eocd]);
}

/**
 * Step 4 — Zip the dist/ contents (not the folder itself) to
 * releases/aethelred-wallet-v<version>.zip, deterministically.
 */
function zipDist(manifest) {
  if (!existsSync(RELEASES_DIR)) mkdirSync(RELEASES_DIR, { recursive: true });
  const zipName = `aethelred-wallet-v${manifest.version}.zip`;
  const zipPath = join(RELEASES_DIR, zipName);
  if (existsSync(zipPath)) rmSync(zipPath);

  log("zip", `creating ${relative(REPO_ROOT, zipPath)}`);

  // Sort entries by relative path so the archive's layout is
  // independent of readdir() ordering.
  const files = walk(DIST_DIR)
    .map((abs) => ({
      path: relative(DIST_DIR, abs).split(sep).join("/"),
      abs,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map(({ path, abs }) => ({ path, data: readFileSync(abs) }));

  const zipBuffer = buildDeterministicZip(files);
  writeFileSync(zipPath, zipBuffer);

  const size = zipBuffer.length;
  const zipHash = sha256Buffer(zipBuffer);
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
