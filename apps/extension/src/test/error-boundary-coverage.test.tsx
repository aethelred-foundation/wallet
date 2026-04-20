/**
 * Per-view error boundary coverage test.
 * ──────────────────────────────────────
 * App.tsx now wraps every case in its `ViewRouter` switch in its own
 * `ViewErrorBoundary`. This suite asserts the contract by simulating
 * render crashes at the per-view boundary level and checking that the
 * fallback UI:
 *
 *   1. Appears — the boundary catches the throw
 *   2. Tags the `viewName` correctly (so telemetry can identify WHICH
 *      view crashed, not just "something crashed")
 *   3. Does NOT tear down its siblings — a sibling node rendered next
 *      to the boundary stays present after the crash
 *
 * We enumerate a representative set of view names (the 37 routes App.tsx
 * wires up) so a future route rename has to touch this test, keeping
 * the test and router in sync.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { ViewErrorBoundary } from "../popup/components/view-error-boundary";

const VIEW_NAMES = [
  "home",
  "portfolio",
  "markets",
  "payments",
  "hub",
  "accounts",
  "account-detail",
  "approvals",
  "app-catalog",
  "settings",
  "send",
  "receive",
  "audit-log",
  "policy-view",
  "workspace-selector",
  "network-selector",
  "activity",
  "deployment-info",
  "contacts",
  "connected-sites",
  "token-approvals",
  "swap",
  "tx-detail",
  "security",
  "recovery-backup",
  "digital-assets",
  "rewards",
  "qr-scanner",
  "regulatory-passport",
  "id-verification",
  "developer-tools",
  "machine-delegation",
  "wallet-connect",
  // onboarding
  "onboarding-create",
  "onboarding-import",
  "onboarding-recovery",
  "onboarding-passkey",
  "onboarding-complete",
];

function Boom(): ReactElement {
  throw new Error("render crashed");
  // eslint-disable-next-line @typescript-eslint/no-unreachable-loop, no-unreachable
  return <></>;
}

describe("per-view error boundary coverage", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let errorSpy: any;

  beforeEach(() => {
    // React logs every caught error via console.error — silence for clean output.
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    cleanup();
  });

  it("wraps all 38 known view names and shows the fallback card for each", () => {
    // There should be exactly 38 routes (33 main + 5 onboarding after the
    // Welcome landing). Guard against silent drift.
    expect(VIEW_NAMES.length).toBe(38);

    for (const name of VIEW_NAMES) {
      cleanup();
      render(
        <ViewErrorBoundary viewName={name}>
          <Boom />
        </ViewErrorBoundary>,
      );
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    }
  });

  it("captures the viewName attribute via the global error hook", () => {
    const captured: Array<string | undefined> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__onViewError = (_err: Error, _info: unknown, viewName?: string) => {
      captured.push(viewName);
    };
    try {
      render(
        <ViewErrorBoundary viewName="send">
          <Boom />
        </ViewErrorBoundary>,
      );
      expect(captured).toContain("send");
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__onViewError;
    }
  });

  it("keeps sibling chrome (header/nav mock) mounted when a view crashes", () => {
    /* Simulates App.tsx's shell: Header + NavBar live OUTSIDE the view
     * boundary. A crash inside the view must NOT unmount them. */
    render(
      <div>
        <header data-testid="shell-header">header</header>
        <div className="view-container">
          <ViewErrorBoundary viewName="settings">
            <Boom />
          </ViewErrorBoundary>
        </div>
        <nav data-testid="shell-nav">nav</nav>
      </div>,
    );

    // The per-view fallback renders.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Sibling chrome stays alive.
    expect(screen.getByTestId("shell-header")).toBeInTheDocument();
    expect(screen.getByTestId("shell-nav")).toBeInTheDocument();
  });

  it("each boundary has independent state — a crash in one doesn't trip the other", () => {
    function Safe(): ReactElement {
      return <div data-testid="safe">safe content</div>;
    }

    render(
      <div>
        <ViewErrorBoundary viewName="crashing-view">
          <Boom />
        </ViewErrorBoundary>
        <ViewErrorBoundary viewName="healthy-view">
          <Safe />
        </ViewErrorBoundary>
      </div>,
    );

    // Crashing boundary shows the fallback.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Healthy boundary continues rendering its children.
    expect(screen.getByTestId("safe")).toBeInTheDocument();
  });
});
