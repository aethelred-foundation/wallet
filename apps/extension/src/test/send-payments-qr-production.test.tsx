import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../popup/lib/release-mode", () => ({
  IS_PRODUCTION_BUILD: true,
}));

const navigate = vi.fn();
const goBack = vi.fn();
const send = vi.fn(async (kind: string) => {
  if (kind === "get-gas") {
    throw new Error("rpc unavailable");
  }
  return {};
});

vi.mock("../popup/router", () => ({
  useNavigation: () => ({
    navigate,
    goBack,
    params: {},
  }),
}));

vi.mock("../popup/hooks/use-background", () => ({
  useBackground: () => ({ send }),
}));

vi.mock("../popup/hooks/use-live-balances", () => ({
  useLiveBalances: () => ({
    tokens: [
      {
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        symbol: "AETHEL",
        name: "Aethelred",
        decimals: 18,
        balance: "10",
        priceUsd: 2,
        change24h: 0,
        value: 20,
      },
    ],
    totalValue: 20,
    totalChange24h: 0,
    totalChangePercent24h: 0,
    isLoading: false,
    isRefreshing: false,
    error: null,
    refresh: vi.fn(),
    lastUpdatedAt: Date.UTC(2026, 3, 16, 8, 30, 0),
  }),
}));

vi.mock("../popup/hooks/use-live-prices", () => ({
  useLivePrices: () => undefined,
}));

vi.mock("../popup/components/currency-text", () => ({
  CurrencyText: ({ value }: { value: number }) => <span>${value}</span>,
}));

vi.mock("../popup/hooks/use-wallet-state", () => ({
  useWalletState: () => ({
    state: walletState,
    lockState: { locked: false, initialized: true },
    loading: false,
    isDevMode: false,
    contextError: null,
  }),
}));

vi.mock("../popup/services/services-context", () => ({
  useAddressBook: () => ({
    listContacts: () => [
      {
        label: "Real Counterparty",
        address: "0x9999999999999999999999999999999999999999",
        addedAt: Date.UTC(2026, 3, 14, 10, 0, 0),
      },
    ],
  }),
}));

import { SendView } from "../popup/views/send";
import { PaymentsView } from "../popup/views/payments";
import { QrScannerView } from "../popup/views/qr-scanner";

const walletState = {
  activeAccountId: "acc-1",
  accounts: [
    { id: "acc-1", address: "0x1111111111111111111111111111111111111111", label: "Primary" },
  ],
  policy: { mode: "Strict" },
} as any;

describe("send, payments, and qr production hardening", () => {
  beforeEach(() => {
    navigate.mockReset();
    goBack.mockReset();
    send.mockClear();
  });

  it("hides demo recent recipients and blocks send review without a live fee quote", async () => {
    render(<SendView state={walletState} />);

    expect(screen.queryByText(/treasury ops/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/staking reserve/i)).not.toBeInTheDocument();
    expect(screen.getByText(/real counterparty/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/0x… or aethel1…/i), {
      target: { value: "0x2222222222222222222222222222222222222222" },
    });
    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "1" },
    });

    await waitFor(() => {
      expect(send).toHaveBeenCalledWith("get-gas", expect.any(Object));
    });

    expect(screen.getByText(/live fee quote/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review transaction/i })).toBeDisabled();
  });

  it("renders production payments from live balances and saved recipients", () => {
    render(<PaymentsView />);

    expect(screen.getByText(/production treasury/i)).toBeInTheDocument();
    expect(screen.queryByText(/treasury payments unavailable/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /recipients/i }));
    expect(screen.getByText(/real counterparty/i)).toBeInTheDocument();
  });

  it("uses the browser qr capability and reports unsupported browsers honestly", async () => {
    render(<QrScannerView />);

    fireEvent.click(screen.getByRole("button", { name: /open camera/i }));
    expect(await screen.findByText(/camera unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/does not expose a qr scanning engine yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /simulate scan/i })).not.toBeInTheDocument();
  });
});
