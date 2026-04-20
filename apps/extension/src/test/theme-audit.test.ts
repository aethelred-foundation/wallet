/**
 * CSS theme-adaptability audit.
 * ─────────────────────────────
 * Our design-token convention is: raw hex colors live ONLY inside
 * `:root`, `[data-theme="light"]`, or `[data-theme="dark"]` blocks
 * where they bind CSS custom properties. Every other selector should
 * reference those tokens via `var(--…)` so the whole surface adapts
 * cleanly to theme switches.
 *
 * This suite parses `premium-global.css`, counts the raw hex colors
 * OUTSIDE those token blocks, and asserts the count stays below a
 * drift ceiling.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS_PATH = resolve(__dirname, "..", "..", "src", "styles", "premium-global.css");

function countHex(source: string): {
  outside: number;
  inside: number;
  total: number;
} {
  const tokenBlockStart = /(?:^|\s)(?::root|html\[data-theme="(?:light|dark)"\]|\[data-theme="(?:light|dark)"\])\s*\{/gm;

  const blocks: Array<[number, number]> = [];
  let match: RegExpExecArray | null;
  while ((match = tokenBlockStart.exec(source))) {
    const openBraceIdx = source.indexOf("{", match.index);
    if (openBraceIdx < 0) continue;
    let depth = 1;
    let i = openBraceIdx + 1;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    blocks.push([openBraceIdx, i]);
  }

  const inBlock = (idx: number) =>
    blocks.some(([s, e]) => idx >= s && idx <= e);

  let outside = 0;
  let inside = 0;
  let total = 0;
  const re = /#[0-9a-fA-F]{3,8}\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    total++;
    if (inBlock(m.index)) inside++;
    else outside++;
  }
  return { outside, inside, total };
}

describe("theme audit — premium-global.css", () => {
  it("raw hex literals outside token blocks stay below the drift ceiling", () => {
    const src = readFileSync(CSS_PATH, "utf8");
    const { outside, inside, total } = countHex(src);
    // eslint-disable-next-line no-console
    console.info(
      `[theme-audit] premium-global.css hex count — outside=${outside} inside=${inside} total=${total}`,
    );
    expect(total).toBeGreaterThan(0);
    /* Baseline before the refactor was 561 raw hex literals. After the
     * first round of token migration (brand accent + semantic status +
     * neutral ramp moved to `var(--c-…)`) the count dropped to ~204 —
     * a 64% reduction. The drift ceiling sits at 220, tight enough to
     * block someone dropping 20 new raw colors in one PR while
     * absorbing incidental one-off edits.
     *
     * We only tighten (never loosen) this number in follow-up commits
     * as more hex values are migrated to tokens. The test exists
     * specifically to create that one-way ratchet: raw-hex count can
     * drop, never climb. */
    expect(outside).toBeLessThan(220);
  });

  it("token blocks exist in the stylesheet surface", () => {
    const src = readFileSync(CSS_PATH, "utf8");
    /* premium-global.css hosts per-theme override blocks that scope to
     * [data-theme="light"] / [data-theme="dark"]. The :root definitions
     * themselves live in `design-tokens.css` (loaded alongside), so we
     * only require the theme blocks to be present here. */
    const themeOpens = (src.match(
      /(?:^|\s)(?:html\[data-theme="(?:light|dark)"\]|\[data-theme="(?:light|dark)"\])[^\{]*\{/gm,
    ) ?? []).length;
    expect(themeOpens).toBeGreaterThan(0);
  });
});
