#!/usr/bin/env node
/**
 * Aethelred Wallet — Dead-export CI gate.
 *
 * Wraps `ts-unused-exports` with a ratchet policy:
 *
 *   1. Runs ts-unused-exports against a scan tsconfig that INCLUDES
 *      tests as sources (so `*ForTests` helpers have visible consumers).
 *
 *   2. Compares current findings against a committed baseline in
 *      `reports/dead-exports.baseline.json`.
 *
 *   3. Exits non-zero if either:
 *        (a) A finding appears that is NOT in the baseline   - regression
 *            (you've added a new dead export; fix it or update baseline
 *            with explicit approval).
 *        (b) A finding in the baseline is no longer reported - stale
 *            (remove from baseline to keep it minimal; encourages the
 *            ratchet to only ever shrink).
 *
 * The baseline is the pragmatic answer to "these exports are public
 * API surface in a library package" - TypeScript cannot distinguish
 * between "exported to internal consumer code" vs. "exported for a
 * hypothetical future consumer." Rather than delete legitimate types
 * like `CardProps` (whose only sin is being a library prop type), we
 * snapshot the current set, block NEW additions, and require any
 * modification to the baseline to be explicit and reviewed.
 *
 * Invocation:
 *   node scripts/check-dead-exports.mjs              # ratchet-check
 *   node scripts/check-dead-exports.mjs --update     # rewrite baseline
 *
 * Exit codes:
 *   0 - no new dead exports; baseline matches reality
 *   1 - regression: new dead export found OR baseline has stale entries
 *   2 - configuration error (e.g. ts-unused-exports failed to run)
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const baselinePath = resolve(repoRoot, "reports/dead-exports.baseline.json");
const shouldUpdate = process.argv.includes("--update");

/**
 * Shell out to ts-unused-exports with the scan tsconfig. The scan
 * tsconfig is separate from the build tsconfig because it intentionally
 * includes test sources; see apps/extension/tsconfig.deadcode.json.
 *
 * spawnSync with an args array (not exec) prevents any shell injection
 * because arguments are passed directly to the OS-level spawn call.
 */
function runScan() {
  const tsconfig = resolve(repoRoot, "tsconfig.deadcode.json");
  const result = spawnSync(
    "npx",
    [
      "--no-install",
      "ts-unused-exports",
      tsconfig,
      // .stories.* files are excluded from the build tsconfig too; keep
      // them excluded here so Storybook-only exports don't show up.
      "--ignoreFiles=(\\.stories\\.)",
      "--showLineNumber",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  if (result.error) {
    console.error("Failed to run ts-unused-exports:", result.error);
    process.exit(2);
  }
  // ts-unused-exports returns non-zero whenever it finds unused exports.
  // That's expected - the exit code is meaningful to us only as "it ran
  // without an infrastructure error." Distinguishing these: if stdout is
  // empty but exit is non-zero, it's a real failure (e.g. config error).
  if (!result.stdout && result.status !== 0) {
    console.error("ts-unused-exports exited with no output:", result.stderr);
    process.exit(2);
  }
  return result.stdout || "";
}

/**
 * Parse ts-unused-exports stdout into a normalized set of findings,
 * each of the form "<relative-path>: <identifier>". The line number
 * is discarded - shifting an export a few lines should not be flagged
 * as a "new" finding. Matching is by (path, identifier) pair.
 */
function parseFindings(stdout) {
  const findings = new Set();
  const lines = stdout.split("\n").filter(Boolean);
  for (const line of lines) {
    // First line is a summary like "44 modules with unused exports"
    if (/^\d+ modules? with unused exports/.test(line)) continue;
    // Format A: "<abs-path>[line,col]: identifier"
    // Format B: "<abs-path>: identifier"   (for re-exports from barrels)
    const match =
      /^(.+?\.tsx?)(?:\[\d+,\d+\])?: (.+)$/.exec(line) ||
      /^(.+?\.ts)(?:\[\d+,\d+\])?: (.+)$/.exec(line);
    if (!match) continue;
    const [, absPath, identifier] = match;
    const relPath = relative(repoRoot, absPath).replace(/\\/g, "/");
    findings.add(`${relPath}: ${identifier.trim()}`);
  }
  return findings;
}

function loadBaseline() {
  if (!existsSync(baselinePath)) {
    return { entries: [], rationale: {} };
  }
  return JSON.parse(readFileSync(baselinePath, "utf8"));
}

function writeBaseline(findings) {
  const dir = dirname(baselinePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const entries = Array.from(findings).sort();
  const baseline = loadBaseline();
  const payload = {
    "//": [
      "Dead-export baseline for ts-unused-exports.",
      "Entries here are KNOWN-exported-but-not-imported identifiers that",
      "the CI gate tolerates. Add to this list ONLY with an explicit",
      "`rationale` entry explaining why (e.g. 'library prop type exported",
      "for consumers', 'test helper used via vi.mock indirection').",
      "Any finding not in this list fails CI.",
    ],
    entries,
    rationale: baseline.rationale || {},
  };
  writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + "\n");
}

function main() {
  const stdout = runScan();
  const current = parseFindings(stdout);

  if (shouldUpdate) {
    writeBaseline(current);
    console.log(
      `Updated ${relative(repoRoot, baselinePath)} with ${current.size} entries.`,
    );
    return;
  }

  const baseline = loadBaseline();
  const baselineSet = new Set(baseline.entries || []);

  // New findings not in baseline = regressions.
  const regressions = [...current].filter((f) => !baselineSet.has(f)).sort();
  // Baseline entries no longer present = stale.
  const stale = [...baselineSet].filter((f) => !current.has(f)).sort();

  if (regressions.length === 0 && stale.length === 0) {
    console.log(
      `Dead-export gate: OK (baseline: ${baselineSet.size}, current: ${current.size})`,
    );
    return;
  }

  if (regressions.length > 0) {
    console.error("");
    console.error("Dead-export regression - new unused exports detected:");
    console.error("");
    for (const r of regressions) console.error(`  + ${r}`);
    console.error("");
    console.error(
      "Fix: delete the export, connect it to a consumer, or (with review)",
    );
    console.error(
      "     add it to reports/dead-exports.baseline.json with a rationale.",
    );
  }

  if (stale.length > 0) {
    console.error("");
    console.error("Dead-export baseline has stale entries (exports are now");
    console.error("referenced or removed - update the baseline to keep it");
    console.error("minimal):");
    console.error("");
    for (const s of stale) console.error(`  - ${s}`);
    console.error("");
    console.error("Fix: run `npm run lint:dead-code:update` and commit.");
  }

  process.exit(1);
}

main();
