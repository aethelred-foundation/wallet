import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "../popup/components/toast";

vi.mock("../popup/lib/release-mode", () => ({
  IS_PRODUCTION_BUILD: true,
}));

import { useComingSoon } from "../popup/hooks/use-coming-soon";

function ProductionTrigger() {
  const unavailable = useComingSoon();
  return (
    <button
      type="button"
      onClick={() => unavailable("Experimental bridge", "Use the audited transfer flow")}
    >
      check-release-gate
    </button>
  );
}

describe("useComingSoon production release gate", () => {
  it("uses unavailable release copy without claiming a shipping date", () => {
    render(
      <ToastProvider>
        <ProductionTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /check-release-gate/i }));

    expect(
      screen.getByText(
        /Experimental bridge is not available in this release — Use the audited transfer flow/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });
});
