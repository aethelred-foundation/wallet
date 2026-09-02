import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../popup/lib/release-mode", () => ({
  IS_PRODUCTION_BUILD: true,
  IS_DEVELOPMENT_BUILD: false,
  IS_NON_PRODUCTION_BUILD: false,
}));

const goBack = vi.fn();
const send = vi.fn();

vi.mock("../popup/router", () => ({
  useNavigation: () => ({ goBack }),
}));

vi.mock("../popup/hooks/use-background", () => ({
  useBackground: () => ({ send }),
}));

// ActivityView now calls `useToast()` so it can surface speed-up /
// cancel results. The production test mounts the view in isolation
// (no ToastProvider in the tree), so stub the hook with a harmless
// no-op toast function.
vi.mock("../popup/components/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { ActivityView } from "../popup/views/activity";

describe("ActivityView production hardening", () => {
  beforeEach(() => {
    goBack.mockReset();
    send.mockReset();
  });

  it("shows an unavailable state instead of demo activity when the fetch fails", async () => {
    send.mockRejectedValueOnce(new Error("background unavailable"));

    render(<ActivityView />);

    expect(await screen.findAllByText(/activity feed unavailable/i)).toHaveLength(2);
    expect(
      screen.getByText((_, element) => element?.textContent === "0 events logged"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/wallet initialized/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/session created/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/policy evaluated/i)).not.toBeInTheDocument();
  });

  it("renders real transaction-manager records without invented type or asset fields", async () => {
    send.mockImplementation(async (kind: string) => {
      if (kind === "get-tx-history") {
        return [
          {
            hash: "0xnative",
            to: "0x2222222222222222222222222222222222222222",
            value: "0xde0b6b3a7640000",
            data: "0x",
            chainId: "0x1ca4",
            submittedAt: Date.now() - 1_000,
          },
          {
            hash: "0xcontract",
            to: "0x3333333333333333333333333333333333333333",
            value: "0x0",
            data: "0xa9059cbb",
            chainId: "0x1ca4",
            submittedAt: Date.now() - 2_000,
          },
          {
            hash: "0xlegacy",
            to: "0x4444444444444444444444444444444444444444",
            value: "0x1",
            chainId: "0x1ca4",
            submittedAt: Date.now() - 3_000,
          },
        ];
      }
      if (kind === "tx-pending-list") return [];
      return {};
    });

    render(<ActivityView />);

    expect(await screen.findByText("Send")).toBeInTheDocument();
    expect(screen.getByText(/1 AETHEL · to 0x2222…2222/i)).toBeInTheDocument();
    expect(screen.getByText("Contract interaction")).toBeInTheDocument();
    expect(screen.getByText(/to 0x3333…3333 · Amount unavailable/i)).toBeInTheDocument();
    expect(screen.getByText("Transaction")).toBeInTheDocument();
  });

  it("renders the JSON-safe pending summary and labels Aethelred cancellation accurately", async () => {
    send.mockImplementation(async (kind: string) => {
      if (kind === "get-tx-history") return [];
      if (kind === "tx-pending-list") {
        return [
          {
            txHash: "0xpending",
            nonce: 9,
            fromAddress: "0x1111111111111111111111111111111111111111",
            chainId: 7332,
            submittedAt: Date.now() - 5_000,
            to: "0x2222222222222222222222222222222222222222",
            value: "1000000000000000000",
            data: "0x",
            type: "eip1559",
            maxFeePerGas: "25000000000",
            maxPriorityFeePerGas: "2000000000",
            gasLimit: "21000",
            suggestion: {
              minBumpPercent: 11,
              speedUp: {
                maxFeePerGas: "27750000000",
                maxPriorityFeePerGas: "2220000000",
              },
              cancel: {
                maxFeePerGas: "27750000000",
                maxPriorityFeePerGas: "2220000000",
              },
            },
          },
          // The tracker's internal bigint/nested shape must be ignored rather
          // than cast and rendered by an older/misbehaving background worker.
          {
            txHash: "0xraw",
            original: { to: "0x3333333333333333333333333333333333333333", value: 1n },
          },
        ];
      }
      return {};
    });

    render(<ActivityView />);

    expect(await screen.findByTestId("tx-pending-row")).toBeInTheDocument();
    expect(screen.getAllByTestId("tx-pending-row")).toHaveLength(1);
    expect(screen.getByText("1 AETHEL")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(/0 AETHEL self-send/i)).toBeInTheDocument();
  });
});
