import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../popup/lib/release-mode", () => ({
  IS_PRODUCTION_BUILD: true,
}));

const navigate = vi.fn();
const goBack = vi.fn();
const comingSoon = vi.fn();
const send = vi.fn(async (kind: string) => {
  if (kind === "get-tx") {
    return {
      hash: "0xabc123",
      status: "pending",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      timestamp: Date.now(),
      chainId: "0x1",
      amount: "1.00",
      asset: "AETHEL",
    };
  }
  if (kind === "prepare-tx") {
    return { draftId: "draft-1" };
  }
  if (kind === "execute-tx") {
    return { hash: "0xswap123" };
  }
  return {};
});

vi.mock("../popup/router", () => ({
  useNavigation: () => ({
    navigate,
    goBack,
    params: { txHash: "0xabc123" },
  }),
}));

vi.mock("../popup/hooks/use-coming-soon", () => ({
  useComingSoon: () => comingSoon,
}));

vi.mock("../popup/hooks/use-background", () => ({
  useBackground: () => ({ send }),
}));

vi.mock("../popup/hooks/use-wallet-state", () => ({
  useWalletState: () => ({
    state: {
      activeAccountId: "acc-1",
      accounts: [
        { id: "acc-1", address: "0x1111111111111111111111111111111111111111", label: "Primary" },
      ],
    },
  }),
}));

vi.mock("../popup/hooks/use-live-balances", () => ({
  useLiveBalances: () => ({
    tokens: [
      {
        address: "0xaaaa",
        symbol: "AETHEL",
        name: "Aethelred",
        decimals: 18,
        balance: "10",
        priceUsd: 2,
        change24h: 1,
        value: 20,
      },
      {
        address: "0xbbbb",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        balance: "100",
        priceUsd: 1,
        change24h: 0,
        value: 100,
      },
    ],
  }),
}));

import { TxDetailView } from "../popup/views/tx-detail";
import { SwapView } from "../popup/views/swap";

describe("transaction-related wallet production hardening", () => {
  it("shows pending transaction speed-up as unavailable in production", async () => {
    render(<TxDetailView />);

    expect(await screen.findByText(/transaction pending/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /transaction speed-up unavailable in this release/i })).toBeDisabled();
    expect(comingSoon).not.toHaveBeenCalled();
  });

  it("shows swap explorer action as unavailable after submission", async () => {
    render(<SwapView />);

    fireEvent.change(screen.getAllByPlaceholderText("0")[0], { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /review swap/i }));
    expect(await screen.findByRole("button", { name: /confirm swap/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /confirm swap/i }));
    expect(await screen.findByText(/swap submitted/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /view on explorer unavailable in this release/i })).toBeDisabled();
  });
});
