import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToastProvider } from "../popup/components/toast";
import { useComingSoon } from "../popup/hooks/use-coming-soon";

function TriggerButton() {
  const comingSoon = useComingSoon();
  return (
    <button type="button" onClick={() => comingSoon("Test feature")}>
      fire-coming-soon
    </button>
  );
}

describe("useComingSoon", () => {
  it("fires an info toast when invoked", () => {
    render(
      <ToastProvider>
        <TriggerButton />
      </ToastProvider>,
    );

    // No toast on initial render.
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /fire-coming-soon/i }));

    // Toast provider renders the message into the DOM.
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    expect(screen.getByText(/Test feature/)).toBeInTheDocument();
  });
});
