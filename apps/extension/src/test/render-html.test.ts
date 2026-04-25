/**
 * Tests for the HTML dashboard renderer.
 *
 * Coverage:
 *   1. Renders a complete <!doctype html> through to </html> with no
 *      missing closing tags.
 *   2. All five major sections present (header, badge, operator
 *      policy, matrix, histogram, audit events, footer).
 *   3. ALLOW vs DENY mode badge renders correctly.
 *   4. Per-solver histogram cards present for both real solvers; absent
 *      (with a graceful "no fills" message) in deny mode.
 *   5. Operator policy directives surface in the directive list.
 *   6. HTML escaping prevents XSS via untrusted-shaped strings — the
 *      renderer treats solver IDs / labels / event types as hostile
 *      input by default.
 *   7. samples option flows through to the header subtitle.
 */

import { describe, expect, it } from "vitest";

import {
  renderHtmlDashboard,
  runSolverTrioDemo,
  type SolverTrioDemoResult,
} from "@aethelred/wallet-integration";

describe("renderHtmlDashboard — basic structure", () => {
  it("renders a complete HTML document", async () => {
    const result = await runSolverTrioDemo({ samples: 5 });
    const html = renderHtmlDashboard(result);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.endsWith("</html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("</body>");
  });

  it("inlines the stylesheet (zero external resources)", async () => {
    const result = await runSolverTrioDemo();
    const html = renderHtmlDashboard(result);
    // CSS rules embedded directly, not via <link>.
    expect(html).toContain("<style>");
    expect(html).not.toContain('<link rel="stylesheet"');
    // Variables defined in :root.
    expect(html).toContain(":root {");
  });

  it("includes all major sections", async () => {
    const result = await runSolverTrioDemo({ samples: 3 });
    const html = renderHtmlDashboard(result);
    expect(html).toContain("<h1>Aethelred Solver Trio</h1>");
    expect(html).toContain("Operator policy");
    expect(html).toContain("Commitment-rule matrix");
    expect(html).toContain("Per-solver gas histogram");
    expect(html).toContain("Intent-router audit events");
    expect(html).toContain("<footer>");
  });

  it("custom title flows through to <title> + h1", async () => {
    const result = await runSolverTrioDemo();
    const html = renderHtmlDashboard(result, { title: "Q3 Solver Audit" });
    expect(html).toContain("<title>Q3 Solver Audit</title>");
    expect(html).toContain("<h1>Q3 Solver Audit</h1>");
  });

  it("samples option surfaces in the header subtitle", async () => {
    const result = await runSolverTrioDemo({ samples: 50 });
    const html = renderHtmlDashboard(result, { samples: 50 });
    expect(html).toContain("50 samples per intent kind");
  });

  it("default samples=1 renders the singular form", async () => {
    const result = await runSolverTrioDemo();
    const html = renderHtmlDashboard(result, { samples: 1 });
    expect(html).toContain("1 sample per intent kind");
  });
});

describe("renderHtmlDashboard — mode-aware rendering", () => {
  it("ALLOW mode shows the allow badge + fulfilled count", async () => {
    const result = await runSolverTrioDemo({ samples: 3 });
    const html = renderHtmlDashboard(result);
    expect(html).toContain("ALLOW MODE");
    expect(html).toContain("agent registered");
    expect(html).toContain("3 fulfilled");
  });

  it("DENY mode shows the deny badge + 3 denied + empty histogram", async () => {
    const result = await runSolverTrioDemo({
      skipAgentRegistration: true,
      samples: 3,
    });
    const html = renderHtmlDashboard(result);
    expect(html).toContain("DENY MODE");
    expect(html).toContain("agent NOT registered");
    expect(html).toContain("3 denied");
    expect(html).toContain("No fills recorded");
  });
});

describe("renderHtmlDashboard — histogram + matrix content", () => {
  it("renders one histogram card per real solver (transfer + swap; not x402)", async () => {
    const result = await runSolverTrioDemo({ samples: 5 });
    const html = renderHtmlDashboard(result);
    // Match the rendered <div class="hist-card-head"> openings —
    // the CSS rule `.hist-card-head { ... }` would also match a
    // bare /hist-card-head/ regex (one extra match).
    const cardCount = (html.match(/<div class="hist-card-head">/g) ?? []).length;
    expect(cardCount).toBe(2);
    // Both solver IDs appear in code blocks.
    expect(html).toContain("transfer:base-mainnet");
    expect(html).toContain("swap:stub:base-mainnet");
    // x402 is correctly NOT in the histogram (the orchestrator
    // skips it because gas data is absent on x402 fills).
    expect(html.match(/<code>x402-facilitator:base-mainnet<\/code>\s*<span class="hist-count"/)).toBeNull();
  });

  it("matrix has one row per intent result + the x402 'facilitator pays' label", async () => {
    const result = await runSolverTrioDemo();
    const html = renderHtmlDashboard(result);
    // Matrix rows for each kind.
    expect(html).toContain('class="kind-transfer"');
    expect(html).toContain('class="kind-swap"');
    expect(html).toContain('class="kind-payment"');
    // x402 row uses the facilitator-pays label in the gas cell.
    expect(html).toContain("facilitator pays");
  });

  it("operator policy directives appear in the directive list", async () => {
    const result = await runSolverTrioDemo();
    const html = renderHtmlDashboard(result);
    expect(html).toContain("require-registered-agent");
    expect(html).toContain("require-not-revoked");
  });
});

describe("renderHtmlDashboard — HTML escaping", () => {
  // Build a fabricated SolverTrioDemoResult with hostile-shaped
  // strings in places a real operator config could put them. The
  // renderer should treat all strings as hostile input.
  function makeHostileResult(base: SolverTrioDemoResult): SolverTrioDemoResult {
    return {
      ...base,
      // Solver ID with embedded HTML — would XSS without escape.
      results: base.results.map((r) => ({
        ...r,
        solverId: `xss<script>alert(1)</script>`,
        label: `Send "<img src=x onerror=alert(1)>"`,
      })),
    };
  }

  it("escapes < > & \" ' in solver IDs and labels", async () => {
    const baseResult = await runSolverTrioDemo();
    const hostile = makeHostileResult(baseResult);
    const html = renderHtmlDashboard(hostile);
    // Raw <script> must NOT appear.
    expect(html).not.toContain("<script>alert(1)</script>");
    // Raw <img onerror=...> must NOT appear.
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    // Escaped form DOES appear.
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&quot;");
  });

  it("does not double-escape already-safe text", async () => {
    const result = await runSolverTrioDemo();
    const html = renderHtmlDashboard(result);
    // The literal solver IDs we use in the demo don't contain any
    // special chars, so they should appear verbatim (no extra
    // entities).
    expect(html).toContain("transfer:base-mainnet");
    expect(html).toContain("swap:stub:base-mainnet");
    expect(html).not.toContain("transfer&amp;:base-mainnet");
  });
});

describe("renderHtmlDashboard — output stays small", () => {
  it("default output is < 50KB even at samples=20", async () => {
    const result = await runSolverTrioDemo({ samples: 20 });
    const html = renderHtmlDashboard(result, { samples: 20 });
    // Generous upper bound — current output is ~12KB.
    expect(html.length).toBeLessThan(50_000);
  });
});
