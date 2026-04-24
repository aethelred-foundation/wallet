#!/usr/bin/env node
/**
 * `aethelred-solver-trio-demo` — runnable proof-of-dispatch CLI.
 *
 * Sibling to `aethelred-moat-demo`. Where the moat demo shows
 * compliance depth (one intent, every gate), this one shows
 * dispatch breadth (three intents, one router, one registry,
 * three concrete solvers, three commitment rules).
 *
 * Output tiers:
 *
 *   - Default — ASCII table showing per-intent commitment proof.
 *   - `--json` — pure JSON (pipe into `jq` or a deck generator).
 *   - `--quiet` — exit-code-only (0 on success).
 *
 * Zero runtime deps beyond the integration package.
 */

import { runSolverTrioDemo } from "../src/solver-trio-demo";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

const KIND_COLOR: Record<string, string> = {
  transfer: ANSI.magenta,
  swap: ANSI.cyan,
  payment: ANSI.yellow,
};

function color(code: string, s: string): string {
  return `${code}${s}${ANSI.reset}`;
}

function banner(text: string): string {
  const line = "═".repeat(Math.min(80, text.length + 4));
  return `${ANSI.bold}${ANSI.cyan}╔${line}╗\n║  ${text}  ║\n╚${line}╝${ANSI.reset}`;
}

function pad(s: string, len: number): string {
  if (s.length >= len) return s;
  return s + " ".repeat(len - s.length);
}

function padRight(s: string, len: number): string {
  return s + " ".repeat(Math.max(0, len - visibleLength(s)));
}

function visibleLength(s: string): number {
  // Strip ANSI escapes for width math.
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const jsonMode = args.has("--json");
  const quietMode = args.has("--quiet");
  const helpMode = args.has("--help") || args.has("-h");

  if (helpMode) {
    process.stdout.write(
      [
        "aethelred-solver-trio-demo — proves the Solver contract composes across intent kinds",
        "",
        "Usage:",
        "  aethelred-solver-trio-demo [--json|--quiet]",
        "",
        "Flags:",
        "  --json     Emit structured JSON result to stdout",
        "  --quiet    Exit-code-only; no output on success",
        "  --help, -h Show this help",
        "",
        "The flow exercised:",
        "  1. Build ONE IntentRouter with ONE registry holding three concrete solvers:",
        "       - TransferSolver (transfer ===)",
        "       - SwapSolver + StubSwapVenue (swap >=)",
        "       - X402FacilitatorSolver (payment <=)",
        "  2. Sign three intents (one per kind) with a single LocalKey agent",
        "  3. router.execute() each — watch the registry dispatch to the right solver",
        "  4. Verify each commitment rule holds on the returned Fill",
        "",
      ].join("\n"),
    );
    return;
  }

  const started = Date.now();
  let result;
  try {
    result = await runSolverTrioDemo();
  } catch (err) {
    if (!quietMode) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `${color(ANSI.red + ANSI.bold, "DEMO FAILED:")} ${msg}\n`,
      );
    }
    process.exit(1);
  }
  const elapsedMs = Date.now() - started;

  if (quietMode) return;

  if (jsonMode) {
    process.stdout.write(
      JSON.stringify(
        {
          elapsedMs,
          agentAddress: result.agentAddress,
          chainId: result.chainId,
          results: result.results.map((r) => ({
            kind: r.kind,
            label: r.label,
            rule: r.rule,
            solverId: r.solverId,
            intentId: r.intent.envelope.id,
            outcome: r.executionResult.outcome.kind,
            commitmentRuleHeld: r.commitmentRuleHeld,
            quoteCommitment: r.fill?.quoteCommitment,
            actualAmount: r.fill?.actualAmount,
            settlementRef: r.fill?.settlementRef,
          })),
          auditEventCount: result.auditEvents.length,
          auditEventTypes: countBy(result.auditEvents.map((e) => e.type)),
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  // Default: ASCII table.
  const lines: string[] = [];
  lines.push("");
  lines.push(banner("Aethelred solver trio — proof of dispatch"));
  lines.push("");
  lines.push(
    `${ANSI.dim}Completed in${ANSI.reset} ${color(
      ANSI.bold + ANSI.green,
      `${elapsedMs}ms`,
    )}  ·  3 solvers dispatched  ·  ${result.auditEvents.length} audit events`,
  );
  lines.push("");
  lines.push(color(ANSI.bold, "Commitment-rule matrix"));
  lines.push(color(ANSI.dim, "─".repeat(80)));

  // Table columns: kind · label · solverId · rule · commitment · actual · held?
  const rows: string[][] = [
    ["kind", "label", "solver id", "rule", "commitment", "actual", "held?"],
  ];
  for (const r of result.results) {
    const kindCol = color(KIND_COLOR[r.kind] ?? ANSI.gray, r.kind);
    const heldCol = r.commitmentRuleHeld
      ? color(ANSI.bold + ANSI.green, "✓")
      : color(ANSI.bold + ANSI.red, "✗");
    rows.push([
      kindCol,
      r.label,
      color(ANSI.dim, r.solverId),
      color(ANSI.yellow, r.rule),
      r.fill?.quoteCommitment ?? "—",
      r.fill?.actualAmount ?? "—",
      heldCol,
    ]);
  }
  const widths = rows[0].map((_, colIdx) =>
    Math.max(...rows.map((row) => visibleLength(row[colIdx]))),
  );
  const renderRow = (row: string[]) =>
    "  " + row.map((cell, i) => padRight(cell, widths[i])).join("  │  ");
  lines.push(renderRow(rows[0]));
  lines.push(
    "  " +
      color(
        ANSI.dim,
        widths.map((w) => "─".repeat(w)).join("──┼──"),
      ),
  );
  for (const row of rows.slice(1)) lines.push(renderRow(row));
  lines.push("");

  // Settlement refs (tx hashes / payment ids) — the audit anchors.
  lines.push(color(ANSI.bold, "Settlement refs"));
  lines.push(color(ANSI.dim, "─".repeat(80)));
  for (const r of result.results) {
    const ref = r.fill?.settlementRef ?? "—";
    const short = shortHex(ref, 22);
    lines.push(
      `  ${color(KIND_COLOR[r.kind] ?? ANSI.gray, pad(r.kind, 10))} ${short}`,
    );
  }
  lines.push("");

  // Audit event counts — shows the router emitted each stage for each intent.
  lines.push(color(ANSI.bold, "Intent-router audit events"));
  lines.push(color(ANSI.dim, "─".repeat(80)));
  const counts = countBy(result.auditEvents.map((e) => e.type));
  for (const [type, count] of Object.entries(counts)) {
    lines.push(`  ${color(ANSI.yellow, pad(type, 28))} × ${count}`);
  }
  lines.push("");

  const allHeld = result.results.every((r) => r.commitmentRuleHeld);
  lines.push(
    allHeld
      ? color(
          ANSI.bold + ANSI.green,
          "✓ three solvers, three commitment rules, one router — all verified",
        )
      : color(
          ANSI.bold + ANSI.red,
          "✗ at least one commitment rule did NOT hold — see above",
        ),
  );
  lines.push("");

  process.stdout.write(lines.join("\n"));
  if (!allHeld) process.exit(1);
}

function shortHex(hex: string, len: number): string {
  if (hex.length <= len) return hex;
  const half = Math.floor((len - 1) / 2);
  return `${hex.slice(0, half + 1)}…${hex.slice(-half)}`;
}

function countBy(items: ReadonlyArray<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[item] = (out[item] ?? 0) + 1;
  return out;
}

main().catch((err) => {
  process.stderr.write(
    `unhandled error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
