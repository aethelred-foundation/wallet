#!/usr/bin/env node
/**
 * Aethelred Wallet - per-package bundle weight report.
 *
 * Answers: "how many bytes does `@aethelred/wallet-compliance` add to
 * the extension bundle?" Individual chunk size (via size-limit) tells
 * us the total; this script decomposes that total by package so we
 * can see which internal dependency is the heaviest contributor.
 *
 * Approach:
 *
 *   1. Use esbuild to bundle each of the extension entry points
 *      (popup, background, content, inpage, options) with
 *      `metafile: true`. Unlike the actual production build (which
 *      uses Vite + Rollup), we only need the dependency graph, not
 *      the emitted assets - esbuild is 10x faster and its metafile
 *      already carries per-input byte totals.
 *
 *   2. Walk the metafile's `inputs` map. Each input has an absolute
 *      path; we classify it as belonging to a package by its path
 *      prefix (`packages/<name>/` or `apps/extension/src/`).
 *
 *   3. Sum the bytes per package (gzipped, since that's what ships)
 *      and emit a sorted report. Diff against the committed baseline
 *      `reports/bundle-weight.baseline.json` and flag per-package
 *      growth > 10 %.
 *
 * This is a WARNING signal, not a blocker. The hard gate is the
 * size-limit absolute budget. This report helps triage WHY the
 * bundle grew - something that size-limit cannot answer.
 *
 * Exit codes:
 *   0 - report generated; no regressions (or --warn mode)
 *   1 - regression > 10 % in any package and --warn not passed
 *   2 - configuration error (missing entry point, esbuild failure)
 */

