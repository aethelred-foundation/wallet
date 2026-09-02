import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const sendMock = vi.fn();
const authenticateForUnlockMock = vi.fn();

vi.mock("../popup/hooks/use-background", () => ({
  useBackground: () => ({ send: sendMock }),
}));

vi.mock("../popup/hooks/use-passkey-authentication", () => ({
  usePasskeyAuthentication: () => ({
    authenticateForUnlock: authenticateForUnlockMock,
    authenticating: false,
  }),
}));

import { LockScreenView } from "../popup/views/lock-screen";

describe("LockScreenView passkey unlock", () => {
  beforeEach(() => {
    localStorage.clear();
    sendMock.mockReset();
    authenticateForUnlockMock.mockReset();
  });

  it("does not expose the old fake biometric success path", () => {
    localStorage.setItem("aethelred-biometric", "1");
    render(<LockScreenView onUnlock={vi.fn()} />);

    expect(screen.getByText(/enrolled passkeys are verified on every unlock/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /unlock with biometrics/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/biometric unlock unavailable/i)).not.toBeInTheDocument();
  });

  it("passes the one-time grant to unlock after a successful assertion", async () => {
    authenticateForUnlockMock.mockResolvedValue({
      required: true,
      unlockGrant: "one-time-passkey-grant",
    });
    sendMock.mockResolvedValue({ locked: false });
    const onUnlock = vi.fn();
    render(<LockScreenView onUnlock={onUnlock} />);

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() => {
      expect(authenticateForUnlockMock).toHaveBeenCalledWith(
        "correct horse battery staple",
      );
      expect(sendMock).toHaveBeenCalledWith("unlock-request", {
        password: "correct horse battery staple",
        passkeyGrant: "one-time-passkey-grant",
      });
    });
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it("keeps password-only wallets compatible", async () => {
    authenticateForUnlockMock.mockResolvedValue({ required: false });
    sendMock.mockResolvedValue({ locked: false });
    render(<LockScreenView onUnlock={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password-only" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() => {
      expect(authenticateForUnlockMock).toHaveBeenCalledWith("password-only");
      expect(sendMock).toHaveBeenCalledWith("unlock-request", {
        password: "password-only",
      });
    });
  });
});
