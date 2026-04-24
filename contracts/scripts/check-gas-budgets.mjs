#!/usr/bin/env node
/**
 * check-gas-budgets.mjs — regression guard for contract gas usage.
 *
 * Reads the output of `forge test --gas-report` (either from stdin
 * or by running forge itself), extracts per-contract per-function
 * Max gas values, and compares them against contracts/gas-budgets.json.
 * Exits 0 if every function is within budget; non-zero otherwise
 * with a human-readable diff.
 *
 * Usage:
 *
 *   # Run forge internally:
 *   node scripts/check-gas-budgets.mjs
 *
 *   # Or pipe existing output:
 *   forge test --gas-report | node scripts/check-gas-budgets.mjs --stdin
 *
 *   # Print currently-measured gas without budget comparison:
 *   node scripts/check-gas-budgets.mjs --measure-only
 *
 * Design notes:
 *
 *   - Pure Node, no deps. Zero-install runs in CI on any Node 18+.
 *   - Stdin mode lets CI re-use the already-captured gas-report.txt
 *     artefact without re-running forge.
 *   - The parser tolerates the forge report's box-drawing variations
 *     (╭╮╰╯ curly borders vs `+---+` ASCII) by stripping border chars
 *     before splitting on `|`.
 *   - Matches against contract-file paths (src/AgentBudget.sol) so
 *     test-only contracts like MockERC20 are ignored.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, "..");

// ─── Argument parsing ────────────────────────────────────

const args = new Set(process.argv.slice(2));
const stdinMode = args.has("--stdin");
const measureOnly = args.has("--measure-only");
const jsonMode = args.has("--json");

// ─── Load budgets ────────────────────────────────────────

const budgetsPath = resolve(contractsDir, "gas-budgets.json");
let budgets;
try {
  budgets = JSON.parse(readFileSync(budgetsPath, "utf-8"));
} catch (err) {
  console.error(`FATAL: cannot read ${budgetsPath}: ${err.message}`);
  process.exit(2);
}

// ─── Capture forge gas report ────────────────────────────

let report;
if (stdinMode) {
  report = readFileSync(0, "utf-8");
} else {
  const result = spawnSync("forge", ["test", "--gas-report"], {
    cwd: contractsDir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    console.error(`FATAL: forge invocation failed: ${result.error.message}`);
    process.exit(2);
  }
  if (result.status !== 0) {
    console.error("FATAL: forge test failed (tests must pass before gas budget check).");
    console.error(result.stderr);
    process.exit(2);
  }
  report = result.stdout;
}

// ─── Parse the report ────────────────────────────────────

/**
 * Foundry gas report structure (one block per contract):
 *
 *     ╭--...-╮
 *     | src/AgentBudget.sol:AgentBudget Contract | ... |
 *     +==================================================+
 *     | Deployment Cost | Deployment Size | ... | ... | ... |
 *     |-----------------+-----------------+-----+-----+-----|
 *     | 1488223         | 6740            |     |     |     |
 *     |-----------------+-----------------+-----+-----+-----|
 *     |                 |                 |     |     |     |
 *     |-----------------+-----------------+-----+-----+-----|
 *     | Function Name   | Min             | Avg | Med | Max | # Calls |
 *     |-----------------+-----------------+-----+-----+-----|
 *     | createBudget    | 22440           | ... | ... | 165790 | 15 |
 *     ...
 *     ╰--...-╯
 */
function parseReport(text) {
  const contracts = {};
  const lines = text.split("\n");
  let current = null;
  let seenDeploymentHeader = false;
  let seenFunctionHeader = false;

  for (const rawLine of lines) {
    // Strip ANSI colour codes and box-drawing characters for easier parsing.
    const line = stripAnsi(rawLine);
    const clean = line.replace(/[╭╮╰╯+=]+/g, "").trim();

    // Contract section header — match ANY .sol:X Contract line so the
    // parser correctly resets `current` between contracts, including
    // when a test-only contract (test/*.sol:MockFoo) precedes a
    // production-contract header. We filter in production contracts
    // (src/*.sol) by setting `current = null` for non-production ones,
    // which makes subsequent data rows skip cleanly.
    const anyHeaderMatch = clean.match(/^\|\s*(\S+\.sol:(\w+))\s+Contract\s*\|/);
    if (anyHeaderMatch) {
      const [, fqName, contractName] = anyHeaderMatch;
      if (fqName.startsWith("src/")) {
        current = {
          fqName,
          contractName,
          deployment: null,
          functions: {},
        };
        contracts[contractName] = current;
      } else {
        // Test-only or library contract — skip, but reset state so we
        // don't attribute the test contract's deployment / functions
        // to the previous in-scope contract.
        current = null;
      }
      seenDeploymentHeader = false;
      seenFunctionHeader = false;
      continue;
    }

    if (!current) continue;

    // Deployment header row.
    if (clean.includes("Deployment Cost") && clean.includes("Deployment Size")) {
      seenDeploymentHeader = true;
      seenFunctionHeader = false;
      continue;
    }

    // Function-table header.
    if (
      clean.match(/Function Name/i) &&
      clean.match(/\bMin\b/) &&
      clean.match(/\bMax\b/)
    ) {
      seenFunctionHeader = true;
      seenDeploymentHeader = false;
      continue;
    }

    // Data row — split on | and trim each cell.
    if (clean.startsWith("|")) {
      const cells = clean
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (cells.length === 0) continue;

      // Deployment row: first cell is the cost, second is size.
      if (seenDeploymentHeader && /^\d+$/.test(cells[0])) {
        current.deployment = {
          cost: Number(cells[0]),
          size: Number(cells[1]),
        };
        seenDeploymentHeader = false;
        continue;
      }

      // Function row: [name, min, avg, median, max, #calls]
      if (seenFunctionHeader && cells.length >= 6 && /^[a-zA-Z_$]/.test(cells[0])) {
        const [name, min, avg, median, max, calls] = cells;
        current.functions[name] = {
          min: Number(min),
          avg: Number(avg),
          median: Number(median),
          max: Number(max),
          calls: Number(calls),
        };
        continue;
      }
    }
  }

  return contracts;
}

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

