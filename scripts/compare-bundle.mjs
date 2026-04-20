#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * compare-bundle.mjs — per-chunk regression gate
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Compares the current bundle manifest (produced by
 * `generate-bundle-manifest.mjs`) against the committed baseline at
 * `reports/bundle-baseline.json`. Fails CI if any single chunk grew by
 * more than the per-chunk threshold (default 10 %) OR if the gzip
 * total grew by more than the aggregate threshold (default 5 %).
 *
 * Why two thresholds?
 * -------------------
 * A single lazy route doubling in size is a BUG (someone pulled a huge
 * dependency into that chunk). The aggregate check catches the slow-
 * creep case where every chunk grew 2–3 % — individually harmless but
 * cumulatively meaningful. Both signals are worth gating on.
 *
 * The per-chunk threshold applies to gzip bytes (what the user actually
 * pays for); raw bytes are reported for context but are not the gate
 * because minifier output is expected to be volatile run-to-run.
 *
 * New chunks
 * ----------
 * A new chunk (not in baseline) produces an informational row. It is
 * NOT a regression by itself — code splitting adds new chunks all the
 * time. However, new chunks DO contribute to the aggregate total, so a
 * flood of them would still trip the total-growth gate.
 *
 * Deleted chunks
 * --------------
 * A chunk that existed in baseline but not in current is reported as a
 * deletion (with a negative delta). Always considered a pass.
 *
 * Exit codes
 * ----------
 *   0 — all checks passed (no chunk exceeded per-chunk threshold AND
 *       total growth is within aggregate threshold)
 *   1 — at least one chunk exceeded the per-chunk threshold
 *   2 — aggregate gzip total grew past the aggregate threshold
 *
 * Output
 * ------
 * The markdown report is ALWAYS written to
 * `apps/extension/dist/_bundle-delta.md` (for the PR commenter to pick
 * up) and printed to stdout. The structured JSON summary is also
 * written to `apps/extension/dist/_bundle-delta.json` for programmatic
 * consumers (release notes, dashboards).
 *
 * Owner: wallet-extension team. See docs/engineering/BUNDLE_BUDGETS.md.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_BASELINE = resolve(REPO_ROOT, "reports", "bundle-baseline.json");
const DEFAULT_CURRENT = resolve(
  REPO_ROOT,
  "apps",
  "extension",
  "dist",
  "_bundle-manifest.json",
);
const DEFAULT_MD_OUT = resolve(
  REPO_ROOT,
  "apps",
  "extension",
  "dist",
  "_bundle-delta.md",
);
const DEFAULT_JSON_OUT = resolve(
  REPO_ROOT,
  "apps",
  "extension",
  "dist",
  "_bundle-delta.json",
);

/** Default growth thresholds. See header comment for rationale. */
export const DEFAULT_PER_CHUNK_THRESHOLD = 0.10; // 10 %
export const DEFAULT_TOTAL_THRESHOLD = 0.05; //  5 %

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

