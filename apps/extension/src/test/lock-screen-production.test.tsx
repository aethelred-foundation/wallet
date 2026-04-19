import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../popup/lib/release-mode", () => ({
  IS_PRODUCTION_BUILD: true,
  IS_DEVELOPMENT_BUILD: false,
  IS_NON_PRODUCTION_BUILD: false,
}));

import { LockScreenView } from "../popup/views/lock-screen";

describe("LockScreenView production hardening", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows biometric unlock as unavailable in production even when saved locally", () => {
    localStorage.setItem("aethelred-biometric", "1");

    const onUnlock = vi.fn();
    render(<LockScreenView onUnlock={onUnlock} />);

    expect(screen.getByRole("button", { name: /biometric unlock unavailable in this release/i })).toBeDisabled();
    expect(screen.getByText(/biometric unlock unavailable in this release/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /unlock with biometrics/i })).not.toBeInTheDocument();
  });
});
