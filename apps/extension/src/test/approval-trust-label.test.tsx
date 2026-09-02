import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AethelredWalletState, ApprovalSummary } from "@aethelred/wallet-connect";

vi.mock("../popup/router", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

vi.mock("../popup/hooks/use-background", () => ({
  useBackground: () => ({ send: vi.fn() }),
}));

vi.mock("../popup/hooks/use-haptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../popup/hooks/use-sound", () => ({
  useSound: () => ({ playSuccess: vi.fn(), playError: vi.fn() }),
}));

import { FormatProvider } from "../popup/i18n/format";
import { ApprovalsView } from "../popup/views/approvals";

function makeApproval(overrides: Partial<ApprovalSummary>): ApprovalSummary {
  return {
    id: "approval-1",
    title: "Connect to wallet",
    summary: "Review this connection request.",
    appName: "Example dApp",
    requiredAction: "one reviewer",
    status: "pending",
    detail: {
      kind: "connect",
      permissions: ["eth_accounts"],
      accountAddresses: [],
    },
    ...overrides,
  };
}

function renderApproval(approval: ApprovalSummary): void {
  const state = {
    subject: { id: "subject-1", displayName: "Tester", kind: "person" },
    pendingApprovals: [approval],
  } as AethelredWalletState;

  render(
    <FormatProvider>
      <ApprovalsView state={state} />
    </FormatProvider>,
  );
}

describe("approval source trust labels", () => {
  it("does not grant first-party status to a spoofed application name", () => {
    renderApproval(
      makeApproval({
        appName: "Cruzible",
        origin: "https://cruzible.attacker.example",
      }),
    );

    expect(screen.queryByText(/first-party/i)).not.toBeInTheDocument();
    expect(screen.getByText("Source: https://cruzible.attacker.example")).toBeInTheDocument();
  });

  it("shows first-party status only when origin-derived metadata says so", () => {
    renderApproval(
      makeApproval({
        appName: "Cruzible",
        origin: "https://cruzible.aethelred.org",
        trustLevel: "first-party",
      }),
    );

    expect(screen.getByText("Verified first-party origin")).toBeInTheDocument();
  });
});
