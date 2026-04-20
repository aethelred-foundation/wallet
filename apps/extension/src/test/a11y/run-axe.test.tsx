/**
 * Accessibility-regression suite driven by axe-core.
 * ──────────────────────────────────────────────────
 * Renders a representative set of popup components through Testing
 * Library, runs axe, and asserts that no violation with `serious` or
 * `critical` impact leaks through.
 *
 * Why components rather than whole views: views require context
 * providers (router, services, i18n) that trigger chrome.* lookups
 * and blow up under jsdom. Presentational primitives are exercised
 * in isolation here; whole-screen a11y is covered by the Playwright
 * `a11y-audit.e2e.ts` suite.
 *
 * Coverage (each rendered + audited):
 *   - CurrencyText
 *   - Skeleton, SkeletonText, SkeletonTokenRow, SkeletonCard
 *   - EmptyState (info / warning / success)
 *   - AnimatedNumber
 *   - Card
 */

import { describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import axe from "axe-core";
import React from "react";
import { FormatProvider } from "../../popup/i18n/format";
import { CurrencyText } from "../../popup/components/currency-text";
import { Skeleton, SkeletonText, SkeletonTokenRow, SkeletonCard } from "../../popup/components/skeleton";
import { EmptyState } from "../../popup/components/empty-state";
import { AnimatedNumber } from "../../popup/components/animated-number";
import { Card } from "../../popup/components/card";

async function auditNode(node: Element) {
  const result = await axe.run(node, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa"],
    },
  });
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

describe("axe a11y — popup primitives", () => {
  it("CurrencyText has no serious/critical a11y violations", async () => {
    const { container } = render(
      <FormatProvider>
        <CurrencyText value={12345.67} />
      </FormatProvider>,
    );
    const blocking = await auditNode(container);
    expect(blocking).toEqual([]);
    cleanup();
  });

  it("Skeleton family has no serious/critical a11y violations", async () => {
    const { container } = render(
      <div>
        <Skeleton width={240} height={16} />
        <SkeletonText lines={3} />
        <SkeletonTokenRow />
        <SkeletonCard />
      </div>,
    );
    const blocking = await auditNode(container);
    expect(blocking).toEqual([]);
    cleanup();
  });

  it("EmptyState variants have no serious/critical a11y violations", async () => {
    const { container } = render(
      <div>
        <EmptyState icon="ℹ" title="Info" description="Nothing here yet" tone="info" />
        <EmptyState icon="⚠" title="Warning" description="Session expiring" tone="warning" />
        <EmptyState icon="✓" title="Success" description="All caught up" tone="success" />
      </div>,
    );
    const blocking = await auditNode(container);
    expect(blocking).toEqual([]);
    cleanup();
  });

  it("AnimatedNumber has no serious/critical a11y violations", async () => {
    const { container } = render(<AnimatedNumber value={12345} duration={0} />);
    const blocking = await auditNode(container);
    expect(blocking).toEqual([]);
    cleanup();
  });

  it("Card (interactive) has no serious/critical a11y violations", async () => {
    const { container } = render(
      <Card variant="glass" padding="lg" elevation={2} onClick={() => {}} interactive>
        <div>Card content</div>
      </Card>,
    );
    const blocking = await auditNode(container);
    expect(blocking).toEqual([]);
    cleanup();
  });
});
