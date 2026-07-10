/**
 * Accessibility audit E2E.
 * ────────────────────────
 * Runs axe-core against five key screens. Hard-fails on any violation
 * of `serious` or `critical` severity. `moderate` and `minor` are
 * reported but do not break the build — they'd otherwise block
 * every PR on long-standing color-contrast minutiae.
 */

import { test, expect } from "./fixtures";
import * as fs from "node:fs";
import * as path from "node:path";

/*
 * We inline axe-core from node_modules at test-time so the extension
 * page doesn't need a network fetch (CSP would block it anyway).
 */
function readAxeSource(): string {
  const candidates = [
    path.resolve(__dirname, "..", "node_modules", "axe-core", "axe.min.js"),
    path.resolve(__dirname, "..", "..", "..", "node_modules", "axe-core", "axe.min.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return fs.readFileSync(c, "utf8");
  }
  throw new Error("axe-core not found — run `npm ci` first.");
}

interface AxeResult {
  violations: Array<{
    id: string;
    impact: "minor" | "moderate" | "serious" | "critical";
    help: string;
    nodes: Array<{ target: string[] }>;
  }>;
}

async function auditRoute(
  page: import("@playwright/test").Page,
  route: string,
): Promise<AxeResult> {
  await page.evaluate(
    (r) => {
      (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.set({
        e2eRoute: r,
      });
    },
    route,
  );
  /*
   * Settle entrance animations before axe samples colours. The views fade in
   * with `v2-fade-up` (250ms, starting at opacity:0); axe running mid-fade
   * reads a partially-transparent composite (e.g. a #5f5f66 label at ~30%
   * over white ≈ #c7c7ca) and reports phantom contrast failures on text
   * whose final colour passes. Emulate reduced motion — the app honours it,
   * collapsing animation durations to ~0 — then wait past the fade so the
   * audit reflects the settled, real presentation. (A fixed wait is used
   * rather than awaiting `animation.finished`: the page also runs infinite
   * loops — pulse dot, ticker — whose promises never resolve.)
   */
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(400);
  await page.addScriptTag({ content: readAxeSource() });
  return (await page.evaluate(async () => {
    const win = window as unknown as {
      axe: { run: (ctx?: unknown, opts?: unknown) => Promise<AxeResult> };
    };
    return win.axe.run();
  })) as AxeResult;
}

const KEY_ROUTES = ["home", "portfolio", "approvals", "security", "settings"];

for (const route of KEY_ROUTES) {
  test(`axe has zero serious/critical violations on ${route}`, async ({ approvedPage }) => {
    const result = await auditRoute(approvedPage, route);
    const blocking = result.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    if (blocking.length) {
      console.error(`[a11y] serious/critical violations on ${route}:`);
      for (const v of blocking) {
        console.error(`  - ${v.id} (${v.impact}) — ${v.help}`);
        for (const node of v.nodes) {
          console.error(`    at: ${node.target.join(", ")}`);
        }
      }
    }
    expect(blocking, `serious/critical a11y violations on ${route}`).toEqual([]);
  });
}
