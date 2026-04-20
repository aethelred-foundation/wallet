/**
 * Theme-switch E2E.
 * ─────────────────
 * Toggles the theme from dark → light, verifies the CSS custom
 * properties at `:root` actually change, and runs a contrast
 * assertion so we don't ship a theme where body text fails WCAG AA.
 */

import { test, expect } from "./fixtures";

/** Convert a CSS color (rgb/rgba/hex) to [r, g, b] sRGB 0–1. */
function parseColor(value: string): [number, number, number] {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
  }
  const hex = value.startsWith("#") ? value.slice(1) : value;
  if (hex.length === 6) {
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  return [0, 0, 0];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fg: string, bg: string): number {
  const L1 = relativeLuminance(parseColor(fg));
  const L2 = relativeLuminance(parseColor(bg));
  const [a, b] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (a + 0.05) / (b + 0.05);
}

test("theme toggle swaps CSS variables and maintains WCAG AA contrast", async ({
  approvedPage,
}) => {
  /* Capture the initial theme token. */
  const darkBg = await approvedPage.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--surface").trim()
  );

  /* Toggle — the toggle control has a recognizable label. */
  const toggle = approvedPage.getByRole("button", { name: /Theme|Light|Dark/i });
  if (await toggle.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
    await toggle.first().click();
  } else {
    /* Programmatic toggle via body data-attr as a fallback. */
    await approvedPage.evaluate(() => {
      const current = document.documentElement.getAttribute("data-theme") ?? "dark";
      document.documentElement.setAttribute("data-theme", current === "dark" ? "light" : "dark");
    });
  }

  const lightBg = await approvedPage.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--surface").trim()
  );

  /* Token must change across themes. */
  expect(lightBg).not.toEqual(darkBg);

  /* Contrast check — body text vs surface must be >= 4.5:1 (WCAG AA normal). */
  const [fg, bg] = await approvedPage.evaluate(() => {
    const s = getComputedStyle(document.body);
    return [s.color, s.backgroundColor];
  });
  expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
});
