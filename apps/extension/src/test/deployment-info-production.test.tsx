import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NavigationProvider } from "../popup/router";
import { DeploymentInfoView } from "../popup/views/deployment-info";

const writeText = vi.fn<(...args: [string]) => Promise<void>>();

function renderView() {
  render(
    <NavigationProvider initialView="deployment-info">
      <DeploymentInfoView />
    </NavigationProvider>,
  );
}

describe("DeploymentInfoView production provenance", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      runtime: {
        getManifest: () => ({
          manifest_version: 3,
          name: "Aethelred Wallet",
          version: "1.2.3",
          version_name: "1.2.3-rc.4",
        }),
      },
    });
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the installed manifest and labels unavailable provenance truthfully", () => {
    renderView();

    expect(screen.getAllByText("1.2.3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1.2.3-rc.4").length).toBeGreaterThan(0);
    expect(screen.getByText(/read from the installed extension manifest/i)).toBeInTheDocument();
    expect(screen.getByText(/does not expose an authoritative active deployment profile/i)).toBeInTheDocument();
    expect(screen.queryByText(/^active$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/what's new/i)).not.toBeInTheDocument();
    expect(screen.queryByText("2026-04-14")).not.toBeInTheDocument();
    expect(screen.queryByText("a3f8c2d")).not.toBeInTheDocument();
  });

  it("shows copied only after clipboard write succeeds", async () => {
    writeText.mockResolvedValueOnce();
    renderView();

    fireEvent.click(screen.getByRole("button", { name: /copy installed wallet version/i }));

    expect(await screen.findByText(/version copied/i)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("Aethelred Wallet 1.2.3-rc.4");
  });

  it("surfaces clipboard failure without claiming success", async () => {
    writeText.mockRejectedValueOnce(new Error("permission denied"));
    renderView();

    fireEvent.click(screen.getByRole("button", { name: /copy installed wallet version/i }));

    expect(await screen.findByText(/could not copy version/i)).toBeInTheDocument();
    expect(screen.queryByText(/version copied/i)).not.toBeInTheDocument();
  });
});
