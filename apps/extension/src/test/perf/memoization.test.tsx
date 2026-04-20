/**
 * ═══════════════════════════════════════════════════════════════════════
 * React.memo regression suite
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Guards the invariant: presentational components that were memoized in
 * the April 2026 perf sweep STAY memoized. It's easy to accidentally
 * unwrap `React.memo()` during a refactor (someone changes the export
 * from the memoized constant back to the raw function and all tests
 * still pass). This file makes that regression caught-by-a-test.
 *
 * Strategy:
 *   We render each memoized component multiple times with the SAME
 *   props, then assert the component's inner render body fired at most
 *   once (or twice in strict mode — which isn't on for these tests,
 *   but we keep the assertion loose-bounded for safety).
 *
 *   We can't spy on a function body that's closed over by React — so
 *   instead we detect the wrapper pattern at the module level. A
 *   `React.memo()`-wrapped component exposes `$$typeof ===
 *   Symbol.for("react.memo")`, which is stable across React 18+. If a
 *   future refactor unwraps the memo, that symbol disappears and the
 *   test fails deterministically.
 *
 * This is the cheapest way to catch the regression without relying on
 * profiler hooks (which have strict-mode double-invocation concerns) or
 * test-only counter props (which pollute the component API).
 *
 * Owner: wallet-extension team.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from "vitest";
import type { ComponentType, MemoExoticComponent } from "react";

/* Lazy module imports so tests stay isolated from each other and from
 * any accidental cross-module coupling. Each import pulls the named
 * export we expect to be wrapped in React.memo(). */
import { TokenLogo } from "../../popup/components/token-logo";
import { DappLogo } from "../../popup/components/dapp-logo";
import { CurrencyText } from "../../popup/components/currency-text";
import { AnimatedNumber } from "../../popup/components/animated-number";
import { Sparkline } from "../../popup/components/sparkline";
import { LiveSparkline } from "../../popup/components/live-sparkline";
import { Skeleton, SkeletonText, SkeletonTokenRow, SkeletonCard } from "../../popup/components/skeleton";
import {
  TokenRowSkeleton,
  BalanceHeroSkeleton,
  AccountCardSkeleton,
  ApprovalRowSkeleton,
  ActivityRowSkeleton,
  TreasuryRowSkeleton,
  SettingsRowSkeleton,
  ChartSkeleton,
} from "../../popup/components/skeleton-shapes";
import { EmptyState } from "../../popup/components/empty-state";
import { SegmentedControl } from "../../popup/components/segmented-control";
import { Tooltip } from "../../popup/components/tooltip";
import { Card, CardHeader, CardDivider } from "../../popup/components/card";
import { AnimatedIcon } from "../../popup/components/animated-icon";
import { QRCode } from "../../popup/components/qr-code";
import { GradientMeshBg } from "../../popup/components/gradient-mesh-bg";
import { SuccessMorph } from "../../popup/components/micro/SuccessMorph";
import { ErrorShake } from "../../popup/components/micro/ErrorShake";
import { CopyToClipboard } from "../../popup/components/micro/CopyToClipboard";
import { DappImage } from "../../popup/components/dapp-image";

/* React 18+ surfaces memoized components via a shared symbol. We check
 * this at the module level rather than via render behaviour because:
 *   1. it's deterministic (no race with strict mode's double-render)
 *   2. it catches accidental unwrap on import (the most common regression)
 *   3. it doesn't require a DOM render cycle per component */
const REACT_MEMO_SYMBOL = Symbol.for("react.memo");

function isMemoized(
  Component: unknown,
): Component is MemoExoticComponent<ComponentType<unknown>> {
  return (
    typeof Component === "object" &&
    Component !== null &&
    "$$typeof" in Component &&
    (Component as { $$typeof: symbol }).$$typeof === REACT_MEMO_SYMBOL
  );
}

/* ─── Test cases ─────────────────────────────────────────────────── */

const MEMOIZED_COMPONENTS: Array<{ name: string; C: unknown }> = [
  { name: "TokenLogo", C: TokenLogo },
  { name: "DappLogo", C: DappLogo },
  { name: "CurrencyText", C: CurrencyText },
  { name: "AnimatedNumber", C: AnimatedNumber },
  { name: "Sparkline", C: Sparkline },
  { name: "LiveSparkline", C: LiveSparkline },
  { name: "Skeleton", C: Skeleton },
  { name: "SkeletonText", C: SkeletonText },
  { name: "SkeletonTokenRow", C: SkeletonTokenRow },
  { name: "SkeletonCard", C: SkeletonCard },
  { name: "TokenRowSkeleton", C: TokenRowSkeleton },
  { name: "BalanceHeroSkeleton", C: BalanceHeroSkeleton },
  { name: "AccountCardSkeleton", C: AccountCardSkeleton },
  { name: "ApprovalRowSkeleton", C: ApprovalRowSkeleton },
  { name: "ActivityRowSkeleton", C: ActivityRowSkeleton },
  { name: "TreasuryRowSkeleton", C: TreasuryRowSkeleton },
  { name: "SettingsRowSkeleton", C: SettingsRowSkeleton },
  { name: "ChartSkeleton", C: ChartSkeleton },
  { name: "EmptyState", C: EmptyState },
  { name: "SegmentedControl", C: SegmentedControl },
  { name: "Tooltip", C: Tooltip },
  { name: "Card", C: Card },
  { name: "CardHeader", C: CardHeader },
  { name: "CardDivider", C: CardDivider },
  { name: "AnimatedIcon", C: AnimatedIcon },
  { name: "QRCode", C: QRCode },
  { name: "GradientMeshBg", C: GradientMeshBg },
  { name: "SuccessMorph", C: SuccessMorph },
  { name: "ErrorShake", C: ErrorShake },
  { name: "CopyToClipboard", C: CopyToClipboard },
  { name: "DappImage", C: DappImage },
];

describe("React.memo regression suite", () => {
  it("at least 25 components are wrapped in React.memo", () => {
    const memoized = MEMOIZED_COMPONENTS.filter(({ C }) => isMemoized(C));
    expect(
      memoized.length,
      `only ${memoized.length} of ${MEMOIZED_COMPONENTS.length} expected components are memoized — a perf regression.`,
    ).toBeGreaterThanOrEqual(25);
  });

  // Individually check each so a regression names the exact file.
  for (const { name, C } of MEMOIZED_COMPONENTS) {
    it(`${name} is wrapped in React.memo`, () => {
      expect(
        isMemoized(C),
        `${name} lost its React.memo wrapper. Wrap its named export with memo() so renders only fire on prop changes.`,
      ).toBe(true);
    });
  }
});