/** Format byte counts as a human-friendly KB string. */
export function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Format a percentage with sign. 0.125 → "+12.5%". Infinity → "new". */
export function formatPct(frac) {
  if (!Number.isFinite(frac)) return "new";
  const pct = frac * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** Format a signed byte delta, e.g. +1.2 KB / -0.3 KB. */
export function formatDelta(bytes) {
  const sign = bytes > 0 ? "+" : bytes < 0 ? "-" : "";
  const abs = Math.abs(bytes);
  return `${sign}${(abs / 1024).toFixed(1)} KB`;
}

/**
 * Compare two manifests and return a structured summary plus a set of
 * per-chunk rows suitable for rendering as markdown. Pure function —
 * all I/O is the caller's responsibility. This is the core that the
 * unit tests exercise.
 */
export function compareBundle({
  baseline,
  current,
  perChunkThreshold = DEFAULT_PER_CHUNK_THRESHOLD,
  totalThreshold = DEFAULT_TOTAL_THRESHOLD,
} = {}) {
  if (!baseline || !baseline.chunks) {
    throw new Error("baseline manifest is missing `chunks`");
  }
  if (!current || !current.chunks) {
    throw new Error("current manifest is missing `chunks`");
  }

  const names = new Set([
    ...Object.keys(baseline.chunks),
    ...Object.keys(current.chunks),
  ]);

  const rows = [];
  const regressions = [];

  for (const name of [...names].sort()) {
    const base = baseline.chunks[name];
    const curr = current.chunks[name];

    if (!base && curr) {
      rows.push({
        name,
        status: "new",
        baselineGzip: 0,
        currentGzip: curr.gzip,
        deltaBytes: curr.gzip,
        deltaFrac: Infinity,
        regressed: false,
      });
      continue;
    }
    if (base && !curr) {
      rows.push({
        name,
        status: "deleted",
        baselineGzip: base.gzip,
        currentGzip: 0,
        deltaBytes: -base.gzip,
        deltaFrac: base.gzip === 0 ? 0 : -1,
        regressed: false,
      });
      continue;
    }

    // Both sides present — compute delta on gzip (user-paid bytes).
    const deltaBytes = curr.gzip - base.gzip;
    const deltaFrac = base.gzip === 0 ? (curr.gzip === 0 ? 0 : Infinity) : deltaBytes / base.gzip;
    const regressed = deltaFrac > perChunkThreshold;

    const row = {
      name,
      status: regressed ? "regressed" : deltaBytes >= 0 ? "grew" : "shrunk",
      baselineGzip: base.gzip,
      currentGzip: curr.gzip,
      deltaBytes,
      deltaFrac,
      regressed,
    };
    rows.push(row);
    if (regressed) regressions.push(row);
  }

  const baseTotal = baseline.totals?.gzip ?? 0;
  const currTotal = current.totals?.gzip ?? 0;
  const totalDeltaBytes = currTotal - baseTotal;
  const totalDeltaFrac =
    baseTotal === 0 ? (currTotal === 0 ? 0 : Infinity) : totalDeltaBytes / baseTotal;
  const totalRegressed = totalDeltaFrac > totalThreshold;

  let exitCode = 0;
  if (regressions.length > 0) exitCode = 1;
  if (totalRegressed) exitCode = 2;

  return {
    rows,
    regressions,
    totals: {
      baselineGzip: baseTotal,
      currentGzip: currTotal,
      deltaBytes: totalDeltaBytes,
      deltaFrac: totalDeltaFrac,
      regressed: totalRegressed,
    },
    perChunkThreshold,
    totalThreshold,
    exitCode,
  };
}

/** Render a markdown report. Designed to be posted verbatim as a PR comment. */
export function renderMarkdown(summary) {
  const { rows, regressions, totals, perChunkThreshold, totalThreshold } = summary;

  const lines = [];
  lines.push("## Bundle Size Impact");
  lines.push("");
  lines.push("| Chunk | Baseline gzip | Current gzip | Δ | Δ% |");
  lines.push("|-------|--------------:|-------------:|--:|---:|");

  // Limit the rendered rows to those that materially moved (|Δ| ≥ 128 B)
  // so the table does not drown signal in noise. Regressions and new
  // chunks are always shown.
  const materialRows = rows.filter(
    (r) =>
      r.regressed ||
      r.status === "new" ||
      r.status === "deleted" ||
      Math.abs(r.deltaBytes) >= 128,
  );

  if (materialRows.length === 0) {
    lines.push("| _(no material per-chunk changes)_ | | | | |");
  }

  for (const row of materialRows) {
    const name = row.status === "new" ? `${row.name} _(new)_` :
                 row.status === "deleted" ? `${row.name} _(deleted)_` :
                 row.name;
    const baseStr = row.status === "new" ? "—" : formatKB(row.baselineGzip);
    const currStr = row.status === "deleted" ? "—" : formatKB(row.currentGzip);
    const deltaStr = formatDelta(row.deltaBytes);
    const pctRaw = formatPct(row.deltaFrac);
    const pctStr = row.regressed ? `**${pctRaw}** :x:` : pctRaw;
    lines.push(`| ${name} | ${baseStr} | ${currStr} | ${deltaStr} | ${pctStr} |`);
  }

  lines.push("");
  const totPct = formatPct(totals.deltaFrac);
  lines.push(
    `**TOTAL (gzip): ${formatKB(totals.baselineGzip)} → ${formatKB(totals.currentGzip)} ` +
      `(${formatDelta(totals.deltaBytes)}, ${totPct})**`,
  );
  lines.push("");

  lines.push(
    `_Thresholds: per-chunk > ${(perChunkThreshold * 100).toFixed(0)}% fails, ` +
      `aggregate gzip total > ${(totalThreshold * 100).toFixed(0)}% fails._`,
  );
  lines.push("");

  if (regressions.length > 0) {
    lines.push(
      `**REGRESSIONS**: ${regressions.length} chunk(s) exceeded the ` +
        `${(perChunkThreshold * 100).toFixed(0)}% growth threshold.`,
    );
    for (const r of regressions) {
      lines.push(`- \`${r.name}\`: ${formatDelta(r.deltaBytes)} (${formatPct(r.deltaFrac)})`);
    }
  } else if (totals.regressed) {
    lines.push(
      `**REGRESSION**: aggregate gzip total grew by ${totPct}, ` +
        `over the ${(totalThreshold * 100).toFixed(0)}% allowance.`,
    );
  } else {
    lines.push(":white_check_mark: No bundle-size regressions detected.");
  }

  return lines.join("\n") + "\n";
}

/** CLI entrypoint. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baselinePath = args.baseline ? resolve(args.baseline) : DEFAULT_BASELINE;
  const currentPath = args.current ? resolve(args.current) : DEFAULT_CURRENT;
  const mdOut = args["md-out"] ? resolve(args["md-out"]) : DEFAULT_MD_OUT;
  const jsonOut = args["json-out"] ? resolve(args["json-out"]) : DEFAULT_JSON_OUT;
  const perChunkThreshold = args["per-chunk-threshold"]
    ? parseFloat(args["per-chunk-threshold"])
    : DEFAULT_PER_CHUNK_THRESHOLD;
  const totalThreshold = args["total-threshold"]
    ? parseFloat(args["total-threshold"])
    : DEFAULT_TOTAL_THRESHOLD;

  if (!existsSync(baselinePath)) {
    console.error(
      `compare-bundle: baseline missing at ${baselinePath}. ` +
        `Run 'npm run bundle:baseline:update' to seed it.`,
    );
    process.exit(1);
  }
  if (!existsSync(currentPath)) {
    console.error(
      `compare-bundle: current manifest missing at ${currentPath}. ` +
        `Run 'npm run bundle:manifest' first.`,
    );
    process.exit(1);
  }

  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const current = JSON.parse(await readFile(currentPath, "utf8"));

  const summary = compareBundle({
    baseline,
    current,
    perChunkThreshold,
    totalThreshold,
  });
  const markdown = renderMarkdown(summary);

  await writeFile(mdOut, markdown, "utf8");
  await writeFile(jsonOut, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  process.stdout.write(markdown);

  if (summary.exitCode === 1) {
    console.error("compare-bundle: per-chunk regression detected.");
  } else if (summary.exitCode === 2) {
    console.error("compare-bundle: aggregate gzip total grew past threshold.");
  }
  process.exit(summary.exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
