import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";

const sendMock = vi.fn();
vi.mock("../popup/hooks/use-background", () => ({
  useBackground: () => ({ send: sendMock }),
}));
vi.mock("../popup/router", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

import { ConnectedSitesView } from "../popup/views/connected-sites";

const state = {
  subject: { id: "subject-1" },
  sessions: [
    {
      id: "session-1",
      appName: "Cruzible",
      origin: "https://cruzible.example",
      trustLevel: "first-party",
      permissions: ["accounts"],
      status: "active",
      createdAt: Date.now(),
    },
  ],
} as unknown as AethelredWalletState;

describe("ConnectedSitesView production revocation", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ ok: true });
  });
  afterEach(cleanup);

  it("revokes the durable session instead of rejecting an unrelated approval", async () => {
    render(<ConnectedSitesView state={state} />);

    fireEvent.click(screen.getByRole("button", { name: /disconnect cruzible/i }));
    fireEvent.click(screen.getByRole("button", { name: /^disconnect$/i }));

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith("revoke-session", {
        sessionId: "session-1",
      });
    });
    expect(sendMock).not.toHaveBeenCalledWith(
      "approval-response",
      expect.anything(),
    );
  });

  it("shows the authoritative session timestamp rather than a hash-derived time", () => {
    render(<ConnectedSitesView state={state} />);
    expect(screen.getByText(/connected just now/i)).toBeInTheDocument();
  });
});
