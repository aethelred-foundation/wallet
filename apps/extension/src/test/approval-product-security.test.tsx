import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AethelredWalletState, ApprovalSummary } from "@aethelred/wallet-connect";

const send = vi.fn();
const navigate = vi.fn();
const hapticSuccess = vi.fn();
const hapticError = vi.fn();
const playSuccess = vi.fn();
const playError = vi.fn();

vi.mock("../popup/router", () => ({
  useNavigation: () => ({ navigate }),
}));

vi.mock("../popup/hooks/use-background", () => ({
  useBackground: () => ({ send }),
}));

vi.mock("../popup/hooks/use-haptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    success: hapticSuccess,
    warning: vi.fn(),
    error: hapticError,
  }),
}));

vi.mock("../popup/hooks/use-sound", () => ({
  useSound: () => ({ playSuccess, playError }),
}));

import { FormatProvider } from "../popup/i18n/format";
import { ApprovalsView } from "../popup/views/approvals";

const FROM = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0xcafebabecafebabecafebabecafebabecafebabe";
const TOKEN = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const AMOUNT_BASE_UNITS = 12_500_000n;
const GAS_LIMIT = 21_000n;
const MAX_FEE_PER_GAS = 25_000_000_000n;
const MAX_PRIORITY_FEE_PER_GAS = 2_000_000_000n;
const MAXIMUM_FEE = GAS_LIMIT * MAX_FEE_PER_GAS;
const CALLDATA = `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${AMOUNT_BASE_UNITS.toString(16).padStart(64, "0")}`;

function erc20Approval(): ApprovalSummary {
  return {
    id: "approval-erc20",
    title: "Confirm transaction",
    summary: "Untrusted summary text must not drive the review.",
    appName: "Example dApp",
    origin: "https://example.test",
    requiredAction: "Your approval",
    status: "pending",
    detail: {
      kind: "tx",
      chainId: "0x1",
      from: FROM,
      to: TOKEN,
      value: "0x0",
      data: CALLDATA,
      nonce: 7,
      gasLimit: `0x${GAS_LIMIT.toString(16)}`,
      maxFeePerGas: `0x${MAX_FEE_PER_GAS.toString(16)}`,
      maxPriorityFeePerGas: `0x${MAX_PRIORITY_FEE_PER_GAS.toString(16)}`,
      estimatedFee: `0x${MAXIMUM_FEE.toString(16)}`,
      simulationRisk: "low",
      warnings: [],
      decodedMethod: "transfer",
      decodedParams: {
        recipient: RECIPIENT,
        amount: "12.5",
        amountBaseUnits: AMOUNT_BASE_UNITS.toString(),
        symbol: "USDC",
        tokenContract: TOKEN,
      },
      reviewedSpending: {
        kind: "erc20",
        recipient: RECIPIENT,
        amount: "12.5",
        amountBaseUnits: AMOUNT_BASE_UNITS.toString(),
        decimals: 6,
        symbol: "USDC",
        tokenContract: TOKEN,
        nativeValue: "0x0",
      },
      amountUsd: 12.5,
      assetSymbol: "USDC",
    },
  };
}

function stateWith(approval: ApprovalSummary): AethelredWalletState {
  return {
    subject: { id: "subject-1", displayName: "Tester", kind: "person" },
    pendingApprovals: [approval],
  } as AethelredWalletState;
}

function renderApproval(approval = erc20Approval()) {
  return render(
    <FormatProvider>
      <ApprovalsView state={stateWith(approval)} />
    </FormatProvider>,
  );
}

function row(label: string): HTMLElement {
  const labelNode = screen.getByText(label, { selector: ".apv2-kv-label" });
  const parent = labelNode.closest(".apv2-kv");
  if (!(parent instanceof HTMLElement)) throw new Error(`Missing row: ${label}`);
  return parent;
}

describe("canonical approval product security", () => {
  beforeEach(() => {
    send.mockReset();
    navigate.mockReset();
    hapticSuccess.mockReset();
    hapticError.mockReset();
    playSuccess.mockReset();
    playError.mockReset();
  });

  it("renders ERC-20 recipient, exact token amount, contract, zero native value, and immutable gas separately", () => {
    renderApproval();

    expect(screen.getByText("12.5", { selector: ".apv2-amount-value" })).toBeInTheDocument();
    expect(screen.getByText("USDC", { selector: ".apv2-amount-asset" })).toBeInTheDocument();
    expect(within(row("Recipient")).getByText("0xcafe…babe")).toBeInTheDocument();
    expect(within(row("Token contract")).getByText("0xa0b8…eb48")).toBeInTheDocument();
    expect(within(row("Token base units")).getByText("12500000")).toBeInTheDocument();
    expect(within(row("Native value")).getByText("0 ETH (0 base units)")).toBeInTheDocument();
    expect(within(row("Gas limit")).getByText("21,000")).toBeInTheDocument();
    expect(within(row("Max fee per gas")).getByText("25 gwei")).toBeInTheDocument();
    expect(within(row("Max priority fee")).getByText("2 gwei")).toBeInTheDocument();
    expect(within(row("Maximum fee")).getByText("0.000525 ETH")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeEnabled();
  });

  it("fails closed when structured spending facts are missing", () => {
    const approval = erc20Approval();
    if (approval.detail?.kind !== "tx") throw new Error("Expected tx fixture");
    delete approval.detail.reviewedSpending;
    renderApproval(approval);

    expect(screen.getByText(/Authoritative spending facts are missing/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeEnabled();
  });

  it("renders a no-signal message approval without crashing", () => {
    const approval: ApprovalSummary = {
      id: "approval-safe-message",
      title: "Sign in",
      summary: "Sign in to the requesting application.",
      appName: "Shiora",
      origin: "http://93.127.132.52:3001",
      requiredAction: "one reviewer",
      status: "pending",
      detail: {
        kind: "personal_sign",
        from: FROM,
        preview: "Sign in to Shiora",
        rawHex: "0x5369676e20696e20746f205368696f7261",
        isPermit: false,
        risk: "safe",
      },
    };

    renderApproval(approval);

    expect(screen.getByText("No risk signals")).toBeInTheDocument();
    expect(within(row("Risk")).getByText("SAFE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeEnabled();
  });

  it("fails closed instead of crashing when a persisted message risk is malformed", () => {
    const approval = {
      id: "approval-malformed-message",
      title: "Sign in",
      summary: "Malformed persisted request.",
      appName: "Example dApp",
      origin: "https://example.test",
      requiredAction: "one reviewer",
      status: "pending",
      detail: {
        kind: "personal_sign",
        from: FROM,
        preview: "Sign in",
        rawHex: "0x5369676e20696e",
        isPermit: false,
        risk: "unknown",
      },
    } as unknown as ApprovalSummary;

    renderApproval(approval);

    expect(screen.getByText(/risk assessment is missing or invalid/i)).toBeInTheDocument();
    expect(screen.getByText("Review blocked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeEnabled();
  });

  it("treats only explicit ok:true as resolution success and retains a stale card on failure", async () => {
    send.mockResolvedValue({ ok: false, reason: "approval-not-found" });
    renderApproval();

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() => {
      expect(screen.getByText(/did not confirm that this approval was resolved/i)).toBeInTheDocument();
    });
    expect(screen.getByText("Confirm transaction")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeEnabled();
    expect(hapticSuccess).not.toHaveBeenCalled();
    expect(playSuccess).not.toHaveBeenCalled();
    expect(hapticError).toHaveBeenCalled();
    expect(playError).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
