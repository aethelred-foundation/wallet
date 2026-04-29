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

import { renderHtmlDashboard } from "../src/render-html";
import { runSolverTrioDemo } from "../src/solver-trio-demo";
import {
  InMemoryMeter,
  SolverGasHistogram,
  fillToGasSample,
} from "@aethelred/wallet-observability";

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
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const jsonMode = args.has("--json");
  const quietMode = args.has("--quiet");
  const denyMode = args.has("--deny");
  const promMode = args.has("--prom");
  const htmlMode = args.has("--html");
  const helpMode = args.has("--help") || args.has("-h");
  // Parse `--samples N` (or `--samples=N`). Default 1.
  let samples = 1;
  // Parse `--venue stub|uniswap-v3` (or `--venue=...`). Default "stub".
  let swapVenue: "stub" | "uniswap-v3" = "stub";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--samples" && i + 1 < argv.length) {
      samples = parsePositiveInt(argv[i + 1]!) ?? 1;
      i++;
    } else if (a.startsWith("--samples=")) {
      samples = parsePositiveInt(a.slice("--samples=".length)) ?? 1;
    } else if (a === "--venue" && i + 1 < argv.length) {
      swapVenue = parseVenue(argv[i + 1]!) ?? "stub";
      i++;
    } else if (a.startsWith("--venue=")) {
      swapVenue = parseVenue(a.slice("--venue=".length)) ?? "stub";
    }
  }

  if (helpMode) {
    process.stdout.write(
      [
        "aethelred-solver-trio-demo — proves the Solver contract composes across intent kinds",
        "",
        "Usage:",
        "  aethelred-solver-trio-demo [--json|--quiet|--deny|--prom|--html] [--samples N] [--venue stub|uniswap-v3]",
        "",
        "Flags:",
        "  --json        Emit structured JSON result to stdout",
        "  --quiet       Exit-code-only; no output on success",
        "  --deny        Run with an UNREGISTERED agent — gates reject every intent.",
        "                Exit code 0 only when ALL THREE gates denied as expected.",
        "                Use for narrative demos + CI guards on rejection behaviour.",
        "  --prom        Emit Prometheus-scrape format with the histogram bridged",
        "                into an InMemoryMeter. Combine with --samples N for spread.",
        "  --html        Emit a self-contained HTML dashboard for stakeholder sharing.",
        "                Single file, zero deps, opens offline. Pipe to a .html file:",
        "                  aethelred-solver-trio-demo --html --samples 50 > demo.html",
        "  --samples N   Run each intent kind N times (default 1). Higher N gives",
        "                meaningful per-solver gas histogram percentiles (p50/p95/p99).",
        "                The first run of each kind is captured for the matrix table;",
        "                additional runs feed the SolverGasHistogram only.",
        "  --venue NAME  Which SwapVenue the swap-solver uses:",
        "                  stub        — StubSwapVenue (default; deterministic, no eth_call)",
        "                  uniswap-v3  — UniswapV3SwapVenue with stubbed eth_call transport",
        "                                (production path: [approve, swap] two-tx sequence,",
        "                                Pool Swap event decoded from receipt logs).",
        "  --help, -h    Show this help",
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
      samples,
      swapVenue,
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

  // --html: render a self-contained HTML dashboard. Mutually
  // exclusive with --json/--prom; --html takes precedence when
  // multiple are passed. Stakeholders without CLI fluency open
  // the file directly; SREs run --prom, devs run --json.
  if (htmlMode) {
    process.stdout.write(
      renderHtmlDashboard(result, { samples }),
    );
    return;
  }

  // --prom: bridge the orchestrator's live SolverGasHistogram
  // into an InMemoryMeter and dump Prometheus scrape format.
  // This is what an SRE sees scraping the wallet's /metrics
  // endpoint in production: per-solver percentiles + cumulative
  // cost counters with `solver_id` labels.
  // Mutually exclusive with --json; --prom takes precedence.
  if (promMode) {
    const meter = new InMemoryMeter();
    result.gasHistogramInstance.exportToMeter(meter);
    process.stdout.write(meter.toPrometheus());
    return;
  }

  if (jsonMode) {
    process.stdout.write(
      JSON.stringify(
        {
          elapsedMs,
          mode: result.denyModeExpected ? "deny" : "allow",
          samples,
          swapVenue: result.swapVenueId,
          agentAddress: result.agentAddress,
          chainId: result.chainId,
          operatorPolicy: result.operatorPolicy,
          gasHistogram: [...result.gasHistogram.entries()].map(
            ([solverId, stats]) => ({
              solverId,
              count: stats.count,
              mean: stats.mean.toString(),
              p50: stats.p50.toString(),
              p95: stats.p95.toString(),
              p99: stats.p99.toString(),
              min: stats.min.toString(),
              max: stats.max.toString(),
              totalCostWei: stats.totalCostWei.toString(),
              costSampleCount: stats.costSampleCount,
            }),
          ),
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
            gas: extractGas(r),
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

  // Table columns: kind · label · solverId · rule · commitment · actual · held? · gate · gas
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
      "gas",
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
    const gasCol = renderGasCell(r);
    rows.push([
      kindCol,
      r.label,
      color(ANSI.dim, r.solverId),
      color(ANSI.yellow, r.rule),
      r.fill?.quoteCommitment ?? "—",
      r.fill?.actualAmount ?? "—",
      heldCol,
      gateCol,
      gasCol,
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

  // Per-solver gas — only shown in allow mode (deny mode has no
  // settlements and therefore no gas data). Observability pipelines
  // would normally sum these across many fills into a histogram;
  // this section shows the per-intent breakdown the histogram is
  // built from.
  if (!result.denyModeExpected) {
    lines.push(color(ANSI.bold, "Per-solver gas telemetry"));
    lines.push(color(ANSI.dim, "─".repeat(80)));
    let totalGas = 0n;
    let totalCostWei = 0n;
    let haveTotals = true;
    for (const r of result.results) {
      const gas = extractGas(r);
      if (r.kind === "payment") {
        lines.push(
          `  ${color(KIND_COLOR[r.kind] ?? ANSI.gray, pad(r.kind, 10))} ${color(ANSI.dim, "facilitator pays gas — not attributed to agent")}`,
        );
        continue;
      }
      if (!gas.gasUsed) {
        haveTotals = false;
        lines.push(
          `  ${color(KIND_COLOR[r.kind] ?? ANSI.gray, pad(r.kind, 10))} ${color(ANSI.gray, "no gas data on receipt")}`,
        );
        continue;
      }
      try {
        totalGas += BigInt(gas.gasUsed);
      } catch {
        haveTotals = false;
      }
      try {
        if (gas.gasCostWei) totalCostWei += BigInt(gas.gasCostWei);
      } catch {
        haveTotals = false;
      }
      const perTx = gas.perTxGasUsed
        ? `  (${gas.perTxGasUsed.map((g) => (g ? formatGas(g) : "—")).join(" + ")})`
        : "";
      lines.push(
        `  ${color(KIND_COLOR[r.kind] ?? ANSI.gray, pad(r.kind, 10))} ${color(
          ANSI.cyan,
          pad(formatGas(gas.gasUsed), 8),
        )}${color(ANSI.dim, perTx)}`,
      );
    }
    if (haveTotals && totalGas > 0n) {
      lines.push(color(ANSI.dim, "  ".padStart(12) + "─".repeat(40)));
      lines.push(
        `  ${color(ANSI.bold, pad("total", 10))} ${color(
          ANSI.bold + ANSI.cyan,
          formatGas(totalGas.toString()),
        )}  ${color(ANSI.dim, `(${totalCostWei.toString()} wei, on-chain only)`)}`,
      );
    }
    lines.push("");
  }

  // Histogram view — only meaningful in allow mode AND when
  // samples > 1 (otherwise p50=p95=mean=min=max and the row is
  // visually noisy without informing). When samples === 1 we
  // skip this section but the structure is still in result.gasHistogram
  // for programmatic consumers (JSON / tests).
  if (!result.denyModeExpected && samples > 1 && result.gasHistogram.size > 0) {
    lines.push(
      color(
        ANSI.bold,
        `Per-solver gas histogram (across ${samples} samples × 3 kinds = ${samples * 3} fills)`,
      ),
    );
    lines.push(color(ANSI.dim, "─".repeat(80)));
    const histRows: string[][] = [
      ["solver id", "count", "min", "p50", "p95", "p99", "max", "mean"],
    ];
    for (const [solverId, stats] of result.gasHistogram) {
      histRows.push([
        color(ANSI.dim, solverId),
        String(stats.count),
        formatGas(stats.min.toString()),
        formatGas(stats.p50.toString()),
        formatGas(stats.p95.toString()),
        formatGas(stats.p99.toString()),
        formatGas(stats.max.toString()),
        formatGas(stats.mean.toString()),
      ]);
    }
    const histWidths = histRows[0]!.map((_, c) =>
      Math.max(...histRows.map((row) => visibleLength(row[c]!))),
    );
    const renderHistRow = (row: string[]) =>
      "  " +
      row.map((cell, i) => padRight(cell, histWidths[i]!)).join("  │  ");
    lines.push(renderHistRow(histRows[0]!));
    lines.push(
      "  " +
        color(
          ANSI.dim,
          histWidths.map((w) => "─".repeat(w)).join("──┼──"),
        ),
    );
    for (const row of histRows.slice(1)) lines.push(renderHistRow(row));
    lines.push("");
    lines.push(
      color(
        ANSI.dim,
        "  histogram: nearest-rank percentiles, exact over the rolling window.",
      ),
    );
    lines.push(
      color(
        ANSI.dim,
        "  feed your audit stream's Fill events into SolverGasHistogram.record() in production.",
      ),
    );
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

/**
 * Extract gas telemetry from a SolverTrioIntentResult's fill
 * metadata. Returns a uniform { gasUsed, gasCostWei } shape across
 * all three solver kinds:
 *
 *   - transfer: single tx, fields lifted directly
 *   - swap:     sum across approve + swap + ... (already totaled by solver)
 *   - payment:  x402 facilitator pays gas — not attributable to the
 *               agent. Returns { gasUsed: null, gasCostWei: null }.
 *
 * Null values render as "— (facilitator)" in the CLI so operators
 * understand the x402 case isn't missing data — it's a different cost
 * model.
 */
function extractGas(r: {
  readonly kind: "transfer" | "swap" | "payment";
  readonly fill?: { readonly metadata?: Readonly<Record<string, unknown>> };
}): {
  readonly gasUsed: string | null;
  readonly gasCostWei: string | null;
  readonly perTxGasUsed?: ReadonlyArray<string | null>;
} {
  if (r.kind === "payment") {
    return { gasUsed: null, gasCostWei: null };
  }
  const meta = r.fill?.metadata;
  if (!meta) return { gasUsed: null, gasCostWei: null };
  const gasUsed =
    typeof meta.gasUsed === "bigint" ? meta.gasUsed.toString() : null;
  const gasCostWei =
    typeof meta.gasCostWei === "bigint" ? meta.gasCostWei.toString() : null;
  const perTxGasUsed = Array.isArray(meta.perTxGasUsed)
    ? (meta.perTxGasUsed as ReadonlyArray<bigint | null>).map((g) =>
        typeof g === "bigint" ? g.toString() : null,
      )
    : undefined;
  return { gasUsed, gasCostWei, perTxGasUsed };
}

/** Render the gas column cell — total gas used or facilitator label. */
function renderGasCell(r: {
  readonly kind: "transfer" | "swap" | "payment";
  readonly fill?: { readonly metadata?: Readonly<Record<string, unknown>> };
}): string {
  if (r.kind === "payment") {
    return color(ANSI.dim, "— (facilitator pays)");
  }
  const gas = extractGas(r);
  if (!gas.gasUsed) return color(ANSI.gray, "—");
  return color(ANSI.cyan, formatGas(gas.gasUsed));
}

/** Short gas label: "60k" for 60000, "180k" for 180000, etc. */
function formatGas(s: string): string {
  try {
    const n = BigInt(s);
    if (n >= 1_000_000n) return `${Number(n / 1_000n) / 1000}M`;
    if (n >= 1_000n) return `${n / 1_000n}k`;
    return s;
  } catch {
    return s;
  }
}

/** Parse a positive integer flag value, returning null on bad input. */
function parsePositiveInt(s: string): number | null {
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** Parse the `--venue` flag value. Returns null on unrecognised input. */
function parseVenue(s: string): "stub" | "uniswap-v3" | null {
  if (s === "stub" || s === "uniswap-v3") return s;
  return null;
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
