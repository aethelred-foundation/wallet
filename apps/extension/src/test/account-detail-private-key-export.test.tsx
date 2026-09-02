/**
 * Account detail — private key export flow.
 *
 * The background decides whether a key may leave the vault; this view's job
 * is to make sure nobody reaches that decision by accident. So the tests are
 * about friction and cleanup: the request is not sent until the user has
 * acknowledged the risk and typed a password, the key arrives masked, and
 * every path that ends the reveal — Hide, the 60-second timer, a lock, an
 * account change, unmount — leaves nothing behind.
 */

import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../popup/i18n/i18n";

vi.mock("../popup/lib/release-mode", () => ({
  IS_PRODUCTION_BUILD: true,
  IS_DEVELOPMENT_BUILD: false,
  IS_NON_PRODUCTION_BUILD: false,
}));

const navigate = vi.fn();
const mockUseNavigation = vi.fn();
const copy = vi.fn();
const toast = vi.fn();
const send = vi.fn();

vi.mock("../popup/router", () => ({
  useNavigation: () => mockUseNavigation(),
}));

vi.mock("../popup/hooks/use-background", () => ({
  useBackground: () => ({ send }),
}));

vi.mock("../popup/hooks/use-copy-to-clipboard", () => ({
  useCopyToClipboard: () => ({ copy, copied: copiedLabel }),
}));

vi.mock("../popup/hooks/use-account-actions", () => ({
  useAccountActions: () => ({ setActive: vi.fn(), rename: vi.fn(), busy: false }),
}));

vi.mock("../popup/components/toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("../popup/components/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../popup/hooks/use-coming-soon", () => ({
  useComingSoon: () => vi.fn(),
}));

vi.mock("../popup/components/native-account-card", () => ({
  NativeAccountCard: () => null,
}));

// Mutable so a test can put the copy hook into its "copied" state without
// re-mocking the module.
let copiedLabel: string | null = null;

import { AccountDetailView, PRIVATE_KEY_AUTO_HIDE_MS } from "../popup/views/account-detail";
import { CLIPBOARD_CLEAR_MS } from "../popup/hooks/use-clipboard-auto-clear";

const PRIVATE_KEY = `0x${"ab".repeat(32)}`;
const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

function makeState(overrides: { locked?: boolean; accounts?: unknown[] } = {}) {
  return {
    locked: overrides.locked ?? false,
    activeAccountId: "acc-1",
    accounts: overrides.accounts ?? [
      {
        id: "acc-1",
        label: "Primary Account",
        namespace: "eip155",
        custody: "local",
        assurance: "device-key",
        address: ADDRESS,
      },
    ],
  } as any;
}

function renderView(state = makeState()) {
  return render(<AccountDetailView state={state} />);
}

function openConfirmStep() {
  fireEvent.click(screen.getByRole("button", { name: /export private key/i }));
  return {
    acknowledge: screen.getByRole("checkbox"),
    password: screen.getByLabelText(/wallet password/i),
    reveal: screen.getByRole("button", { name: /reveal key/i }),
  };
}

async function exportKey() {
  const { acknowledge, password, reveal } = openConfirmStep();
  fireEvent.click(acknowledge);
  fireEvent.change(password, { target: { value: "correct-horse" } });
  await act(async () => {
    fireEvent.click(reveal);
  });
}

