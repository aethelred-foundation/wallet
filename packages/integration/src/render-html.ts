/**
 * `renderHtmlDashboard` — turn a `SolverTrioDemoResult` into a
 * self-contained HTML page for executive-shareable observability.
 *
 * Where the CLI tells the implementation story (rich ANSI colors,
 * machine-grep-able tables) and `--prom` tells the SRE story (scrape
 * format), this artifact tells the EXEC story: a single drag-and-drop
 * file showing per-solver percentiles + commitment-rule verification +
 * gate enforcement, no install required.
 *
 * Zero-dep design:
 *   - No Chart.js / D3 / external CDNs.
 *   - All charts hand-written as inline SVG.
 *   - Total HTML output ~12-25KB, opens offline.
 *
 * Safety: every interpolated string is HTML-escaped via `esc()`. The
 * demo data is internally controlled today, but production deployments
 * pull solver IDs / audit-event types from operator config — treating
 * this renderer as a hostile-data renderer means safe defaults.
 *
 * Usage:
 *
 * ```ts
 * const result = await runSolverTrioDemo({ samples: 100 });
 * const html = renderHtmlDashboard(result);
 * // serve, write to file, email, etc.
 * ```
 */

import type { SolverTrioDemoResult, SolverTrioIntentResult } from "./solver-trio-demo";

export interface RenderHtmlDashboardOptions {
  /**
   * Optional title shown in the `<title>` tag and the page header.
   * Default: "Aethelred Solver Trio".
   */
  readonly title?: string;
  /**
   * ISO timestamp (or any string) shown in the page header subtitle.
   * Default: `new Date().toISOString()` at render time.
   */
  readonly generatedAt?: string;
  /**
   * Number of samples per intent kind run by the orchestrator.
   * Surfaced in the header subtitle so a reader knows what the
   * percentiles are computed over. Default 1.
   */
  readonly samples?: number;
}

const DEFAULT_TITLE = "Aethelred Solver Trio";

