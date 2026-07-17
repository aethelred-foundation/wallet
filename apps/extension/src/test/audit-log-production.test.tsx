import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../popup/lib/release-mode", () => ({
  IS_PRODUCTION_BUILD: true,
  IS_DEVELOPMENT_BUILD: false,
  IS_NON_PRODUCTION_BUILD: false,
}));

const send = vi.fn();

vi.mock("../popup/hooks/use-background", () => ({
  useBackground: () => ({ send }),
}));

import { AuditLogView } from "../popup/views/audit-log";

describe("AuditLogView production hardening", () => {
  beforeEach(() => {
    send.mockReset();
  });

  it("shows an unavailable state instead of demo audit entries when the fetch fails", async () => {
    send.mockRejectedValueOnce(new Error("audit service unavailable"));

    render(<AuditLogView />);

    expect(await screen.findByText(/audit verification unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/audit trail unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/0 events logged/i)).toBeInTheDocument();
    expect(screen.queryByText(/wallet initialized/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/key generated/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/approval requested/i)).not.toBeInTheDocument();
  });

  it("never infers verification from a non-empty event list", async () => {
    send.mockResolvedValueOnce({
      events: [{
        id: "event-1",
        sequenceNumber: 1,
        kind: "wallet-initialized",
        detail: {},
        timestamp: 1,
        eventHash: "0xabc",
        previousHash: "0x000",
      }],
      integrity: {
        status: "unavailable",
        eventCount: 1,
        lastSequence: 1,
        checkedAt: null,
        message: "Audit-chain rehydration status is unavailable.",
      },
    });

    render(<AuditLogView />);

    expect(await screen.findByText(/audit verification unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/sha-256 chain verified/i)).not.toBeInTheDocument();
  });

  it("makes an authoritative chain or rehydration failure visible", async () => {
    send.mockResolvedValueOnce({
      events: [],
      integrity: {
        status: "failed",
        eventCount: 0,
        lastSequence: null,
        checkedAt: null,
        message: "Audit-chain rehydration failed: encrypted storage unavailable",
      },
    });

    render(<AuditLogView />);

    expect(await screen.findByText(/audit chain integrity failure/i)).toBeInTheDocument();
    expect(screen.getByText(/rehydration failed.*encrypted storage unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/sha-256 chain verified/i)).not.toBeInTheDocument();
  });
});
