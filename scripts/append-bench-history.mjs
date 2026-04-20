#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * append-bench-history.mjs — rolling benchmark archive
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Consumes the JSON report produced by `vitest bench --reporter=json`
 * and appends a single newline-delimited record to
 * `docs/perf/bench-history.jsonl`. Each record is one commit's worth
 * of benchmark results; the file is append-only by policy (every write
 * is additive) so the running history behaves like an immutable event
 * log that downstream dashboards can tail.
 *
 * Record shape (one line of JSONL):
 *   {
 *     "ts": 1713523200000,                      // ms since epoch
 *     "commit": "abc123...",                    // full git sha
 *     "ref": "refs/heads/main",
 *     "benches": [
 *       {
 *         "file": "packages/core/bench/signer.bench.ts",
 *         "name": "EIP-1559 tx signing throughput (target ≥ 500 ops/s)",
 *         "hz": 812.4,                          // ops/sec (mean)
 *         "mean": 0.00123,                      // seconds / op
 *         "rme": 1.4,                           // relative margin of error, %
 *         "samples": 64
 *       },
 *       ...
 *     ]
 *   }
 *
 * Regression detection (future work, stub-only today): once we have
 * seven days of records, the `check-bench-regression.mjs` companion
 * script will compute a p50 over the trailing 7-day window for each
 * `{file, name}` pair and fail CI if the latest run is >20% slower.
 * The 7-day window is enough to average out CPU variance without being
 * so old that the number is stale after intentional optimizations.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { readFile, appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

/** Parse --key value CLI flags into a plain object. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = value;
    i++;
  }
  return out;
}

/**
 * Normalize the vitest json reporter output to the flat record shape we
 * persist in history. Vitest's schema is `{ files: [{ filepath, tasks:
 * [{ name, benchmark: { ... } }] }] }`; we're flattening to an array so
 * downstream consumers don't need to re-traverse.
 *
 * Any malformed entry is skipped with a warning — we'd rather record a
 * partial run than fail the whole append.
 */
function flattenBenches(json) {
  const out = [];
  if (!json || !Array.isArray(json.files)) return out;

  for (const file of json.files) {
    const tasks = Array.isArray(file.tasks) ? file.tasks : [];
    for (const task of tasks) {
      // vitest nests describe blocks — walk their tasks recursively.
      const flatTasks = flattenTasks(task);
      for (const t of flatTasks) {
        const b = t.result?.benchmark;
        if (!b) continue;
        out.push({
          file: String(file.filepath ?? "unknown").split("/wallet/").pop() ?? "unknown",
          name: String(t.name ?? "unnamed"),
          hz: Number.isFinite(b.hz) ? Number(b.hz) : null,
          mean: Number.isFinite(b.mean) ? Number(b.mean) : null,
          rme: Number.isFinite(b.rme) ? Number(b.rme) : null,
          samples: Array.isArray(b.samples) ? b.samples.length : null,
        });
      }
    }
  }
  return out;
}

/** Recursively collect leaf tasks (actual `bench(...)` calls). */
function flattenTasks(task) {
  if (!task) return [];
  if (Array.isArray(task.tasks) && task.tasks.length > 0) {
    return task.tasks.flatMap(flattenTasks);
  }
  return [task];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const latestPath = args.latest;
  const historyPath = args.history;
  const commit = typeof args.commit === "string" ? args.commit : "";
  const ref = typeof args.ref === "string" ? args.ref : "";

  if (!latestPath || !historyPath) {
    console.error(
      "append-bench-history: --latest <json> and --history <jsonl> are required",
    );
    process.exit(2);
  }

  let raw;
  try {
    raw = await readFile(latestPath, "utf8");
  } catch (err) {
    console.error(
      `append-bench-history: unable to read ${latestPath}: ${err.message}`,
    );
    process.exit(2);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(
      `append-bench-history: unable to parse ${latestPath}: ${err.message}`,
    );
    process.exit(2);
  }

  const benches = flattenBenches(parsed);
  if (benches.length === 0) {
    console.error(
      "append-bench-history: no benchmarks found in report — skipping append",
    );
    return;
  }

  const record = {
    ts: Date.now(),
    commit,
    ref,
    benches,
  };

  await mkdir(dirname(historyPath), { recursive: true });
  await appendFile(historyPath, JSON.stringify(record) + "\n");
  console.log(
    `append-bench-history: recorded ${benches.length} benchmarks for commit ${commit || "unknown"}`,
  );
}

main().catch((err) => {
  console.error("append-bench-history: fatal", err);
  process.exit(1);
});
