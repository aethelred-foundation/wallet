import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigate = vi.fn();
const send = vi.fn(async (kind: string, payload: unknown) => {
  if (kind === "get-networks") {
    return { active: "0x1", networks: [] };
  }
  if (kind === "switch-network") {
    return { chainId: (payload as { chainId: string }).chainId };
  }
  throw new Error(`Unexpected request: ${kind}`);
});

const ethereum = {
  chainId: "0x1",
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://example.invalid"],
  blockExplorerUrl: "https://etherscan.io",
  isTestnet: false,
};

const polygon = {
  chainId: "0x89",
  name: "Polygon",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: ["https://example.invalid"],
  blockExplorerUrl: "https://polygonscan.com",
  isTestnet: false,
};

vi.mock("../popup/router", () => ({
  useNavigation: () => ({ navigate }),
}));

vi.mock("../popup/hooks/use-background", () => ({
  useBackground: () => ({ send }),
}));

vi.mock("../popup/services/services-context", () => ({
  useNetworkManager: () => ({
    getActiveChainId: () => "0x1",
    listMainnets: () => [ethereum, polygon],
    listTestnets: () => [],
  }),
}));

import { NetworkSelectorView } from "../popup/views/network-selector";

describe("NetworkSelectorView background authority", () => {
  it("changes the displayed network only after the background confirms it", async () => {
    render(<NetworkSelectorView />);

    await waitFor(() => expect(send).toHaveBeenCalledWith("get-networks", {}));
    fireEvent.click(screen.getByRole("button", { name: /polygon/i }));

    await waitFor(() => {
      expect(send).toHaveBeenCalledWith("switch-network", { chainId: "0x89" });
      expect(screen.getByText("Chain 0x89")).toBeInTheDocument();
    });
  });
});