describe("AccountDetailView — private key export", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    copiedLabel = null;
    navigate.mockReset();
    copy.mockReset();
    toast.mockReset();
    send.mockReset();
    send.mockResolvedValue({ privateKey: PRIVATE_KEY, address: ADDRESS });
    mockUseNavigation.mockReturnValue({
      view: "account-detail",
      params: { accountId: "acc-1" },
      navigate,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not ask the background until the risk is acknowledged and a password is typed", async () => {
    renderView();
    const { acknowledge, password, reveal } = openConfirmStep();

    expect(screen.getByRole("note")).toHaveTextContent(/anyone who sees it/i);
    expect(reveal).toBeDisabled();

    fireEvent.click(acknowledge);
    expect(reveal).toBeDisabled();

    fireEvent.change(password, { target: { value: "correct-horse" } });
    expect(reveal).toBeEnabled();

    fireEvent.click(acknowledge);
    expect(reveal).toBeDisabled();
    expect(send).not.toHaveBeenCalled();

    fireEvent.click(acknowledge);
    await act(async () => {
      fireEvent.click(reveal);
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("export-private-key", {
      accountId: "acc-1",
      password: "correct-horse",
    });
  });

  it("drops the typed password from the field once the request is sent", async () => {
    renderView();
    await exportKey();
    fireEvent.click(screen.getByRole("button", { name: /^hide$/i }));

    const { password } = openConfirmStep();
    expect(password).toHaveValue("");
  });

  it("shows the key masked, reveals on demand, and never renders it before that", async () => {
    renderView();
    await exportKey();

    const key = screen.getByTestId("exported-private-key");
    expect(key).toHaveAttribute("data-masked", "true");
    expect(key.textContent).not.toContain(PRIVATE_KEY);
    expect(document.body.textContent).not.toContain(PRIVATE_KEY);

    fireEvent.click(screen.getByRole("button", { name: /show/i }));
    expect(key).toHaveAttribute("data-masked", "false");
    expect(key).toHaveTextContent(PRIVATE_KEY);

    fireEvent.click(screen.getByRole("button", { name: /mask/i }));
    expect(key).toHaveAttribute("data-masked", "true");
    expect(document.body.textContent).not.toContain(PRIVATE_KEY);
  });

  it("Hide clears the key and returns to the idle row", async () => {
    renderView();
    await exportKey();
    fireEvent.click(screen.getByRole("button", { name: /show/i }));
    expect(document.body.textContent).toContain(PRIVATE_KEY);

    fireEvent.click(screen.getByRole("button", { name: /^hide$/i }));

    expect(screen.queryByTestId("exported-private-key")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(PRIVATE_KEY);
    expect(screen.getByRole("button", { name: /export private key/i })).toBeInTheDocument();
  });

  it("wipes the key after the auto-hide window", async () => {
    renderView();
    await exportKey();
    fireEvent.click(screen.getByRole("button", { name: /show/i }));

    act(() => {
      vi.advanceTimersByTime(PRIVATE_KEY_AUTO_HIDE_MS - 1);
    });
    expect(screen.getByTestId("exported-private-key")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("exported-private-key")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(PRIVATE_KEY);
  });

  it("wipes the key when the wallet locks", async () => {
    const view = renderView();
    await exportKey();
    expect(screen.getByTestId("exported-private-key")).toBeInTheDocument();

    view.rerender(<AccountDetailView state={makeState({ locked: true })} />);

    expect(screen.queryByTestId("exported-private-key")).not.toBeInTheDocument();
  });

  it("wipes the key when the account under view changes", async () => {
    const view = renderView();
    await exportKey();

    mockUseNavigation.mockReturnValue({
      view: "account-detail",
      params: { accountId: "acc-2" },
      navigate,
    });
    view.rerender(
      <AccountDetailView
        state={makeState({
          accounts: [
            { id: "acc-1", label: "Primary Account", namespace: "eip155", custody: "local", assurance: "device-key", address: ADDRESS },
            { id: "acc-2", label: "Second", namespace: "eip155", custody: "local", assurance: "device-key", address: "0x1111111111111111111111111111111111111111" },
          ],
        })}
      />,
    );

    expect(screen.queryByTestId("exported-private-key")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export private key/i })).toBeInTheDocument();
  });

  it("clears every timer on unmount so nothing fires into a dead tree", async () => {
    const clearSpy = vi.spyOn(window, "clearTimeout");
    copy.mockResolvedValue(true);
    const view = renderView();
    await exportKey();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy private key/i }));
    });
    // Two timers are live: the 60-second auto-hide and the 30-second clipboard wipe.
    expect(vi.getTimerCount()).toBe(2);

    view.unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(clearSpy).toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(PRIVATE_KEY_AUTO_HIDE_MS);
    });
    clearSpy.mockRestore();
  });

  it("copies with a label of its own and wipes the clipboard after the shared window", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    copy.mockResolvedValue(true);
    renderView();
    await exportKey();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy private key/i }));
    });

    expect(copy).toHaveBeenCalledWith(PRIVATE_KEY, "key");
    expect(copy).not.toHaveBeenCalledWith(PRIVATE_KEY, "addr");

    act(() => {
      vi.advanceTimersByTime(CLIPBOARD_CLEAR_MS - 1);
    });
    expect(writeText).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(writeText).toHaveBeenCalledWith("");
  });

  it("does not light the key's Copied label when the address was copied, or vice versa", async () => {
    copiedLabel = "addr";
    renderView();
    await exportKey();

    expect(screen.getByRole("button", { name: /copy address/i })).toHaveTextContent(/copied/i);
    expect(screen.getByRole("button", { name: /copy private key/i })).toHaveTextContent(/^copy$/i);

    copiedLabel = "key";
    cleanup();
    renderView();
    await exportKey();

    expect(screen.getByRole("button", { name: /copy address/i })).toHaveTextContent(/^copy$/i);
    expect(screen.getByRole("button", { name: /copy private key/i })).toHaveTextContent(/copied/i);
  });

  it("surfaces a refusal from the background and stays on the confirm step", async () => {
    send.mockRejectedValue(new Error("Incorrect password"));
    renderView();
    await exportKey();

    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect password");
    expect(screen.queryByTestId("exported-private-key")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/wallet password/i)).toBeInTheDocument();
  });

  it("omits the control for custody that cannot extract a key", () => {
    renderView(
      makeState({
        accounts: [
          { id: "acc-1", label: "Ledger", namespace: "eip155", custody: "hardware", assurance: "hardware", address: ADDRESS },
        ],
      }),
    );

    expect(screen.queryByRole("button", { name: /export private key/i })).not.toBeInTheDocument();
  });

  it("survives the account being removed while the view is open", async () => {
    const view = renderView();
    await exportKey();

    // Before the hooks were hoisted above the early return this rerender
    // threw "Rendered fewer hooks than expected".
    expect(() => {
      view.rerender(<AccountDetailView state={makeState({ accounts: [] })} />);
    }).not.toThrow();

    expect(screen.getByText(/account not found/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(PRIVATE_KEY);
  });
});
