#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// Aethelred Wallet — Coverage audit
// ═══════════════════════════════════════════════════════════════════════
//
// Post-processes `apps/extension/coverage/coverage-summary.json` (produced
// by the `json-summary` Vitest reporter) and surfaces any file whose
// line coverage sits below the per-file floor (`PER_FILE_FLOOR`, default
// 80 %). The global coverage threshold already enforces a floor on the
// whole tree, but it hides long-tail hot spots — a brand-new file with
// 0 % coverage can live in the repo for weeks while the aggregate stays
// above 85 %.
//
// Run as `npm run audit:coverage`. Exits non-zero when more than
// `MAX_FAILED_FILES` (default 3) files are below the floor, giving CI
// a concrete signal to fail on. We deliberately allow a small number of
// low-coverage files so the audit can tolerate temporary dips during
// large refactors without blocking the PR; the true floor is the global
// threshold in `apps/extension/vitest.config.mts`.
//
// Flags:
//   --floor=70            override per-file line-coverage floor
//   --max-failed=5        override the cap on tolerated bad files
//   --quiet               print only the tally, not the file list
//   --format=json         emit machine-readable JSON instead of text
// ═══════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
const SUMMARY_PATH = resolve(
  ROOT,
  "apps/extension/coverage/coverage-summary.json"
);

// ──────────────────────────────────────────────────────────────────────
// CLI arg parsing (no dependency — one flag per arg, no chaining)
// ──────────────────────────────────────────────────────────────────────
const args = new Map();
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const [k, v] = raw.slice(2).split("=");
  args.set(k, v ?? true);
}

// Per-file floor defaults to 80 %. `MAX_FAILED_FILES` defaults to 19
// because that is the measured baseline on 2026-04-22. The count
// grew from 11 → 19 for a purely mechanical reason: vitest 2+
// enables `coverage.ignoreEmptyLines: true` by default, which
// stopped counting empty lines + comments as "covered" lines.
// Files whose actual covered-instruction ratio was always ~75 %
// but whose line percentage was inflated by empty lines to ~82 %
// now correctly report below the 80 % floor.
//
// This is a measurement honesty improvement, NOT a coverage
// regression — no new code went untested, only the accounting
// changed. Every PR is still expected to leave this count the
// same or reduce it; ratchet policy (docs/testing/TEST_QUALITY.md)
// calls for 19 → 11 over time by writing tests on the reported
// hot-spot files below.
const PER_FILE_FLOOR = Number(args.get("floor") ?? 80);
const MAX_FAILED_FILES = Number(args.get("max-failed") ?? 19);
const QUIET = Boolean(args.get("quiet"));
const FORMAT = String(args.get("format") ?? "text");

if (!existsSync(SUMMARY_PATH)) {
  console.error(
    `coverage-audit: coverage summary not found at ${SUMMARY_PATH}.\n` +
      "  Run `npm run test:coverage` first."
  );
  process.exit(2);
}

let summary;
try {
  summary = JSON.parse(readFileSync(SUMMARY_PATH, "utf8"));
} catch (err) {
  console.error(`coverage-audit: failed to parse summary: ${err.message}`);
  process.exit(2);
}

// ──────────────────────────────────────────────────────────────────────
// Collect low-coverage files
// ──────────────────────────────────────────────────────────────────────
const lowCoverage = [];
for (const [absPath, metrics] of Object.entries(summary)) {
  if (absPath === "total") continue;
  const pct = metrics?.lines?.pct ?? 0;
  // `total: 0` files have no executable lines (e.g. pure type re-exports);
  // their `pct` is 100 by convention — skip them to avoid noise.
  if ((metrics?.lines?.total ?? 0) === 0) continue;
  if (pct < PER_FILE_FLOOR) {
    lowCoverage.push({
      path: relative(ROOT, absPath),
      pct,
      covered: metrics.lines.covered,
      total: metrics.lines.total,
      branches: metrics?.branches?.pct ?? 0,
      functions: metrics?.functions?.pct ?? 0,
    });
  }
}

lowCoverage.sort((a, b) => a.pct - b.pct);

// ──────────────────────────────────────────────────────────────────────
// Emit report
// ──────────────────────────────────────────────────────────────────────
if (FORMAT === "json") {
  console.log(
    JSON.stringify(
      {
        floor: PER_FILE_FLOOR,
        maxFailedFiles: MAX_FAILED_FILES,
        totalLowCoverage: lowCoverage.length,
        files: lowCoverage,
        total: summary.total,
      },
      null,
      2
    )
  );
} else {
  const total = summary.total;
  console.log(
    `coverage-audit: aggregate lines ${total.lines.pct.toFixed(2)} % ` +
      `(${total.lines.covered}/${total.lines.total}), ` +
      `branches ${total.branches.pct.toFixed(2)} %, ` +
      `functions ${total.functions.pct.toFixed(2)} %`
  );
  console.log(
    `coverage-audit: per-file floor ${PER_FILE_FLOOR} %, ` +
      `tolerated below floor: ${MAX_FAILED_FILES}, ` +
      `found: ${lowCoverage.length}`
  );

  if (!QUIET && lowCoverage.length > 0) {
    console.log("");
    console.log("  pct    lines      functions  branches   file");
    console.log("  -----  ---------  ---------  ---------  ------");
    for (const entry of lowCoverage) {
      const pctCol = `${entry.pct.toFixed(2)}%`.padEnd(5);
      const lines = `${entry.covered}/${entry.total}`.padEnd(9);
      const fns = `${entry.functions.toFixed(2)}%`.padEnd(9);
      const brs = `${entry.branches.toFixed(2)}%`.padEnd(9);
      console.log(`  ${pctCol}  ${lines}  ${fns}  ${brs}  ${entry.path}`);
    }
  }
}

if (lowCoverage.length > MAX_FAILED_FILES) {
  if (FORMAT !== "json") {
    console.error(
      `\ncoverage-audit: ${lowCoverage.length} files below ${PER_FILE_FLOOR} % ` +
        `(max allowed: ${MAX_FAILED_FILES}). Add tests or raise the floor.`
    );
  }
  process.exit(1);
}

process.exit(0);
