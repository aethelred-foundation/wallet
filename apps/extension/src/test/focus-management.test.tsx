/**
 * Focus management on route change.
 * ─────────────────────────────────
 * When the user navigates between views, focus must move to the new
 * view's main heading (or the scroll container as a fallback). This
 * is a core screen-reader + keyboard-accessibility contract: native
 * apps do it via the navigation stack, the web has to do it by hand.
 *
 * App.tsx's scroll-reset effect also moves focus. This suite isolates
 * the focus-move behaviour so we can assert it without spinning up
 * the full service provider tree.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useEffect } from "react";

/**
 * Minimal reproduction of the focus-move logic from App.tsx. We keep
 * a local copy so this test pins the behavior even if App.tsx is
 * rearranged. If App.tsx changes the implementation, update BOTH.
 */
function FocusShell({ view }: { view: string }) {
  useEffect(() => {
    const container = document.querySelector<HTMLElement>(".view-container");
    if (container) container.scrollTop = 0;
    const id = window.setTimeout(() => {
      const heading = document.querySelector<HTMLElement>("main h1");
      const target: HTMLElement | null =
        heading ??
        (container ? (container.setAttribute("tabindex", "-1"), container) : null);
      if (target) {
        try {
          target.focus({ preventScroll: true });
        } catch {
          // swallow
        }
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [view]);

  return (
    <main>
      <div className="view-container">
        {view === "with-heading" ? (
          <>
            <h1 tabIndex={-1} data-testid="heading">
              Page title
            </h1>
            <p>body</p>
          </>
        ) : (
          <p data-testid="no-heading-body">body without heading</p>
        )}
      </div>
    </main>
  );
}

describe("focus management on route change", () => {
  afterEach(() => {
    cleanup();
  });

  it("moves focus to main h1 after navigation when one exists", async () => {
    const { rerender, findByTestId } = render(<FocusShell view="empty" />);
    // Advance microtasks so the timer fires.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    rerender(<FocusShell view="with-heading" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const heading = await findByTestId("heading");
    expect(document.activeElement).toBe(heading);
  });

  it("falls back to the scroll container with tabindex=-1 when no h1 is present", async () => {
    render(<FocusShell view="no-heading" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const container = document.querySelector<HTMLElement>(".view-container");
    expect(container).not.toBeNull();
    // The effect adds tabindex so the container can receive focus.
    expect(container?.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(container);
  });

  it("does not throw when the shell is missing (defensive)", async () => {
    // Render into an element with no .view-container to prove the
    // effect handles the null case gracefully. We use the simplest
    // possible tree that skips the .view-container wrapper.
    function NoShell() {
      useEffect(() => {
        const container = document.querySelector<HTMLElement>(".not-there");
        if (container) container.scrollTop = 0;
        const id = window.setTimeout(() => {
          const heading = document.querySelector<HTMLElement>("main h1");
          const target: HTMLElement | null =
            heading ??
            (container ? (container.setAttribute("tabindex", "-1"), container) : null);
          if (target) {
            try {
              target.focus({ preventScroll: true });
            } catch {
              // swallow
            }
          }
        }, 0);
        return () => window.clearTimeout(id);
      }, []);
      return <div>nothing</div>;
    }
    expect(() => render(<NoShell />)).not.toThrow();
  });
});
