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
  const denyMode = args.has("--deny");
  const helpMode = args.has("--help") || args.has("-h");

  if (helpMode) {
    process.stdout.write(
      [
        "aethelred-solver-trio-demo — proves the Solver contract composes across intent kinds",
        "",
        "Usage:",
        "  aethelred-solver-trio-demo [--json|--quiet|--deny]",
        "",
        "Flags:",
        "  --json     Emit structured JSON result to stdout",
        "  --quiet    Exit-code-only; no output on success",
        "  --deny     Run with an UNREGISTERED agent — gates reject every intent.",
        "             Exit code 0 only when ALL THREE gates denied as expected.",
        "             Use for narrative demos + CI guards on rejection behaviour.",
        "  --help, -h Show this help",
        "",
        "The flow exercised:",
        "  1. Build ONE IntentRouter with:",
        "       - ONE SolverRegistry holding three concrete solvers:",
        "           TransferSolver (transfer ===)",
        "           SwapSolver + StubSwapVenue (swap >=)",
        "           X402FacilitatorSolver (payment <=)",
        "       - ONE composed paymentGate holding three reputation gates:",
        "           ReputationTransferGate (operator-declared policy)",
        "           ReputationSwapGate     (operator-declared policy)",
        "           ReputationPaymentGate  (counterparty-declared via intent.extra.vcGate)",
        "  2. Sign three intents (one per kind) with a single LocalKey agent",
        "     (default mode: ERC-8004-registered; --deny: NOT registered)",
        "  3. router.execute() each — watch registry dispatch + gate dispatch",
        "     converge on the same intent kind",
        "  4. Verify each commitment rule holds AND each gate evaluation allowed",
        "     (or in --deny mode: every intent is payment-gated with failedRuleIds)",
        "",
      ].join("\n"),
    );
    return;
  }

  const started = Date.now();
  let result;
  try {
    result = await runSolverTrioDemo({
      skipAgentRegistration: denyMode,
    });
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
          mode: result.denyModeExpected ? "deny" : "allow",
          agentAddress: result.agentAddress,
          chainId: result.chainId,
          operatorPolicy: result.operatorPolicy,
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
            gate: r.gateResult
              ? {
                  allowed: r.gateResult.allowed,
                  failedRuleIds: r.gateResult.failedRuleIds ?? [],
                  ruleCount: r.gateResult.evaluation?.results.length ?? 0,
                }
              : null,
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
  const bannerTitle = result.denyModeExpected
    ? "Aethelred solver trio — proof of dispatch (DENY MODE)"
    : "Aethelred solver trio — proof of dispatch";
  lines.push(banner(bannerTitle));
  lines.push("");
  const headerSummary = result.denyModeExpected
    ? `${ANSI.dim}Completed in${ANSI.reset} ${color(
        ANSI.bold + ANSI.green,
        `${elapsedMs}ms`,
      )}  ·  ${color(
        ANSI.bold + ANSI.red,
        "agent NOT registered",
      )}  ·  3 gates evaluated  ·  ${result.auditEvents.length} audit events`
    : `${ANSI.dim}Completed in${ANSI.reset} ${color(
        ANSI.bold + ANSI.green,
        `${elapsedMs}ms`,
      )}  ·  3 solvers dispatched  ·  3 gates evaluated  ·  ${result.auditEvents.length} audit events`;
  lines.push(headerSummary);
  lines.push("");

  // Operator policy summary — shown BEFORE the matrix so the reader
  // knows what directives are being applied.
  lines.push(color(ANSI.bold, "Operator policy (applied to all three gates)"));
  lines.push(color(ANSI.dim, "─".repeat(80)));
  lines.push(
    `  ${color(ANSI.dim, "combinator:")} ${color(ANSI.yellow, result.operatorPolicy.combinator)}`,
  );
  for (const directive of result.operatorPolicy.directives) {
    const dirStr = directiveLabel(directive);
    lines.push(`  ${color(ANSI.dim, "directive: ")} ${color(ANSI.cyan, dirStr)}`);
  }
  lines.push("");

  lines.push(color(ANSI.bold, "Commitment-rule matrix (with gate evaluations)"));
  lines.push(color(ANSI.dim, "─".repeat(80)));

  // Table columns: kind · label · solverId · rule · commitment · actual · held? · gate
  const rows: string[][] = [
    [
      "kind",
      "label",
      "solver id",
      "rule",
      "commitment",
      "actual",
      "held?",
      "gate",
    ],
  ];
  for (const r of result.results) {
    const kindCol = color(KIND_COLOR[r.kind] ?? ANSI.gray, r.kind);
    // In deny mode the intent is payment-gated, so no fill exists
    // and "held?" is N/A — render as a dim dash rather than a red ✗,
    // which would suggest a bug.
    const heldCol = r.fill
      ? r.commitmentRuleHeld
        ? color(ANSI.bold + ANSI.green, "✓")
        : color(ANSI.bold + ANSI.red, "✗")
      : color(ANSI.dim, "n/a");
    const gateCol = renderGateCell(r.gateResult);
    rows.push([
      kindCol,
      r.label,
      color(ANSI.dim, r.solverId),
      color(ANSI.yellow, r.rule),
      r.fill?.quoteCommitment ?? "—",
      r.fill?.actualAmount ?? "—",
      heldCol,
      gateCol,
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

  // Settlement refs (tx hashes / payment ids) — only shown in
  // allow mode. Deny mode has no settlements; showing the section
  // with "—" for all three would be misleading.
  if (!result.denyModeExpected) {
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
  }

  // Outcome kinds — especially useful in deny mode where every
  // intent hits payment-gated instead of fulfilled.
  lines.push(color(ANSI.bold, "Router outcomes"));
  lines.push(color(ANSI.dim, "─".repeat(80)));
  for (const r of result.results) {
    const outcomeKind = r.executionResult.outcome.kind;
    const outcomeColor =
      outcomeKind === "fulfilled"
        ? ANSI.bold + ANSI.green
        : outcomeKind === "payment-gated"
          ? ANSI.bold + ANSI.yellow
          : ANSI.bold + ANSI.red;
    lines.push(
      `  ${color(KIND_COLOR[r.kind] ?? ANSI.gray, pad(r.kind, 10))} ${color(outcomeColor, outcomeKind)}`,
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

  // Success criterion differs by mode:
  //   Allow mode: every intent fulfilled + gate allowed + rule held
  //   Deny mode : every intent payment-gated + gate denied
  //               (inverted — denial IS the expected behaviour)
  let finalLine: string;
  let exitCode = 0;
  if (result.denyModeExpected) {
    const allDenied = result.results.every(
      (r) =>
        r.gateResult?.allowed === false &&
        r.executionResult.outcome.kind === "payment-gated",
    );
    if (allDenied) {
      finalLine = color(
        ANSI.bold + ANSI.green,
        "✓ three gates rejected three intents — denial path verified",
      );
    } else {
      finalLine = color(
        ANSI.bold + ANSI.red,
        "✗ at least one gate did NOT deny as expected — see above",
      );
      exitCode = 1;
    }
  } else {
    const allHeld = result.results.every((r) => r.commitmentRuleHeld);
    const allGatesAllowed = result.results.every(
      (r) => r.gateResult?.allowed === true,
    );
    if (allHeld && allGatesAllowed) {
      finalLine = color(
        ANSI.bold + ANSI.green,
        "✓ three solvers, three gates, three commitment rules, one router — all verified",
      );
    } else {
      finalLine = color(
        ANSI.bold + ANSI.red,
        "✗ at least one check did NOT hold — see above",
      );
      exitCode = 1;
    }
  }
  lines.push(finalLine);
  lines.push("");

  process.stdout.write(lines.join("\n"));
  if (exitCode !== 0) process.exit(exitCode);
}

/** Human-readable label for a serialised gate directive. */
function directiveLabel(d: {
  readonly type: string;
  readonly [k: string]: unknown;
}): string {
  switch (d.type) {
    case "require-registered-agent":
      return "require-registered-agent";
    case "require-not-revoked":
      return "require-not-revoked";
    case "require-min-reputation":
      return `require-min-reputation:${(d as { minScore: number }).minScore}`;
    case "require-min-tier":
      return `require-min-tier:${(d as { minTier: string }).minTier}`;
    case "require-vc":
      return `require-vc:${(d as { schemaId: string }).schemaId}`;
    case "require-fresh-vc":
      return `require-fresh-vc:${(d as { schemaId: string }).schemaId}`;
    default:
      return String(d.type);
  }
}

/** Render the gate column cell — ✓ allow or ✗ + failed rule ids. */
function renderGateCell(
  gateResult: { readonly allowed: boolean; readonly failedRuleIds?: ReadonlyArray<string> } | undefined,
): string {
  if (!gateResult) return color(ANSI.gray, "—");
  if (gateResult.allowed) return color(ANSI.bold + ANSI.green, "✓ allowed");
  const failed = (gateResult.failedRuleIds ?? []).join(", ") || "unknown";
  return color(ANSI.bold + ANSI.red, `✗ denied: ${failed}`);
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
