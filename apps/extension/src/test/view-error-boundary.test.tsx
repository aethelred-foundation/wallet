import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ViewErrorBoundary } from "../popup/components/view-error-boundary";

/** Boom is a throw-during-render component. Its declared return type is
 *  `ReactElement` (not `void`) so TypeScript will accept it as a JSX child;
 *  at runtime control never reaches the unreachable `return`. */
function Boom(): ReactElement {
  throw new Error("boom");
  // eslint-disable-next-line @typescript-eslint/no-unreachable-loop, no-unreachable
  return <></>;
}

function Safe(): ReactElement {
  return <div>all good</div>;
}

describe("ViewErrorBoundary", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let errorSpy: any;

  beforeEach(() => {
    // React logs every error boundary catch via console.error — silence it
    // so the test output stays clean.
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("catches a render error and shows the fallback UI", () => {
    render(
      <ViewErrorBoundary viewName="test-view">
        <Boom />
      </ViewErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("resets hasError when Try again is clicked and the child no longer throws", () => {
    const { rerender } = render(
      <ViewErrorBoundary viewName="test-view">
        <Boom />
      </ViewErrorBoundary>,
    );

    // Initially crashed.
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();

    // Swap in a safe child FIRST — the boundary will still be in hasError
    // state, so the fallback keeps rendering (children are ignored).
    rerender(
      <ViewErrorBoundary viewName="test-view">
        <Safe />
      </ViewErrorBoundary>,
    );

    // Still showing fallback because hasError is sticky until retry.
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();

    // Now click Try again — state resets, render falls through to Safe.
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
    expect(screen.getByText("all good")).toBeInTheDocument();
  });
});
