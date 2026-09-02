import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const sendMock = vi.fn();
const navigateMock = vi.fn();
const enrollMock = vi.fn();
const verifySupportMock = vi.fn();

vi.mock("../popup/hooks/use-background", () => ({
  useBackground: () => ({ send: sendMock }),
}));

vi.mock("../popup/router", () => ({
  useNavigation: () => ({ navigate: navigateMock }),
}));

vi.mock("../popup/hooks/use-passkey-enrollment", () => ({
  usePasskeyEnrollment: () => ({
    enroll: enrollMock,
    verifySupport: verifySupportMock,
    enrolling: false,
  }),
}));

import { SecurityView } from "../popup/views/security";

const settings = {
  autoLockMs: 5 * 60_000,
  passkeyCount: 1,
  transactionReview: true,
  localKeyEncryption: true,
};

const passkey = {
  id: "passkey-1",
  label: "Laptop passkey",
  credentialId: "credential-1",
  rpId: "chrome-extension://wallet-id",
  transports: ["internal"],
  issuedAt: Date.now() - 1_000,
};

function useValidRuntime(overrides?: { passkeys?: unknown; settings?: unknown }) {
  sendMock.mockImplementation((kind: string) => {
    if (kind === "passkey-list") return Promise.resolve(overrides?.passkeys ?? [passkey]);
    if (kind === "get-security-settings") return Promise.resolve(overrides?.settings ?? settings);
    throw new Error(`Unexpected background request: ${kind}`);
  });
}

describe("SecurityView production states", () => {
  beforeEach(() => {
    sendMock.mockReset();
    navigateMock.mockReset();
    enrollMock.mockReset();
    verifySupportMock.mockReset();
    verifySupportMock.mockResolvedValue({ supported: true });
  });

  it("shows independent loading states without inventing a security posture", () => {
    sendMock.mockReturnValue(new Promise(() => undefined));

    render(<SecurityView />);

    expect(screen.getByText("Loading security settings…")).toBeInTheDocument();
    expect(screen.getByText("Loading passkeys…")).toBeInTheDocument();
    expect(screen.queryByText("SECURITY SETUP COVERAGE")).not.toBeInTheDocument();
    expect(screen.queryByText(/\/100/)).not.toBeInTheDocument();
    expect(screen.queryByText("Encrypted local vault")).not.toBeInTheDocument();
    expect(screen.queryByText("Password-only unlock")).not.toBeInTheDocument();
  });

  it("rejects malformed settings without displaying fallback protection claims", async () => {
    useValidRuntime({
      passkeys: [],
      settings: { ...settings, autoLockMs: "five minutes" },
    });

    render(<SecurityView />);

    expect(await screen.findByText("The wallet returned invalid security settings")).toBeInTheDocument();
    expect(screen.queryByText("SECURITY SETUP COVERAGE")).not.toBeInTheDocument();
    expect(screen.queryByText("Encrypted local vault")).not.toBeInTheDocument();
    expect(screen.queryByText(/5 minutes of inactivity/i)).not.toBeInTheDocument();
    expect(screen.getByText("Password-only unlock")).toBeInTheDocument();
  });

  it("rejects malformed passkey data without labeling unlock as password-only", async () => {
    useValidRuntime({ passkeys: { credentials: [] } });

    render(<SecurityView />);

    expect(await screen.findByText("The wallet returned invalid passkey data")).toBeInTheDocument();
    expect(screen.getByText("Encrypted local vault")).toBeInTheDocument();
    expect(screen.queryByText("Password-only unlock")).not.toBeInTheDocument();
    expect(screen.queryByText("SECURITY SETUP COVERAGE")).not.toBeInTheDocument();
  });

  it("reports factual setup coverage and honest passkey and auto-lock behavior", async () => {
    useValidRuntime();

    render(<SecurityView />);

    expect(await screen.findByText("SECURITY SETUP COVERAGE")).toBeInTheDocument();
    expect(screen.getByText("4/4")).toBeInTheDocument();
    expect(screen.getByText("4 of 4 protections configured")).toBeInTheDocument();
    expect(screen.queryByText(/\/100/)).not.toBeInTheDocument();
    expect(screen.getByText(/browser suspension may lock sooner/i)).toBeInTheDocument();
    expect(screen.getByText(/device passkey or compatible security key with your password/i)).toBeInTheDocument();
    expect(screen.queryByText(/hardware-backed second factor/i)).not.toBeInTheDocument();
  });

  it("warns before removing the last passkey and requires an explicit success result", async () => {
    useValidRuntime();
    sendMock.mockImplementation((kind: string) => {
      if (kind === "passkey-list") return Promise.resolve([passkey]);
      if (kind === "get-security-settings") return Promise.resolve(settings);
      if (kind === "passkey-remove") return Promise.resolve({ ok: false });
      throw new Error(`Unexpected background request: ${kind}`);
    });

    render(<SecurityView />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove passkey Laptop passkey" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Remove your last passkey?")).toBeInTheDocument();
    expect(within(dialog).getByText(/returns unlock to password only/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove passkey" }));

    expect(await screen.findByText("The wallet did not confirm passkey removal")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps removal single-flight while the background confirmation is pending", async () => {
    let resolveRemoval!: (value: { ok: true }) => void;
    const removal = new Promise<{ ok: true }>((resolve) => {
      resolveRemoval = resolve;
    });
    sendMock.mockImplementation((kind: string) => {
      if (kind === "passkey-list") return Promise.resolve([passkey]);
      if (kind === "get-security-settings") return Promise.resolve(settings);
      if (kind === "passkey-remove") return removal;
      throw new Error(`Unexpected background request: ${kind}`);
    });

    render(<SecurityView />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove passkey Laptop passkey" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove passkey" }));

    const removingButton = await screen.findByRole("button", { name: "Removing…" });
    fireEvent.click(removingButton);
    expect(sendMock.mock.calls.filter(([kind]) => kind === "passkey-remove")).toHaveLength(1);

    resolveRemoval({ ok: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
