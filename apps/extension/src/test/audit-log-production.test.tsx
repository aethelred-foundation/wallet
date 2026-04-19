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

    expect(await screen.findAllByText(/audit trail unavailable/i)).toHaveLength(2);
    expect(screen.getByText(/0 events logged/i)).toBeInTheDocument();
    expect(screen.queryByText(/wallet initialized/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/key generated/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/approval requested/i)).not.toBeInTheDocument();
  });
});
