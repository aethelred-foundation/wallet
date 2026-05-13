#!/usr/bin/env node
/**
 * `aethelred-institutional-compliance-demo` — runnable proof-of-
 * compliance-depth CLI.
 *
 * Sibling to `aethelred-solver-trio-demo`. Where the trio demo
 * exercises composition breadth across three intent kinds, this one
 * exercises compliance depth across a single transaction class —
 * institutional cross-jurisdictional transfers routed through a
 * tier-1 custodian.
 *
 * Output tiers:
 *   - Default — ASCII table with per-transaction matrix + liability
 *     and the SLI summary
 *   - `--json` — pure JSON (pipe into `jq` or a deck generator)
 *   - `--prom` — Prometheus text (snapshot of the meter at the end
 *     of the run)
 *   - `--quiet` — exit-code-only (0 on success, 2 if the audit chain
 *     fails verifyChain — which is the regression signal)
 *
 * Zero runtime deps beyond the integration package.
 */

import { runInstitutionalComplianceDemo } from "../src/institutional-compliance-demo";
import type { InstitutionalComplianceDemoMode } from "../src/institutional-compliance-demo";

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

function parsePositiveInt(s: string): number | null {
  const n = Number.parseInt(s, 10);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseMode(s: string): InstitutionalComplianceDemoMode | null {
  if (s === "happy" || s === "deny" || s === "mixed") return s;
  return null;
}

function modeColor(mode: InstitutionalComplianceDemoMode): string {
  switch (mode) {
    case "happy":
      return ANSI.green;
    case "deny":
      return ANSI.red;
    case "mixed":
      return ANSI.yellow;
  }
}

/**
 * Shorten a hex digest for display. Keeps the 0x prefix + first 8
 * and last 4 chars — enough to distinguish at a glance, short
 * enough to fit a table column.
 */
function truncDigest(hex: string): string {
  if (hex.length <= 16) return hex;
  return `${hex.slice(0, 10)}…${hex.slice(-4)}`;
}

/**
 * Format a USD-cents bigint as "$XXM". Used for the latestCoverage
 * line. Returns "—" when undefined (deny mode never populates it).
 */
function formatCoverageCents(value: bigint | undefined, currency: string | undefined): string {
  if (typeof value !== "bigint" || !currency) return "—";
  // Cents → millions of currency units.
  const millions = Number(value) / 100 / 1_000_000;
  if (millions >= 1) {
    return `${currency} $${millions.toFixed(0)}M`;
  }
  const thousands = Number(value) / 100 / 1_000;
  return `${currency} $${thousands.toFixed(1)}K`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const jsonMode = args.has("--json");
  const quietMode = args.has("--quiet");
  const promMode = args.has("--prom");
  const helpMode = args.has("--help") || args.has("-h");

  let samples = 5;
  let mode: InstitutionalComplianceDemoMode = "happy";
  let tenantId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--samples" && i + 1 < argv.length) {
      samples = parsePositiveInt(argv[i + 1]!) ?? 5;
      i++;
    } else if (a.startsWith("--samples=")) {
      samples = parsePositiveInt(a.slice("--samples=".length)) ?? 5;
    } else if (a === "--mode" && i + 1 < argv.length) {
      mode = parseMode(argv[i + 1]!) ?? "happy";
      i++;
    } else if (a.startsWith("--mode=")) {
      mode = parseMode(a.slice("--mode=".length)) ?? "happy";
    } else if (a === "--tenant-id" && i + 1 < argv.length) {
      tenantId = argv[i + 1]!;
      i++;
    } else if (a.startsWith("--tenant-id=")) {
      tenantId = a.slice("--tenant-id=".length);
    }
  }

  if (helpMode) {
    process.stdout.write(
      [
        "aethelred-institutional-compliance-demo — proves the institutional compliance pipeline composes end-to-end",
        "",
        "Usage:",
        "  aethelred-institutional-compliance-demo [--json|--quiet|--prom] [--mode happy|deny|mixed] [--samples N] [--tenant-id ID]",
        "",
        "Flags:",
        "  --json              Emit structured JSON result to stdout",
        "  --quiet             Exit-code-only (0 on success, 2 on audit-chain failure)",
        "  --prom              Emit Prometheus-scrape format snapshot",
        "  --mode <name>       Scenario: happy (default) | deny | mixed",
        "                        happy  — oracle healthy, every tx succeeds, unknownRate=0",
        "                        deny   — oracle unreachable, unknownRate=1, audit chain STILL valid",
        "                        mixed  — 80/20 known/unknown split, realistic SLI signal",
        "  --samples N         Number of transactions (default 5). Each emits 2 audit events.",
        "                        Higher N gives meaningful SLI percentages — use 50 for demos.",
        "  --tenant-id <id>    Override the demo tenant id (default demo-uae-tier1-bank).",
        "                        Surfaces as workspaceId on every audit event.",
        "  --help, -h          Show this help",
        "",
        "The flow exercised per transaction:",
        "  1. JurisdictionalConflictResolver detects MAS×VARA conflicts and",
        "     applies the tenant's UAE-first legal hierarchy → VARA wins",
        "     data-exposure (canonical scenario from the feedback document)",
        "  2. MatrixResolution digested via SHA-256 + recorded to AuditCapture",
        "  3. JsonFeedLiabilityAttestor fetches Komainu's signed snapshot",
        "     (or fails per mode); Secp256k1OracleSignatureVerifier verifies",
        "  4. captureLiabilitySnapshot wraps the result with a transaction-",
        "     bound digest (suppression-defense: liabilityUnknown=true events",
        "     are STILL hashed into the chain)",
        "  5. CustodianLiabilityHistogram records the sample; exportToMeter",
        "     surfaces unknown_rate / latest_coverage / attestations_total",
        "",
        "Exit codes:",
        "  0  — success (audit chain valid)",
        "  1  — runner threw",
        "  2  — audit chain verifyChain() returned false (regression signal)",
        "",
      ].join("\n"),
    );
    return;
  }

  const started = Date.now();
  let result;
  try {
    result = await runInstitutionalComplianceDemo({
      mode,
      samples,
      ...(tenantId ? { tenantId } : {}),
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

  // Audit-chain failure is the regression signal — never silent.
  if (!result.auditChainValid) {
    if (!quietMode) {
      process.stderr.write(
        `${color(ANSI.red + ANSI.bold, "REGRESSION:")} auditChainValid=false — the demo produced a chain that fails verifyChain()\n`,
      );
    }
    process.exit(2);
  }

  if (quietMode) return;

  // --prom: pre-rendered by the runner; just write it.
  if (promMode) {
    process.stdout.write(result.prometheusOutput);
    return;
  }

  if (jsonMode) {
    process.stdout.write(
      JSON.stringify(
        {
          elapsedMs,
          mode: result.mode,
          tenantId: result.tenantId,
          samples,
          auditChainValid: result.auditChainValid,
          auditEventCount: result.auditEvents.length,
          liabilityStats: {
            custodianId: result.liabilityStats.custodianId,
            total: result.liabilityStats.total,
            knownCount: result.liabilityStats.knownCount,
            unknownCount: result.liabilityStats.unknownCount,
            unknownRate: result.liabilityStats.unknownRate,
            slaStatusCounts: result.liabilityStats.slaStatusCounts,
            latestCoverage: result.liabilityStats.latestCoverage?.toString() ?? null,
            latestCoverageCurrency: result.liabilityStats.latestCoverageCurrency ?? null,
            latestSlaStatus: result.liabilityStats.latestSlaStatus ?? null,
          },
          transactions: result.transactions.map((tx) => ({
            transactionId: tx.transactionId,
            liabilityUnknown: tx.liabilityUnknown,
            conflictsFound: tx.resolution.conflictsFound.length,
            resolutionDigest: tx.resolution.digest,
            liabilityDigest: tx.liability.digest,
            slaStatus: tx.liability.attestation?.slaStatus ?? null,
            insuranceCoverage:
              tx.liability.attestation?.insuranceCoverage?.toString() ?? null,
          })),
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
  const titleSuffix =
    mode === "happy"
      ? "(HAPPY — oracle healthy)"
      : mode === "deny"
      ? "(DENY — oracle unreachable)"
      : "(MIXED — realistic SLI)";
  lines.push(
    banner(
      `Aethelred institutional compliance pipeline ${titleSuffix}`,
    ),
  );
  lines.push("");

  const elapsed = color(ANSI.bold, `${elapsedMs}ms`);
  const sampleCount = color(ANSI.bold, samples.toString());
  const modeLabel = color(modeColor(mode), mode);
  lines.push(
    `${ANSI.dim}Completed in${ANSI.reset} ${elapsed}  ` +
      `${ANSI.dim}mode${ANSI.reset} ${modeLabel}  ` +
      `${ANSI.dim}samples${ANSI.reset} ${sampleCount}  ` +
      `${ANSI.dim}tenantId${ANSI.reset} ${color(ANSI.cyan, result.tenantId)}`,
  );
  lines.push("");

  // ─── Per-transaction table ─────────────────────────────────
  lines.push(color(ANSI.bold + ANSI.cyan, "Transactions"));
  lines.push("");
  const headers = ["tx", "conflicts", "matrix digest", "liability", "coverage", "sla"];
  const colW = [22, 9, 18, 11, 14, 11];
  lines.push(
    color(
      ANSI.dim,
      headers.map((h, i) => pad(h, colW[i]!)).join("  "),
    ),
  );
  lines.push(
    color(
      ANSI.gray,
      headers.map((_, i) => "─".repeat(colW[i]!)).join("  "),
    ),
  );
  for (const tx of result.transactions) {
    const conflictsCol = tx.resolution.conflictsFound.length.toString();
    const matrixCol = truncDigest(tx.resolution.digest);
    const liabilityCol = tx.liabilityUnknown
      ? color(ANSI.red, "unknown")
      : color(ANSI.green, "known");
    const coverageCol = formatCoverageCents(
      tx.liability.attestation?.insuranceCoverage,
      tx.liability.attestation?.insuranceCurrency,
    );
    const slaCol = tx.liability.attestation?.slaStatus ?? "—";
    const slaColored =
      slaCol === "operational"
        ? color(ANSI.green, slaCol)
        : slaCol === "degraded"
        ? color(ANSI.yellow, slaCol)
        : slaCol === "unavailable"
        ? color(ANSI.red, slaCol)
        : color(ANSI.dim, slaCol);
    lines.push(
      [
        pad(tx.transactionId, colW[0]!),
        pad(conflictsCol, colW[1]!),
        pad(matrixCol, colW[2]!),
        // Pad based on visible (non-ANSI) length.
        liabilityCol + " ".repeat(Math.max(0, colW[3]! - 7)),
        pad(coverageCol, colW[4]!),
        slaColored + " ".repeat(Math.max(0, colW[5]! - slaCol.length)),
      ].join("  "),
    );
  }
  lines.push("");

  // ─── SLI summary ───────────────────────────────────────────
  lines.push(color(ANSI.bold + ANSI.cyan, "SLI snapshot (CustodianLiabilityHistogram)"));
  lines.push("");
  const stats = result.liabilityStats;
  const unknownRatePct = (stats.unknownRate * 100).toFixed(1);
  const rateColored =
    stats.unknownRate === 0
      ? color(ANSI.green, `${unknownRatePct}%`)
      : stats.unknownRate >= 0.25
      ? color(ANSI.red, `${unknownRatePct}%`)
      : stats.unknownRate >= 0.05
      ? color(ANSI.yellow, `${unknownRatePct}%`)
      : color(ANSI.dim, `${unknownRatePct}%`);
  lines.push(
    `  ${pad("custodian", 22)}${color(ANSI.cyan, stats.custodianId)}`,
  );
  lines.push(
    `  ${pad("total samples", 22)}${stats.total}`,
  );
  lines.push(
    `  ${pad("known / unknown", 22)}${color(ANSI.green, stats.knownCount.toString())} / ${color(ANSI.red, stats.unknownCount.toString())}`,
  );
  lines.push(
    `  ${pad("unknownRate (SLI)", 22)}${rateColored}`,
  );
  lines.push(
    `  ${pad("latest coverage", 22)}${formatCoverageCents(stats.latestCoverage, stats.latestCoverageCurrency)}`,
  );
  const latestSla = stats.latestSlaStatus ?? "—";
  lines.push(`  ${pad("latest SLA status", 22)}${latestSla}`);
  lines.push("");

  // ─── Audit chain ───────────────────────────────────────────
  lines.push(color(ANSI.bold + ANSI.cyan, "Audit chain"));
  lines.push("");
  lines.push(
    `  ${pad("events captured", 22)}${result.auditEvents.length}`,
  );
  lines.push(
    `  ${pad("verifyChain", 22)}${color(ANSI.green + ANSI.bold, "✓ valid")}`,
  );
  lines.push("");

  // ─── Footer pointers ───────────────────────────────────────
  lines.push(
    color(
      ANSI.dim,
      "Hint: run with --prom for the Prometheus snapshot, --json for structured output.",
    ),
  );
  lines.push("");

  process.stdout.write(lines.join("\n"));
}

main().catch((err) => {
  process.stderr.write(
    `${color(ANSI.red + ANSI.bold, "FATAL:")} ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
