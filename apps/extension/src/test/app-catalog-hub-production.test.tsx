import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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
    activeWorkspace: { name: "Main", kind: "personal", role: "owner" },
    pendingApprovals: [],
    subject: { id: "sub-1", displayName: "Tester" },
    accounts: [],
    sessions: [],
    policy: { mode: "guided", highlights: ["Authoritative policy rule"] },
  } as any;
}

describe("wallet popup ecosystem surfaces in production", () => {
  beforeEach(() => {
    navigate.mockReset();
    send.mockReset();
    comingSoon.mockReset();
    mockUseNavigation.mockReset();
  });

  it("fails closed without publishing static catalog claims", () => {
    mockUseNavigation.mockReturnValue({
      view: "app-catalog",
      params: {},
      navigate,
    });

    render(<AppCatalogView state={makeState()} />);

    expect(screen.getByText(/App catalog unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/does not publish a verified dApp catalog/i)).toBeInTheDocument();
    expect(screen.queryByText(/Cruzible/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ZeroID/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shiora/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/TerraQura/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NoblePay/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/8\.4%/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Audited by/i)).not.toBeInTheDocument();
  });

  it("fails closed on direct app routes without disclosing preview data", () => {
    mockUseNavigation.mockReturnValue({
      view: "app-catalog",
      params: { appId: "shiora" },
      navigate,
    });

    render(<AppCatalogView state={makeState()} />);

    expect(screen.getByText(/App catalog unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/Shiora/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/AES-256-GCM/i)).not.toBeInTheDocument();
  });

  it("routes catalog users to authoritative connected-session management", () => {
    mockUseNavigation.mockReturnValue({
      view: "app-catalog",
      params: { appId: "cruzible" },
      navigate,
    });

    render(<AppCatalogView state={makeState()} />);

    fireEvent.click(screen.getByRole("button", { name: /review connected sites/i }));

    expect(navigate).toHaveBeenCalledWith("connected-sites");
    expect(comingSoon).not.toHaveBeenCalled();
  });

  it("shows connection guidance in the hub without protocol or governance claims", () => {
    mockUseNavigation.mockReturnValue({
      view: "hub",
      params: {},
      navigate,
    });

    render(<HubView state={makeState()} />);

    expect(screen.getByText(/Connect dApps from their websites/i)).toBeInTheDocument();
    expect(screen.getByText(/approve its connection request/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /governance/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Cruzible/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ZeroID/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shiora/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/TerraQura/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NoblePay/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Live Ecosystem/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Increase Cruzible vault cap/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /review connected sites/i }));
    expect(navigate).toHaveBeenCalledWith("connected-sites");
  });

  it("routes approvals to the canonical structured review without duplicate Hub actions", () => {
    mockUseNavigation.mockReturnValue({
      view: "hub",
      params: {},
      navigate,
    });
    const state = makeState();
    state.pendingApprovals = [{
      id: "approval-1",
      title: "Send 999999 USDC",
      summary: "Send 999999 USDC to somewhere",
      appName: "Untrusted text",
      requiredAction: "Review",
      status: "pending",
    }];

    render(<HubView state={state} />);
    fireEvent.click(screen.getByRole("button", { name: /approvals/i }));

    expect(navigate).toHaveBeenCalledWith("approvals");
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^reject$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/999999 USDC/i)).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("shows authoritative policy state without an invented numeric strictness score", () => {
    mockUseNavigation.mockReturnValue({
      view: "hub",
      params: {},
      navigate,
    });

    render(<HubView state={makeState()} />);
    fireEvent.click(screen.getByRole("button", { name: /policy/i }));

    expect(screen.getByText("guided", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Authoritative policy rule")).toBeInTheDocument();
    expect(screen.queryByText(/STRICT/i)).not.toBeInTheDocument();
    expect(screen.queryByText("25", { exact: true })).not.toBeInTheDocument();
  });
});
