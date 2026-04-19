import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../popup/lib/release-mode", () => ({
  IS_PRODUCTION_BUILD: true,
}));

vi.mock("../popup/services/services-context", () => ({
  usePortfolioManager: () => ({
    getTokens: () => [],
  }),
}));

vi.mock("../popup/hooks/use-coming-soon", () => ({
  useComingSoon: () => vi.fn(),
}));

import { MarketsView } from "../popup/views/markets";

describe("MarketsView production hardening", () => {
  it("fails closed for seeded research and risk feeds", () => {
    render(<MarketsView />);

    expect(screen.getByText(/markets portfolio unavailable/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /research/i }));
    expect(screen.getByText(/research feed unavailable/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /risk/i }));
    expect(screen.getByText(/risk monitor unavailable/i)).toBeInTheDocument();
  });
});
