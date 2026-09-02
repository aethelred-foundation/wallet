import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
import { isViewReleased } from "../popup/lib/feature-availability";

describe("MarketsView production hardening", () => {
  it("removes markets and the static app catalog from released navigation", () => {
    expect(isViewReleased("markets")).toBe(false);
    expect(isViewReleased("app-catalog")).toBe(false);
  });

  it("fails closed without publishing synthetic market content", () => {
    render(<MarketsView />);

    expect(screen.getByText(/markets are not enabled/i)).toBeInTheDocument();
    expect(screen.getByText(/does not publish a verified market-news or research feed/i)).toBeInTheDocument();
    expect(screen.queryByText(/market news/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refresh/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tokens/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /research/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /risk/i })).not.toBeInTheDocument();
  });
});
