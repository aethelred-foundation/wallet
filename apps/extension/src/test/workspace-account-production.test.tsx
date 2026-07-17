import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../popup/lib/release-mode", () => ({
  IS_PRODUCTION_BUILD: true,
  IS_DEVELOPMENT_BUILD: false,
  IS_NON_PRODUCTION_BUILD: false,
}));

const navigate = vi.fn();
const mockUseNavigation = vi.fn();
const copy = vi.fn();
const toast = vi.fn();
const comingSoon = vi.fn();
const setActive = vi.fn();
const rename = vi.fn();

vi.mock("../popup/router", () => ({
  useNavigation: () => mockUseNavigation(),
}));

vi.mock("../popup/hooks/use-copy-to-clipboard", () => ({
  useCopyToClipboard: () => ({
    copy,
    copied: null,
  }),
}));

vi.mock("../popup/hooks/use-account-actions", () => ({
  useAccountActions: () => ({
    setActive,
    rename,
    busy: false,
  }),
}));

vi.mock("../popup/components/toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("../popup/components/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../popup/hooks/use-coming-soon", () => ({
  useComingSoon: () => comingSoon,
}));

import { WorkspaceSelectorView } from "../popup/views/workspace-selector";
import { AccountDetailView } from "../popup/views/account-detail";

function makeState() {
  return {
    activeWorkspace: {
      name: "Personal Workspace",
      kind: "personal",
      role: "owner",
      summary: "Primary workspace",
    },
    activeAccountId: "acc-1",
    accounts: [
      {
        id: "acc-1",
        label: "Primary Account",
        namespace: "aethelred",
        custody: "local",
        assurance: "device-key",
        address: "aethelred1testaddress",
      },
    ],
  } as any;
}

describe("wallet popup production hardening for workspace and account views", () => {
  beforeEach(() => {
    navigate.mockReset();
    mockUseNavigation.mockReset();
    copy.mockReset();
    toast.mockReset();
    comingSoon.mockReset();
    setActive.mockReset();
    rename.mockReset();
  });

  it("shows the active workspace without tier-graduation scaffolding", () => {
    mockUseNavigation.mockReturnValue({
      view: "workspace-selector",
      params: {},
      navigate,
    });

    render(<WorkspaceSelectorView state={makeState()} />);

    expect(screen.getByText(/personal workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/primary workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/active context for signing and policy/i)).toBeInTheDocument();
    expect(screen.queryByText(/graduate tier/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /graduate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /graduate/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/execute graduation/i)).not.toBeInTheDocument();
  });

  it("hides unsupported account actions", () => {
    mockUseNavigation.mockReturnValue({
      view: "account-detail",
      params: { accountId: "acc-1" },
      navigate,
    });

    render(<AccountDetailView state={makeState()} />);

    expect(screen.queryByRole("button", { name: /open in block explorer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /view on explorer unavailable in this release/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /account removal unavailable in this release/i })).not.toBeInTheDocument();
    expect(comingSoon).not.toHaveBeenCalled();
  });
});
