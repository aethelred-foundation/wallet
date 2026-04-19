import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../popup/lib/release-mode", () => ({
  IS_PRODUCTION_BUILD: true,
}));

const navigate = vi.fn();
const send = vi.fn();
const comingSoon = vi.fn();
const mockUseNavigation = vi.fn();

vi.mock("../popup/router", () => ({
  useNavigation: () => mockUseNavigation(),
}));

vi.mock("../popup/hooks/use-coming-soon", () => ({
  useComingSoon: () => comingSoon,
}));

vi.mock("../popup/hooks/use-background", () => ({
  useBackground: () => ({ send }),
}));

import { AppCatalogView } from "../popup/views/app-catalog";
import { HubView } from "../popup/views/hub";

function makeState() {
  return {
    activeWorkspace: { name: "Main" },
    pendingApprovals: [],
    subject: { id: "sub-1", displayName: "Tester" },
    accounts: [],
  } as any;
}

describe("wallet popup ecosystem surfaces in production", () => {
  beforeEach(() => {
    navigate.mockReset();
    send.mockReset();
    comingSoon.mockReset();
    mockUseNavigation.mockReset();
  });

  it("hides roadmap dApps in the app catalog list", () => {
    mockUseNavigation.mockReturnValue({
      view: "app-catalog",
      params: {},
      navigate,
    });

    render(<AppCatalogView state={makeState()} />);

    expect(screen.getByText(/Cruzible/i)).toBeInTheDocument();
    expect(screen.queryByText(/ZeroID/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shiora/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/TerraQura/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NoblePay/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Planned/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Design/i)).not.toBeInTheDocument();
  });

  it("blocks direct access to roadmap dApps in the app catalog", () => {
    mockUseNavigation.mockReturnValue({
      view: "app-catalog",
      params: { appId: "shiora" },
      navigate,
    });

    render(<AppCatalogView state={makeState()} />);

    expect(screen.getByText(/not available in this release/i)).toBeInTheDocument();
  });

  it("shows live dApp detail as informational-only when launch wiring is unavailable", () => {
    mockUseNavigation.mockReturnValue({
      view: "app-catalog",
      params: { appId: "cruzible" },
      navigate,
    });

    render(<AppCatalogView state={makeState()} />);

    expect(screen.getByText(/protocol actions unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /launch cruzible unavailable in this release/i })).toBeDisabled();
    expect(comingSoon).not.toHaveBeenCalled();
  });

  it("shows only live protocol surfaces in the hub", () => {
    mockUseNavigation.mockReturnValue({
      view: "hub",
      params: {},
      navigate,
    });

    render(<HubView state={makeState()} />);

    expect(screen.getByText(/Cruzible/i)).toBeInTheDocument();
    expect(screen.queryByText(/ZeroID/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shiora/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/TerraQura/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NoblePay/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Planned/i)).not.toBeInTheDocument();
  });
});