const measured = parseReport(report);

// ─── Measure-only mode ───────────────────────────────────

if (measureOnly) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(measured, null, 2) + "\n");
  } else {
    for (const [name, contract] of Object.entries(measured)) {
      console.log(`\n${name} (${contract.fqName}):`);
      if (contract.deployment) {
        console.log(
          `  deployment: ${contract.deployment.cost} gas, ${contract.deployment.size} bytes`,
        );
      }
      for (const [fn, data] of Object.entries(contract.functions)) {
        console.log(
          `  ${fn.padEnd(24)} max=${String(data.max).padStart(7)}  avg=${String(data.avg).padStart(7)}  (${data.calls} calls)`,
        );
      }
    }
  }
  process.exit(0);
}

// ─── Compare against budgets ─────────────────────────────

const violations = [];
const missing = [];
const coverage = [];

for (const [contractName, contractBudget] of Object.entries(budgets.contracts)) {
  const measuredContract = measured[contractName];
  if (!measuredContract) {
    missing.push(`${contractName} — budget defined but contract not seen in gas report`);
    continue;
  }

  // Deployment check.
  if (contractBudget.deployment && measuredContract.deployment) {
    const actual = measuredContract.deployment.cost;
    const budget = contractBudget.deployment.maxGas;
    if (actual > budget) {
      violations.push({
        contract: contractName,
        subject: "deployment",
        actual,
        budget,
        excessPct: ((actual - budget) / budget) * 100,
      });
    } else {
      coverage.push({
        contract: contractName,
        subject: "deployment",
        actual,
        budget,
        headroomPct: ((budget - actual) / budget) * 100,
      });
    }
  }

  // Function checks.
  for (const [fn, fnBudget] of Object.entries(contractBudget.functions)) {
    const measuredFn = measuredContract.functions[fn];
    if (!measuredFn) {
      missing.push(`${contractName}.${fn} — budget defined but not exercised by tests`);
      continue;
    }
    const actual = measuredFn.max;
    const budget = fnBudget.maxGas;
    if (actual > budget) {
      violations.push({
        contract: contractName,
        subject: fn,
        actual,
        budget,
        excessPct: ((actual - budget) / budget) * 100,
      });
    } else {
      coverage.push({
        contract: contractName,
        subject: fn,
        actual,
        budget,
        headroomPct: ((budget - actual) / budget) * 100,
      });
    }
  }
}

// ─── Report ──────────────────────────────────────────────

if (jsonMode) {
  process.stdout.write(
    JSON.stringify({ violations, missing, coverage, measured }, null, 2) + "\n",
  );
  process.exit(violations.length > 0 ? 1 : 0);
}

console.log(`\nGas budget check — ${Object.keys(measured).length} contract(s) measured.`);
console.log("─".repeat(78));

if (coverage.length > 0) {
  console.log("\n  Within budget:");
  for (const c of coverage) {
    console.log(
      `    ✓ ${`${c.contract}.${c.subject}`.padEnd(40)} ${String(c.actual).padStart(7)} / ${String(c.budget).padStart(7)}  (${c.headroomPct.toFixed(1)}% headroom)`,
    );
  }
}

if (missing.length > 0) {
  console.log("\n  Not exercised by tests:");
  for (const m of missing) console.log(`    ⚠ ${m}`);
}

if (violations.length > 0) {
  console.log("\n  BUDGET VIOLATIONS:");
  for (const v of violations) {
    console.log(
      `    ✗ ${`${v.contract}.${v.subject}`.padEnd(40)} ${String(v.actual).padStart(7)} / ${String(v.budget).padStart(7)}  (exceeds budget by ${v.excessPct.toFixed(1)}%)`,
    );
  }
  console.log(
    `\n  ${violations.length} function(s) exceeded budget. Fix the regression or update gas-budgets.json in the same commit that adds the gas.`,
  );
  process.exit(1);
}

console.log("\n  ✓ All measured functions within budget.");
process.exit(0);
