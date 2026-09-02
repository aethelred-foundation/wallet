import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../popup/lib/release-mode", () => ({
  IS_PRODUCTION_BUILD: true,
}));

import OptionsApp from "../options/App";

describe("production options page", () => {
  it("fails closed instead of advertising preview administration capabilities", () => {
    render(<OptionsApp />);

    expect(screen.getByRole("heading", { name: /admin console is not enabled/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /workspaces/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /deployment/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/all phases built/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/5 tiers available/i)).not.toBeInTheDocument();
  });
});
