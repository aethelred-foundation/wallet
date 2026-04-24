#!/usr/bin/env node
/**
 * `aethelred-moat-demo` — runnable proof-of-moat CLI.
 *
 * Executes `runEndToEndDemo()` and renders the result as a coloured
 * ASCII timeline + a structured summary. This is the artifact that
 * goes on the pitch deck: "here's the full moat running in under
 * one second, live in your terminal."
 *
 * Output tiers:
 *
 *   - Default — ASCII timeline + key metrics.
 *   - `--json` — pure JSON (pipe into `jq` or a deck generator).
 *   - `--quiet` — exit-code-only (0 on success). CI-friendly.
 *
 * No runtime deps beyond the integration package itself — renders
 * with ANSI escape codes directly. Copy-pastes onto any laptop
 * with Node 18+.
 */

import { runEndToEndDemo } from "../src/end-to-end-demo";

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

const STAGE_COLOR: Record<string, string> = {
  merchant: ANSI.magenta,
  payer: ANSI.cyan,
  agent: ANSI.cyan,
  router: ANSI.yellow,
  sponsor: ANSI.green,
  audit: ANSI.gray,
  notarization: ANSI.bold + ANSI.green,
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

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const jsonMode = args.has("--json");
  const quietMode = args.has("--quiet");
  const helpMode = args.has("--help") || args.has("-h");

  if (helpMode) {
    process.stdout.write(
      [
        "aethelred-moat-demo — runs the end-to-end moat flow",
        "",
        "Usage:",
        "  aethelred-moat-demo [--json|--quiet]",
        "",
        "Flags:",
        "  --json     Emit structured JSON result to stdout",
        "  --quiet    Exit-code-only; no output on success",
        "  --help, -h Show this help",
        "",
        "The flow exercised:",
        "  1. Merchant signs EIP-712 profile + invoice (Nitro custody)",
        "  2. Agent resolves /pay/:slug → PaymentRequirement",
        "  3. Agent signs a payment intent (Nitro session key)",
        "  4. Intent router runs VC gate + AgentBudget.canSpend",
        "  5. Solver quotes, settles via x402",
        "  6. Paymaster-sponsor prices gas, evaluates composed policy, signs",
        "  7. Audit captures every stage, notarization anchors Merkle root",
        "",
      ].join("\n"),
    );
    return;
  }

  const started = Date.now();
  let result;
  try {
    result = await runEndToEndDemo();
  } catch (err) {
    if (!quietMode) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${color(ANSI.red + ANSI.bold, "DEMO FAILED:")} ${msg}\n`);
    }
    process.exit(1);
  }
  const elapsedMs = Date.now() - started;

  if (quietMode) {
    // exit 0 on success — nothing to the stream
    return;
  }

  if (jsonMode) {
    process.stdout.write(
      JSON.stringify(
        {
          elapsedMs,
          merchant: {
            id: result.merchant.id,
            displayName: result.merchant.displayName,
            address: result.merchant.address,
          },
          invoice: {
            id: result.invoice.id,
            slug: result.invoice.slug,
            amount: result.invoice.amount,
          },
          agent: {
            agentId: result.agent.agentId,
            controlAddress: result.agent.controlAddress,
          },
          intent: {
            id: result.intent.envelope.id,
            kind: result.intent.body.kind,
            outcome: result.intentExecution.outcome.kind,
          },
          sponsorship: {
            requestId: result.sponsorshipApproval.requestId,
            usdcCost: result.sponsorshipApproval.usdcCost.toString(),
            paymaster: result.sponsorshipApproval.paymaster,
          },
          anchor: {
            batchId: result.anchoredReceipt.record.batchId.toString(),
            merkleRoot: result.anchoredReceipt.record.merkleRoot,
            blockNumber: result.anchoredReceipt.record.blockNumber.toString(),
            txHash: result.anchoredReceipt.externalId,
          },
          auditStages: result.auditTrail.map((e) => ({
            stage: e.stage,
            message: e.message,
            at: e.at,
          })),
          intentAuditEvents: result.intentAuditEvents.map((e) => e.type),
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  // Default: coloured ASCII timeline.
  const lines: string[] = [];
  lines.push("");
  lines.push(banner("Aethelred agent-native moat — end-to-end demo"));
  lines.push("");
  lines.push(
    `${ANSI.dim}Completed in${ANSI.reset} ${color(ANSI.bold + ANSI.green, `${elapsedMs}ms`)}  ·  11 packages exercised  ·  ${result.auditTrail.length} audit stages`,
  );
  lines.push("");
  lines.push(color(ANSI.bold, "Timeline"));
  lines.push(color(ANSI.dim, "─".repeat(80)));

  for (const event of result.auditTrail) {
    const stageColor = STAGE_COLOR[event.stage] ?? ANSI.gray;
    const stage = color(stageColor, pad(event.stage, 14));
    const detail = event.detail
      ? color(
          ANSI.gray,
          "  " +
            Object.entries(event.detail)
              .map(([k, v]) => `${k}=${truncate(String(v), 40)}`)
              .join("  "),
        )
      : "";
    lines.push(`  ${stage} ${event.message}${detail}`);
  }
  lines.push("");
  lines.push(color(ANSI.bold, "Key outputs"));
  lines.push(color(ANSI.dim, "─".repeat(80)));
  lines.push(
    `  ${color(ANSI.cyan, "Invoice")}              ${result.invoice.slug}  (${result.invoice.amount} units of ${shortAddr(result.invoice.asset)})`,
  );
  lines.push(
    `  ${color(ANSI.cyan, "Agent")}                ${shortAddr(result.agent.controlAddress)}  (Nitro-attested)`,
  );
  lines.push(
    `  ${color(ANSI.cyan, "Intent")}               ${shortHex(result.intent.envelope.id, 18)}  outcome=${color(ANSI.green, result.intentExecution.outcome.kind)}`,
  );
  lines.push(
    `  ${color(ANSI.cyan, "Sponsored USDC")}       ${result.sponsorshipApproval.usdcCost.toString()}  (paymaster ${shortAddr(result.sponsorshipApproval.paymaster)})`,
  );
  lines.push(
    `  ${color(ANSI.cyan, "Merkle root")}          ${shortHex(result.anchoredReceipt.record.merkleRoot, 18)}  ${color(ANSI.dim, "anchored in block " + result.anchoredReceipt.record.blockNumber.toString())}`,
  );
  lines.push(
    `  ${color(ANSI.cyan, "Anchor tx")}            ${shortHex(result.anchoredReceipt.externalId, 18)}`,
  );
  lines.push("");
  lines.push(color(ANSI.bold, "Intent-router audit events"));
  lines.push(color(ANSI.dim, "─".repeat(80)));
  const eventCounts: Record<string, number> = {};
  for (const e of result.intentAuditEvents) {
    eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1;
  }
  for (const [type, count] of Object.entries(eventCounts)) {
    lines.push(`  ${color(ANSI.yellow, pad(type, 28))} × ${count}`);
  }
  lines.push("");
  lines.push(
    color(ANSI.bold + ANSI.green, "✓ moat stack verified end-to-end"),
  );
  lines.push("");

  process.stdout.write(lines.join("\n"));
}

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function shortHex(hex: string, len: number): string {
  if (hex.length <= len) return hex;
  const half = Math.floor((len - 1) / 2);
  return `${hex.slice(0, half + 1)}…${hex.slice(-half)}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

main().catch((err) => {
  process.stderr.write(`unhandled error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
