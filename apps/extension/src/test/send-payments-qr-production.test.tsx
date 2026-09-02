import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../popup/lib/release-mode", () => ({
  IS_PRODUCTION_BUILD: true,
}));

const navigate = vi.fn();
const goBack = vi.fn();
const defaultSendImplementation = async (kind: string) => {
  if (kind === "get-gas") {
    throw new Error("rpc unavailable");
  }
  return {};
};
const send = vi.fn(defaultSendImplementation);

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
        rawBalance: "0x8ac7230489e80000",
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
  useAddressBookContacts: () => [
    {
      label: "Real Counterparty",
      address: "0x9999999999999999999999999999999999999999",
      addedAt: Date.UTC(2026, 3, 14, 10, 0, 0),
    },
  ],
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
    send.mockReset();
    send.mockImplementation(defaultSendImplementation);
  });

  it("hides demo recent recipients and blocks send review without a live fee quote", async () => {
    render(<SendView state={walletState} />);

    expect(screen.queryByText(/treasury ops/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/staking reserve/i)).not.toBeInTheDocument();
    expect(screen.getByText(/real counterparty/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("0x…"), {
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

  it("locks review to the authoritative prepared fee tuple and cancels the draft", async () => {
    const gasLimit = 50_000n;
    const fastMaxFee = 30_000_000_000n;
    const fastPriorityFee = 3_000_000_000n;
    const estimatedFee = gasLimit * fastMaxFee;
    send.mockImplementation(async (kind: string) => {
      if (kind === "get-gas") {
        return {
          estimate: {
            gasLimit: gasLimit.toString(),
            baseFee: "10000000000",
            maxFeePerGas: "20000000000",
            maxPriorityFeePerGas: "2000000000",
            estimatedCostEth: "0.001",
          },
          tiers: {
            slow: {
              label: "Slow",
              maxFeePerGas: "15000000000",
              maxPriorityFeePerGas: "1000000000",
              speed: "~5 min",
            },
            standard: {
              label: "Standard",
              maxFeePerGas: "20000000000",
              maxPriorityFeePerGas: "2000000000",
              speed: "~30 sec",
            },
            fast: {
              label: "Fast",
              maxFeePerGas: fastMaxFee.toString(),
              maxPriorityFeePerGas: fastPriorityFee.toString(),
              speed: "~15 sec",
            },
          },
        };
      }
      if (kind === "prepare-tx") {
        return {
          draftId: "draft-fee-authority",
          detail: {
            kind: "tx",
            chainId: "0xaa36a7",
            from: "0x1111111111111111111111111111111111111111",
            to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            value: "0x0",
            data: "0x",
            nonce: 7,
            gasLimit: `0x${gasLimit.toString(16)}`,
            maxFeePerGas: `0x${fastMaxFee.toString(16)}`,
            maxPriorityFeePerGas: `0x${fastPriorityFee.toString(16)}`,
            estimatedFee: `0x${estimatedFee.toString(16)}`,
            simulationRisk: "low",
            warnings: [],
          },
          policy: { outcome: "allow", warnings: [] },
        };
      }
      if (kind === "cancel-tx") return { ok: true };
      return {};
    });

    render(<SendView state={walletState} />);
    fireEvent.change(screen.getByPlaceholderText("0x…"), {
      target: { value: "0x2222222222222222222222222222222222222222" },
    });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "1" } });

    await waitFor(() => expect(screen.getByRole("button", { name: /fast/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /fast/i }));
    fireEvent.click(screen.getByRole("button", { name: /review transaction/i }));

    await waitFor(() => expect(screen.getByText(/review send/i)).toBeInTheDocument());
    expect(send).toHaveBeenCalledWith("prepare-tx", expect.objectContaining({
      gas: `0x${gasLimit.toString(16)}`,
      maxFeePerGas: `0x${fastMaxFee.toString(16)}`,
      maxPriorityFeePerGas: `0x${fastPriorityFee.toString(16)}`,
    }));
    expect(screen.getByTestId("review-gas-limit")).toHaveTextContent(
      `0x${gasLimit.toString(16)}`,
    );
    expect(screen.getByTestId("review-max-fee-per-gas")).toHaveTextContent(
      `0x${fastMaxFee.toString(16)}`,
    );
    expect(screen.getByTestId("review-priority-fee-per-gas")).toHaveTextContent(
      `0x${fastPriorityFee.toString(16)}`,
    );
    expect(screen.getByTestId("review-estimated-fee")).toHaveTextContent(
      `0x${estimatedFee.toString(16)}`,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith("cancel-tx", { draftId: "draft-fee-authority" });
      expect(screen.getByRole("button", { name: /review transaction/i })).toBeInTheDocument();
    });
    expect(send).not.toHaveBeenCalledWith("execute-tx", expect.anything());
  });

  it("rejects native bech32 recipients until the native send pipeline exists", () => {
    render(<SendView state={walletState} />);

    fireEvent.change(screen.getByPlaceholderText("0x…"), {
      target: { value: "aethel1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" },
    });

    expect(screen.getByText(/invalid address format/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review transaction/i })).toBeDisabled();
  });

  it("renders production payments from live balances and saved recipients", () => {
    render(<PaymentsView />);

    expect(screen.getByText(/production treasury/i)).toBeInTheDocument();
    expect(screen.queryByText(/treasury payments unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /batch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /scheduled/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /settlement/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/circle mint/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/monthly payroll/i)).not.toBeInTheDocument();
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