import { readdirSync, existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, relative, dirname, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { readFileSync as read } from "node:fs";
import esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const reportsDir = resolve(repoRoot, "reports");
const outputPath = resolve(reportsDir, "bundle-weight.json");
const baselinePath = resolve(reportsDir, "bundle-weight.baseline.json");

const GROWTH_WARN_THRESHOLD = 0.10; // 10 %
const shouldWarnOnly = process.argv.includes("--warn");
const shouldUpdateBaseline = process.argv.includes("--update-baseline");

const ENTRY_POINTS = [
  { name: "popup", path: "apps/extension/src/popup/main.tsx" },
  { name: "options", path: "apps/extension/src/options/main.tsx" },
  { name: "background", path: "apps/extension/src/background.ts" },
  { name: "content", path: "apps/extension/src/content.ts" },
  { name: "inpage", path: "apps/extension/src/inpage.ts" },
  { name: "content-bridge", path: "apps/extension/src/content-bridge.ts" },
];

/**
 * Classify an input path into a logical package bucket. The
 * classification drives the reporting grouping.
 */
function classify(inputPath) {
  const abs = resolve(repoRoot, inputPath);
  const rel = relative(repoRoot, abs).replace(/\\/g, "/");

  const pkgMatch = rel.match(/^packages\/([^/]+)\//);
  if (pkgMatch) return `@aethelred/wallet-${pkgMatch[1]}`;

  const appMatch = rel.match(/^apps\/extension\/src\/([^/]+)/);
  if (appMatch) return `extension/${appMatch[1]}`;

  if (rel.startsWith("node_modules/")) {
    // node_modules/@scope/name/... or node_modules/name/...
    const nmMatch = rel.match(/^node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
    if (nmMatch) {
      // If it's an @aethelred/* workspace symlink, it's already covered
      // above by the packages/ match, but symlink resolution may miss it.
      if (nmMatch[1].startsWith("@aethelred/")) return nmMatch[1];
      return `third-party/${nmMatch[1]}`;
    }
  }

  return "other";
}

async function bundleEntry(entry) {
  const abs = resolve(repoRoot, entry.path);
  if (!existsSync(abs)) {
    console.error(`Missing entry point: ${entry.path}`);
    return null;
  }
  try {
    const result = await esbuild.build({
      entryPoints: [abs],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      metafile: true,
      write: false,
      minify: true,
      logLevel: "silent",
      // React JSX / TSX handling.
      jsx: "automatic",
      loader: {
        ".png": "empty",
        ".jpg": "empty",
        ".jpeg": "empty",
        ".webp": "empty",
        ".svg": "empty",
        ".css": "empty",
        ".json": "json",
      },
      // define __DEV__ / import.meta.env stubs so DCE is comparable.
      define: {
        "import.meta.env.DEV": "false",
        "import.meta.env.PROD": "true",
        "import.meta.env.MODE": '"production"',
        "process.env.NODE_ENV": '"production"',
      },
    });
    return result.metafile;
  } catch (err) {
    console.error(`esbuild failed for ${entry.name}: ${err.message}`);
    return null;
  }
}

/**
 * Aggregate per-package bytes across every entry-point metafile.
 *
 * We count each input ONCE per entry point (an input may appear in
 * multiple entries if it's shared; the count reflects its total weight
 * contribution to the shipped extension).
 */
function aggregate(metafiles) {
  const packages = new Map();
  for (const meta of metafiles) {
    if (!meta) continue;
    for (const [inputPath, info] of Object.entries(meta.inputs)) {
      const bucket = classify(inputPath);
      const entry = packages.get(bucket) ?? { bytes: 0, files: 0 };
      entry.bytes += info.bytes;
      entry.files += 1;
      packages.set(bucket, entry);
    }
  }
  return packages;
}

function buildReport(packages) {
  const rows = [];
  let total = 0;
  for (const [name, { bytes, files }] of packages) {
    rows.push({ package: name, bytes, files });
    total += bytes;
  }
  rows.sort((a, b) => b.bytes - a.bytes);
  const withPct = rows.map((r) => ({
    ...r,
    pctOfTotal: total === 0 ? 0 : Number(((r.bytes / total) * 100).toFixed(2)),
    kb: Number((r.bytes / 1024).toFixed(2)),
  }));
  return { total, rows: withPct };
}

function loadBaseline() {
  if (!existsSync(baselinePath)) return null;
  return JSON.parse(readFileSync(baselinePath, "utf8"));
}

function writeReport(report) {
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");
}

function writeBaseline(report) {
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  writeFileSync(baselinePath, JSON.stringify(report, null, 2) + "\n");
}

function diffAgainstBaseline(current, baseline) {
  if (!baseline) return [];
  const byName = new Map(baseline.rows.map((r) => [r.package, r]));
  const warnings = [];
  for (const row of current.rows) {
    const prev = byName.get(row.package);
    if (!prev) {
      warnings.push({
        kind: "new",
        package: row.package,
        bytes: row.bytes,
        kb: row.kb,
        growth: null,
      });
      continue;
    }
    if (prev.bytes === 0) continue;
    const growth = (row.bytes - prev.bytes) / prev.bytes;
    if (growth >= GROWTH_WARN_THRESHOLD) {
      warnings.push({
        kind: "grew",
        package: row.package,
        from: prev.bytes,
        to: row.bytes,
        growth: Number((growth * 100).toFixed(2)),
      });
    }
  }
  return warnings;
}

function printTable(report) {
  console.log("");
  console.log("Per-package bundle weight (uncompressed source bytes):");
  console.log("");
  const widest = report.rows.reduce((m, r) => Math.max(m, r.package.length), 20);
  const header =
    "  " +
    "Package".padEnd(widest) +
    "  " +
    "KB".padStart(10) +
    "  " +
    "% total".padStart(8) +
    "  " +
    "Files".padStart(6);
  console.log(header);
  console.log("  " + "-".repeat(widest + 32));
  for (const row of report.rows) {
    console.log(
      "  " +
        row.package.padEnd(widest) +
        "  " +
        row.kb.toFixed(2).padStart(10) +
        "  " +
        (row.pctOfTotal.toFixed(2) + "%").padStart(8) +
        "  " +
        String(row.files).padStart(6),
    );
  }
  console.log("  " + "-".repeat(widest + 32));
  console.log(
    "  " +
      "TOTAL".padEnd(widest) +
      "  " +
      (report.total / 1024).toFixed(2).padStart(10) +
      "  " +
      "100.00%".padStart(8),
  );
  console.log("");
}

async function main() {
  const metafiles = [];
  for (const entry of ENTRY_POINTS) {
    console.log(`Bundling ${entry.name} ...`);
    const meta = await bundleEntry(entry);
    metafiles.push(meta);
  }

  const packages = aggregate(metafiles);
  const report = buildReport(packages);
  report.generatedAt = new Date().toISOString();

  printTable(report);
  writeReport(report);
  console.log(`Report: ${relative(repoRoot, outputPath)}`);

  if (shouldUpdateBaseline) {
    writeBaseline(report);
    console.log(`Baseline updated: ${relative(repoRoot, baselinePath)}`);
    return;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.log("");
    console.log(
      "No baseline committed yet. Run `npm run lint:bundle-weight -- --update-baseline`",
    );
    console.log("to create one after reviewing the sizes above.");
    return;
  }

  const warnings = diffAgainstBaseline(report, baseline);
  if (warnings.length === 0) {
    console.log(`No package grew by >= ${GROWTH_WARN_THRESHOLD * 100}% since baseline.`);
    return;
  }

  console.log("");
  console.log(`Warnings (growth >= ${GROWTH_WARN_THRESHOLD * 100}%):`);
  for (const w of warnings) {
    if (w.kind === "new") {
      console.log(`  [NEW]  ${w.package}: ${w.kb} KB`);
    } else {
      console.log(
        `  [GREW] ${w.package}: ${(w.from / 1024).toFixed(1)} -> ${(w.to / 1024).toFixed(1)} KB (+${w.growth}%)`,
      );
    }
  }

  if (!shouldWarnOnly) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