export function renderHtmlDashboard(
  result: SolverTrioDemoResult,
  opts: RenderHtmlDashboardOptions = {},
): string {
  const title = opts.title ?? DEFAULT_TITLE;
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const samples = opts.samples ?? 1;

  return [
    "<!doctype html>",
    `<html lang="en">`,
    "<head>",
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${esc(title)}</title>`,
    `<style>${STYLES}</style>`,
    "</head>",
    "<body>",
    renderHeader(title, generatedAt, samples, result),
    renderModeBadge(result),
    renderOperatorPolicy(result),
    renderMatrix(result),
    renderHistogram(result),
    renderAuditEvents(result),
    renderFooter(),
    "</body>",
    "</html>",
  ].join("\n");
}

// ─── Sections ─────────────────────────────────────────────

function renderHeader(
  title: string,
  generatedAt: string,
  samples: number,
  result: SolverTrioDemoResult,
): string {
  const fulfilled = result.results.filter(
    (r) => r.executionResult.outcome.kind === "fulfilled",
  ).length;
  const denied = result.results.filter(
    (r) => r.executionResult.outcome.kind === "payment-gated",
  ).length;
  return `
<header>
  <h1>${esc(title)}</h1>
  <p class="subtitle">
    Generated <time datetime="${esc(generatedAt)}">${esc(generatedAt)}</time>
    · agent <code>${esc(result.agentAddress)}</code>
    · chain ${esc(String(result.chainId))}
    · ${esc(String(samples))} sample${samples === 1 ? "" : "s"} per intent kind
    · <span class="metric-good">${fulfilled} fulfilled</span>
    · <span class="metric-bad">${denied} denied</span>
  </p>
</header>`;
}

function renderModeBadge(result: SolverTrioDemoResult): string {
  if (!result.denyModeExpected) {
    return `<div class="badge badge-allow">ALLOW MODE — agent registered, gates expected to pass</div>`;
  }
  return `<div class="badge badge-deny">DENY MODE — agent NOT registered, gates expected to reject</div>`;
}

function renderOperatorPolicy(result: SolverTrioDemoResult): string {
  const directives = result.operatorPolicy.directives
    .map((d) => `<li><code>${esc(directiveLabel(d))}</code></li>`)
    .join("");
  return `
<section>
  <h2>Operator policy</h2>
  <p class="muted">Applied to all three reputation gates via <code>composeGatesByIntentKind</code>.</p>
  <p>Combinator: <strong>${esc(result.operatorPolicy.combinator ?? "all")}</strong></p>
  <ul class="directive-list">${directives}</ul>
</section>`;
}

function renderMatrix(result: SolverTrioDemoResult): string {
  const rows = result.results
    .map((r) => {
      const heldBadge = r.fill
        ? r.commitmentRuleHeld
          ? `<span class="check pass">✓</span>`
          : `<span class="check fail">✗</span>`
        : `<span class="check na">—</span>`;
      const gateBadge = renderGateCellHtml(r.gateResult);
      const gas = extractGasForCell(r);
      return `
    <tr class="kind-${esc(r.kind)}">
      <td><span class="kind-pill kind-pill-${esc(r.kind)}">${esc(r.kind)}</span></td>
      <td>${esc(r.label)}</td>
      <td><code>${esc(r.solverId)}</code></td>
      <td><code class="rule">${esc(r.rule)}</code></td>
      <td class="num">${esc(r.fill?.quoteCommitment ?? "—")}</td>
      <td class="num">${esc(r.fill?.actualAmount ?? "—")}</td>
      <td class="center">${heldBadge}</td>
      <td>${gateBadge}</td>
      <td class="num">${gas}</td>
    </tr>`;
    })
    .join("");
  return `
<section>
  <h2>Commitment-rule matrix</h2>
  <table class="matrix">
    <thead>
      <tr>
        <th>kind</th>
        <th>label</th>
        <th>solver id</th>
        <th>rule</th>
        <th class="num">commitment</th>
        <th class="num">actual</th>
        <th class="center">held?</th>
        <th>gate</th>
        <th class="num">gas</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function renderHistogram(result: SolverTrioDemoResult): string {
  if (result.gasHistogram.size === 0) {
    return `
<section>
  <h2>Per-solver gas histogram</h2>
  <p class="muted">No fills recorded. (Deny mode produces no on-chain settlements.)</p>
</section>`;
  }

  // Find global max for shared-axis bar widths.
  let globalMax = 0n;
  for (const stats of result.gasHistogram.values()) {
    if (stats.max > globalMax) globalMax = stats.max;
  }
  const maxNum = globalMax === 0n ? 1 : Number(globalMax);

  const cards: string[] = [];
  for (const [solverId, stats] of result.gasHistogram) {
    cards.push(renderHistogramCard(solverId, stats, maxNum));
  }

  return `
<section>
  <h2>Per-solver gas histogram</h2>
  <p class="muted">
    Nearest-rank percentiles, exact over the rolling window. Across
    ${esc(String(result.gasHistogram.size))} solver${result.gasHistogram.size === 1 ? "" : "s"}.
  </p>
  <div class="hist-grid">${cards.join("")}</div>
</section>`;
}

function renderHistogramCard(
  solverId: string,
  stats: {
    readonly count: number;
    readonly mean: bigint;
    readonly p50: bigint;
    readonly p95: bigint;
    readonly p99: bigint;
    readonly min: bigint;
    readonly max: bigint;
    readonly totalCostWei: bigint;
    readonly costSampleCount: number;
  },
  globalMaxGas: number,
): string {
  // Build a horizontal axis showing the [min, max] range with markers
  // for p50, p95, mean.
  const minN = Number(stats.min);
  const maxN = Number(stats.max);
  const meanN = Number(stats.mean);
  const p50N = Number(stats.p50);
  const p95N = Number(stats.p95);
  const pct = (v: number) => `${((v / globalMaxGas) * 100).toFixed(1)}%`;
  const widthPct = ((maxN - minN) / globalMaxGas) * 100;

  return `
  <div class="hist-card">
    <div class="hist-card-head">
      <code>${esc(solverId)}</code>
      <span class="hist-count">n = ${esc(String(stats.count))}</span>
    </div>
    <div class="hist-axis">
      <div class="hist-range" style="left:${pct(minN)};width:${widthPct.toFixed(1)}%"></div>
      <div class="hist-mark hist-mark-mean" style="left:${pct(meanN)}" title="mean ${esc(formatGas(stats.mean))}"></div>
      <div class="hist-mark hist-mark-p50" style="left:${pct(p50N)}" title="p50 ${esc(formatGas(stats.p50))}"></div>
      <div class="hist-mark hist-mark-p95" style="left:${pct(p95N)}" title="p95 ${esc(formatGas(stats.p95))}"></div>
    </div>
    <table class="hist-stats">
      <tr><th>min</th><td>${esc(formatGas(stats.min))}</td>
          <th>p50</th><td>${esc(formatGas(stats.p50))}</td></tr>
      <tr><th>p95</th><td>${esc(formatGas(stats.p95))}</td>
          <th>p99</th><td>${esc(formatGas(stats.p99))}</td></tr>
      <tr><th>max</th><td>${esc(formatGas(stats.max))}</td>
          <th>mean</th><td>${esc(formatGas(stats.mean))}</td></tr>
    </table>
    <p class="hist-cost">
      Cumulative cost: <code>${esc(stats.totalCostWei.toString())}</code> wei
      (${esc(String(stats.costSampleCount))} sampled)
    </p>
  </div>`;
}

function renderAuditEvents(result: SolverTrioDemoResult): string {
  const counts = new Map<string, number>();
  for (const e of result.auditEvents) {
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return `
<section>
  <h2>Intent-router audit events</h2>
  <p class="muted">No audit events recorded.</p>
</section>`;
  }
  const max = Math.max(...counts.values());
  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => {
      const widthPct = ((count / max) * 100).toFixed(1);
      return `
    <tr>
      <td><code>${esc(type)}</code></td>
      <td class="bar-cell">
        <div class="bar" style="width:${widthPct}%"></div>
        <span class="bar-label">${esc(String(count))}</span>
      </td>
    </tr>`;
    })
    .join("");
  return `
<section>
  <h2>Intent-router audit events</h2>
  <table class="audit-table">${rows}</table>
</section>`;
}

function renderFooter(): string {
  return `
<footer>
  <p>
    Generated by <code>@aethelred/wallet-integration</code>'s
    <code>renderHtmlDashboard</code>. Self-contained: no external
    resources, no JS execution. Open offline.
  </p>
</footer>`;
}

// ─── Helpers ──────────────────────────────────────────────

function renderGateCellHtml(
  gateResult:
    | {
        readonly allowed: boolean;
        readonly failedRuleIds?: ReadonlyArray<string>;
      }
    | undefined,
): string {
  if (!gateResult) return `<span class="muted">—</span>`;
  if (gateResult.allowed) return `<span class="check pass">✓ allowed</span>`;
  const failed = (gateResult.failedRuleIds ?? []).map((r) => esc(r)).join(", ") || "unknown";
  return `<span class="check fail">✗ denied: ${failed}</span>`;
}

function extractGasForCell(r: SolverTrioIntentResult): string {
  if (r.kind === "payment") return `<span class="muted">facilitator pays</span>`;
  const meta = r.fill?.metadata as { gasUsed?: bigint } | undefined;
  if (!meta || typeof meta.gasUsed !== "bigint") return "—";
  return esc(formatGas(meta.gasUsed));
}

function directiveLabel(d: {
  readonly type: string;
  readonly [k: string]: unknown;
}): string {
  switch (d.type) {
    case "require-registered-agent":
    case "require-not-revoked":
      return d.type;
    case "require-min-reputation":
      return `require-min-reputation:${(d as unknown as { minScore: number }).minScore}`;
    case "require-min-tier":
      return `require-min-tier:${(d as unknown as { minTier: string }).minTier}`;
    case "require-vc":
      return `require-vc:${(d as unknown as { schemaId: string }).schemaId}`;
    case "require-fresh-vc":
      return `require-fresh-vc:${(d as unknown as { schemaId: string }).schemaId}`;
    default:
      return String(d.type);
  }
}

function formatGas(n: bigint): string {
  if (n >= 1_000_000n) return `${Number(n / 1_000n) / 1000}M`;
  if (n >= 1_000n) return `${n / 1_000n}k`;
  return n.toString();
}

/**
 * HTML-escape user-data-shaped strings. Treats `&`, `<`, `>`, `"`, `'`
 * — covers attribute values, text content, and the `code` blocks the
 * dashboard uses heavily.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Stylesheet ───────────────────────────────────────────

const STYLES = `
:root {
  --fg: #1a1f2e;
  --fg-muted: #6b7280;
  --bg: #f9fafb;
  --bg-card: #fff;
  --border: #e5e7eb;
  --accent: #2563eb;
  --good: #059669;
  --bad: #dc2626;
  --warn: #d97706;
  --kind-transfer: #a855f7;
  --kind-swap: #06b6d4;
  --kind-payment: #f59e0b;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  color: var(--fg);
  background: var(--bg);
  line-height: 1.5;
  padding: 24px;
  max-width: 1100px;
  margin: 0 auto;
}
header {
  border-bottom: 1px solid var(--border);
  padding-bottom: 16px;
  margin-bottom: 24px;
}
h1 { font-size: 24px; margin: 0 0 4px 0; }
h2 { font-size: 16px; margin: 0 0 12px 0; color: var(--fg); }
.subtitle { margin: 0; color: var(--fg-muted); font-size: 13px; }
.muted { color: var(--fg-muted); }
section {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 16px;
}
code {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 12px;
  background: rgba(0,0,0,0.04);
  padding: 1px 4px;
  border-radius: 3px;
}
.badge {
  display: inline-block;
  padding: 6px 12px;
  border-radius: 4px;
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 16px;
  letter-spacing: 0.5px;
}
.badge-allow { background: #d1fae5; color: var(--good); }
.badge-deny { background: #fee2e2; color: var(--bad); }
.metric-good { color: var(--good); font-weight: 600; }
.metric-bad { color: var(--bad); font-weight: 600; }
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.matrix th, .matrix td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.matrix th { background: var(--bg); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--fg-muted); }
.matrix tr:last-child td { border-bottom: none; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.center { text-align: center; }
.rule { font-weight: 600; color: var(--accent); }
.kind-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #fff;
}
.kind-pill-transfer { background: var(--kind-transfer); }
.kind-pill-swap { background: var(--kind-swap); }
.kind-pill-payment { background: var(--kind-payment); }
.check { font-weight: 700; }
.check.pass { color: var(--good); }
.check.fail { color: var(--bad); }
.check.na { color: var(--fg-muted); }
.directive-list { padding-left: 20px; margin: 8px 0; }
.directive-list li { font-size: 13px; }
.hist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
}
.hist-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 14px;
  background: var(--bg);
}
.hist-card-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 10px;
}
.hist-count { font-size: 12px; color: var(--fg-muted); }
.hist-axis {
  position: relative;
  height: 24px;
  background: rgba(0,0,0,0.04);
  border-radius: 3px;
  margin-bottom: 10px;
}
.hist-range {
  position: absolute;
  top: 9px;
  height: 6px;
  background: var(--accent);
  opacity: 0.4;
  border-radius: 3px;
}
.hist-mark {
  position: absolute;
  top: 4px;
  width: 2px;
  height: 16px;
  border-radius: 1px;
}
.hist-mark-mean { background: var(--accent); }
.hist-mark-p50 { background: var(--good); }
.hist-mark-p95 { background: var(--warn); }
.hist-stats {
  width: 100%;
  font-size: 12px;
}
.hist-stats th, .hist-stats td {
  padding: 2px 4px;
}
.hist-stats th {
  text-align: right;
  color: var(--fg-muted);
  font-weight: 500;
  width: 30px;
}
.hist-stats td { font-variant-numeric: tabular-nums; }
.hist-cost {
  margin: 8px 0 0 0;
  font-size: 11px;
  color: var(--fg-muted);
}
.audit-table { width: 100%; }
.audit-table td {
  padding: 4px 8px;
  vertical-align: middle;
}
.audit-table td:first-child { width: 240px; }
.bar-cell { position: relative; }
.bar {
  background: var(--accent);
  opacity: 0.25;
  height: 16px;
  border-radius: 3px;
}
.bar-label {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  left: 8px;
  font-size: 12px;
  font-weight: 600;
}
footer {
  margin-top: 32px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--fg-muted);
  text-align: center;
}
`;
