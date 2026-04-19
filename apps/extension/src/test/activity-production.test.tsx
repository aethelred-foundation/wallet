import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
});
